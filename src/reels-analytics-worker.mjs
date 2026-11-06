import {db,decryptToken,requiredConfig} from "./reels-core.mjs";
import {probeVideo,probePageDaily,probePageCapabilities} from "./reels-analytics-meta.mjs";
const BATCH_PER_PAGE=Number(process.env.REELS_ANALYTICS_BATCH_PER_PAGE)||12;
const SAFE_BATCH=Math.max(1,Math.min(25,BATCH_PER_PAGE));
function shortError(error){return String(error?.message||error||"Lỗi đồng bộ").replace(/access_token=[^&\s]+/gi,"access_token=[REDACTED]").slice(0,230);}
function minISO(d){return new Date(Math.floor(d.getTime()/60000)*60000).toISOString();}
async function setStatus(id,status,error=null){
  await db("reel_analytics_sync_requests?id=eq."+id,{method:"PATCH",prefer:"return=minimal",
    body:{status,error,updated_at:new Date().toISOString()}});
}
async function listPublishedJobs(pageId){
  const items=[];
  for(let offset=0;offset<2000;offset+=500){
    const path="reel_jobs?page_id=eq."+pageId+
      "&status=eq.published&meta_video_id=not.is.null"+
      "&select=id,page_id,campaign_id,meta_video_id,filename,episode,scheduled_at,updated_at"+
      "&order=scheduled_at.desc&limit=500&offset="+offset;
    const chunk=await db(path);items.push(...chunk);
    if(chunk.length<500)break;
  }
  return items;
}
async function syncOnePage(page,triggeredBy){
  const start=new Date(),started_at=start.toISOString();
  const existing=await db("reel_analytics_sync_runs",{method:"POST",prefer:"return=representation",body:{
    page_id:page.page_id,status:"running",triggered_by:triggeredBy,started_at
  }});
  const runId=existing?.[0]?.id;
  if(!runId)throw Error("Không tạo được lượt đồng bộ");
  let processed=0,failed=0,metric_status={},error=null;
  try{
    const token=decryptToken(page.token_enc);
    const jobs=await listPublishedJobs(page.page_id);
    const data=await db("reel_analytics_snapshots?page_id=eq."+page.page_id+
      "&select=meta_video_id,sampled_at&order=sampled_at.desc&limit=3000");
    const newest=new Map();
    for(const snapshot of data)if(!newest.has(snapshot.meta_video_id))
      newest.set(snapshot.meta_video_id,Date.parse(snapshot.sampled_at));
    const chosen=[...jobs].sort((a,b)=>(newest.get(a.meta_video_id)||0)-(newest.get(b.meta_video_id)||0)).slice(0,SAFE_BATCH);
    const since=new Date(start.getTime()-9*86400000).toISOString().slice(0,10);
    const until=new Date(start.getTime()+86400000).toISOString().slice(0,10);
    try{
      const pageDaily=await probePageDaily(page.page_id,token,{since,until});
      metric_status.page=pageDaily.availability;
      const rows=pageDaily.rows.map(row=>({...row,page_id:page.page_id,last_synced_at:started_at}));
      if(rows.length)await db("reel_analytics_page_daily?on_conflict=page_id,metric_date",{method:"POST",
        prefer:"resolution=merge-duplicates,return=minimal",body:rows});
    }catch(e){metric_status.page={error:shortError(e)};failed++;}
    for(const job of chosen){
      try{
        const post=await probeVideo(job.meta_video_id,token);
        // Preserve existing post metadata; never overwrite a permalink with a missing field.
        const found=await db("reel_analytics_posts?page_id=eq."+page.page_id+
          "&meta_video_id=eq."+job.meta_video_id+"&select=permalink_url,meta_post_id,published_at&limit=1");
        const existing=found?.[0]||{};
        await db("reel_analytics_posts?on_conflict=page_id,meta_video_id",{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:{
          job_id:job.id,page_id:page.page_id,meta_video_id:job.meta_video_id,meta_post_id:post.postId||existing.meta_post_id||null,
          permalink_url:post.permalink||existing.permalink_url||null,title:job.filename,episode:job.episode,
          campaign_id:job.campaign_id,published_at:existing.published_at||job.scheduled_at,
          source:"anpi_schedule",updated_at:started_at
        }});
        await db("reel_analytics_snapshots?on_conflict=page_id,meta_video_id,sampled_at",{
          method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:{
            page_id:page.page_id,meta_video_id:job.meta_video_id,sampled_at:minISO(start),
            views:post.views,likes:post.likes,comments:post.comments,shares:post.shares,
            metric_values:post.metric_values,metric_availability:post.availability
          }});
        processed++;
        console.log("Analytics saved",page.page_id,job.meta_video_id,Object.values(post.availability).filter(v=>v==="supported").length,"metrics");
      }catch(e){failed++;error=shortError(e);console.warn("Analytics Reel failed",page.page_id,job.meta_video_id,error);}
    }
    if(!jobs.length)metric_status.posts={status:"no_data",reason:"No published Anpi Drama jobs"};
  }catch(e){failed++;error=shortError(e);console.warn("Analytics Page failed",page.page_id,error);}
  const status=failed?(processed?"partial":"failed"):"success";
  await db("reel_analytics_sync_runs?id=eq."+runId,{method:"PATCH",prefer:"return=minimal",body:{
    status,processed,failed,error,metric_status,completed_at:new Date().toISOString()
  }});
  return {pageId:page.page_id,status,processed,failed};
}
export async function runAnalyticsWorker(){
  requiredConfig(["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","REELS_ENCRYPTION_KEY"]);
  const pages=await db("reel_pages?active=eq.true&select=page_id,name,token_enc&order=page_id.asc&limit=30");
  const claimed=await db("rpc/claim_reel_analytics_requests",{method:"POST",body:{p_limit:3}});
  const isManual=!!claimed?.length;
  const ids=new Set();
  for(const request of claimed||[]){
    if(request.page_id)ids.add(request.page_id);
    else for(const p of pages)ids.add(p.page_id);
  }
  if(!isManual)for(const p of pages)ids.add(p.page_id);
  const results=[];
  for(const page of pages)if(ids.has(page.page_id)){
    // Manual requests and scheduled runs use the same isolated, bounded pipeline.
    results.push(await syncOnePage(page,isManual?"manual":"schedule"));
  }
  for(const request of claimed||[]){
    const subset=request.page_id?results.filter(x=>x.pageId===request.page_id):results;
    const failed=subset.length===0||subset.every(x=>x.status==="failed");
    await setStatus(request.id,failed?"failed":"completed",failed?"Không đồng bộ được Page được chọn":null);
  }
  console.log("Analytics worker done",JSON.stringify(results));
  return {results};
}
