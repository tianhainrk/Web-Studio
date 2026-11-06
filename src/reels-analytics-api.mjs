import {db,decryptToken,requiredConfig} from "./reels-core.mjs";
import {parseFilter,periodDays,attachLatest,aggregate,pageComparison,trend,reelDeltaTrend,
  bestTimes,recommendations,sanitizeReel,METRICS} from "./reels-analytics-core.mjs";
import {probePageCapabilities} from "./reels-analytics-meta.mjs";
function json(res,code,body){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(body));}
function fail(res,code,message){return json(res,code,{error:message});}
function endDate(period){return periodDays(period)[0];}
function filterByPage(rows,id){return id==="all"?rows:rows.filter(x=>x.page_id===id);}
function scopedRows(pageId,base){return base+(pageId==="all"?"":(base.includes("?")?"&":"?")+"page_id=eq."+encodeURIComponent(pageId));}
function normalizePage(page){return {pageId:page.page_id,name:page.name,active:page.active};}
async function bundle(pageId,period){
  const from=endDate(period);
  const [pages,posts,shots,daily,runs]=await Promise.all([
    db("reel_pages?select=page_id,name,active&order=name.asc&limit=100"),
    db("reel_analytics_posts?select=id,job_id,page_id,meta_video_id,meta_post_id,permalink_url,title,episode,campaign_id,published_at,source,updated_at&order=published_at.desc&limit=2500"),
    db("reel_analytics_snapshots?select=page_id,meta_video_id,sampled_at,views,likes,comments,shares,metric_availability&order=sampled_at.desc&limit=5000"),
    db("reel_analytics_page_daily?metric_date=gte."+from+"&select=page_id,metric_date,media_views,engagements,follows,metric_availability,last_synced_at&order=metric_date.asc&limit=500"),
    db("reel_analytics_sync_runs?select=page_id,status,processed,failed,metric_status,started_at,completed_at,error&order=started_at.desc&limit=150")
  ]);
  if(pageId!=="all"&&!pages.some(x=>x.page_id===pageId))throw Object.assign(new Error("Fanpage chưa được kết nối"),{httpStatus:404});
  const p=filterByPage(posts,pageId),s=filterByPage(shots,pageId),d=filterByPage(daily,pageId);
  const scope=filterByPage(pages,pageId),reels=attachLatest(p,s);
  const dates=periodDays(period);
  const periodReels=reels.filter(x=>x.published_at&&dates.includes(new Date(Date.parse(x.published_at)+7*3600000).toISOString().slice(0,10)));
  const latest={};
  for(const row of runs)if(!latest[row.page_id])latest[row.page_id]={
    pageId:row.page_id,status:row.status,processed:row.processed,failed:row.failed,
    lastSyncedAt:row.completed_at||row.started_at,metricStatus:row.metric_status||{},error:row.error
  };
  return {pages,posts:p,shots:s,daily:d,scope,reels,periodReels,dates,
    latest,partial:posts.length>=2500||shots.length>=5000||daily.length>=500};
}
function overview(b,pageId,period){
  const totals=aggregate(b.reels,b.dates);
  const viewsDaily=b.daily.filter(x=>b.dates.includes(x.metric_date));
  const pageViewsKnown=viewsDaily.filter(x=>typeof x.media_views==="number");
  const followersKnown=viewsDaily.filter(x=>typeof x.follows==="number");
  const sum=rows=>rows.length?rows.reduce((a,x)=>a+x,0):null;
  return {
    pageId,period,from:b.dates[0],until:b.dates.at(-1),
    // Lifetime totals of Reels whose published date falls within selected period.
    reelMetrics:totals.metrics,reelCount:totals.totalPosts,
    pageMediaViews:sum(pageViewsKnown.map(x=>x.media_views)),
    pageMediaViewsCoverage:pageViewsKnown.length,
    followsNew:sum(followersKnown.map(x=>x.follows)),
    followsCoverage:followersKnown.length,
    metricExplanation:{
      reelMetrics:"Tổng chỉ số tích lũy hiện tại của các Reel phát hành trong kỳ, KHÔNG phải lượt xem phát sinh trong kỳ.",
      pageMediaViews:"Tổng Page Insights page_media_view theo ngày trong kỳ, bao gồm nhiều loại nội dung, không chỉ Reel.",
      followsNew:"Số lượt theo dõi mới theo Page Insights trong khoảng ngày được chọn."
    },lastSync:Object.values(b.latest).filter(x=>pageId==="all"||x.pageId===pageId),
    partial:b.partial
  };
}
function insightsTrend(b,pageId,period,metric){
  const isPage=metric==="views";
  return {metric,period,pageId,
    source:isPage?"page_media_view":"reel_snapshot_delta",
    description:isPage?"Lượt xem nội dung Page theo ngày, không chỉ Reels":
      "Mức tăng của các chỉ số Reel qua snapshot liên tiếp, ngày chưa có lịch sử sẽ để trống",
    data:isPage?trend(b.daily,period,pageId,"views"):
      reelDeltaTrend(b.shots,pageId,metric,period)
  };
}
async function dispatchAnalytics(){
  const token=process.env.GITHUB_REELS_WORKFLOW_TOKEN||"";
  if(!token)return false;
  const repo=process.env.GITHUB_REELS_REPOSITORY||"tianhainrk/PineDrama-Web-Studio";
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo))return false;
  const res=await fetch("https://api.github.com/repos/"+repo+"/actions/workflows/reels-analytics.yml/dispatches",{
    method:"POST",headers:{"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
      "Content-Type":"application/json","User-Agent":"AnpiDrama-Analytics"},
    body:JSON.stringify({ref:"main"}),signal:AbortSignal.timeout(10000),redirect:"error"});
  return res.status===204;
}
export async function reelsAnalyticsRoute(req,res,path,url){
  try{
    const method=req.method;
    if(method==="POST"&&path==="/sync"){
      let body={};try{let text="";for await(const chunk of req){text+=chunk;if(text.length>4096)throw Error("Dữ liệu quá lớn");}body=JSON.parse(text||"{}");}
      catch{return fail(res,400,"Dữ liệu đồng bộ không hợp lệ");}
      const pageId=String(body.pageId||"all");
      if(pageId!=="all"&&!/^\d{1,20}$/.test(pageId))return fail(res,400,"Fanpage không hợp lệ");
      if(pageId!=="all"){
        const pages=await db("reel_pages?page_id=eq."+pageId+"&select=page_id,active&limit=1");
        if(!pages?.[0])return fail(res,404,"Fanpage không tồn tại");
      }
      const recent=await db("reel_analytics_sync_requests?requested_at=gte."+
        encodeURIComponent(new Date(Date.now()-15*60000).toISOString())+
        "&select=id,page_id,status,requested_at&order=requested_at.desc&limit=30");
      if(recent.some(x=>(x.page_id||"all")===pageId)){
        return json(res,429,{error:"Đã yêu cầu đồng bộ trong 15 phút gần đây. Không thể gửi liên tục.",nextAllowedMinutes:15});
      }
      const rows=await db("reel_analytics_sync_requests",{method:"POST",prefer:"return=representation",body:{
        page_id:pageId==="all"?null:pageId,status:"queued"
      }});
      let dispatched=false;
      try{dispatched=await dispatchAnalytics();}catch(e){console.warn("Analytics dispatch failed",String(e.message).slice(0,100));}
      return json(res,202,{queued:true,requestId:rows?.[0]?.id||null,dispatched,
        message:dispatched?"Đã yêu cầu worker Analytics chạy":"Đã xếp hàng đợi. Chạy GitHub Actions > Reels Analytics Sync nếu cần đồng bộ ngay."});
    }
    if(method!=="GET")return fail(res,405,"Phương thức không được hỗ trợ");
    const {pageId,period}=parseFilter(url);
    if(path==="/capabilities"){
      const pages=await db("reel_pages?select=page_id,name,active&order=name.asc&limit=100");
      if(pageId!=="all"&&!pages.some(p=>p.page_id===pageId))return fail(res,404,"Không thấy Page");
      if(url.searchParams.get("probe")==="1"){
        if(pageId==="all")return fail(res,400,"Chỉ kiểm tra trực tiếp một Fanpage mỗi lần");
        const row=(await db("reel_pages?page_id=eq."+pageId+"&select=page_id,token_enc&limit=1"))?.[0];
        const video=(await db("reel_jobs?page_id=eq."+pageId+"&status=eq.published&meta_video_id=not.is.null&select=meta_video_id&order=scheduled_at.desc&limit=1"))?.[0];
        const data=await probePageCapabilities(pageId,decryptToken(row.token_enc),video?.meta_video_id||null);
        return json(res,200,{capabilities:[data],live:true});
      }
      const runs=await db("reel_analytics_sync_runs?select=page_id,status,metric_status,completed_at,error&order=started_at.desc&limit=100");
      const results=pages.filter(p=>pageId==="all"||pageId===p.page_id).map(p=>{
        const x=runs.find(r=>r.page_id===p.page_id);
        return {pageId:p.page_id,name:p.name,active:p.active,status:x?.status||"not_synced",
          pageMetrics:x?.metric_status?.page||null,lastSyncedAt:x?.completed_at||null,
          error:x?.error||null};
      });
      return json(res,200,{capabilities:results,live:false,readInsightsRequired:true});
    }
    const b=await bundle(pageId,period);
    if(path==="/dashboard"){
      const slots=bestTimes(b.reels,b.shots,pageId);
      const recommendation=recommendations(slots);
      return json(res,200,{summary:overview(b,pageId,period),
        trend:insightsTrend(b,pageId,period,"views"),pages:pageComparison(b.pages,b.reels,b.dates),
        daily:b.daily,bestTimes:slots,recommendations:recommendation,
        // Only preview initial rows; full results use paginated /reels.
        reels:b.periodReels.slice(0,60).map(sanitizeReel),totalReels:b.periodReels.length,
        connectedPages:b.pages.map(normalizePage),partial:b.partial});
    }
    if(path==="/summary")return json(res,200,overview(b,pageId,period));
    if(path==="/pages")return json(res,200,{pages:pageComparison(b.pages,b.reels,b.dates),period,partial:b.partial});
    if(path==="/trend"){
      const metric=url.searchParams.get("metric")||"views";
      if(!["views","likes","comments","shares"].includes(metric))return fail(res,400,"Metric không hợp lệ");
      return json(res,200,insightsTrend(b,pageId,period,metric));
    }
    if(path==="/best-times"){
      const slots=bestTimes(b.reels,b.shots,pageId);
      return json(res,200,{pageId,slots,source:"Reels 24h snapshots",recommendations:recommendations(slots)});
    }
    if(path==="/recommendations"){
      if(pageId==="all")return fail(res,400,"Hãy chọn Fanpage để nhận giờ đăng được đề xuất");
      return json(res,200,{pageId,...recommendations(bestTimes(b.reels,b.shots,pageId))});
    }
    if(path==="/reels"){
      const search=String(url.searchParams.get("search")||"").trim().toLowerCase().slice(0,80);
      const sort=url.searchParams.get("sort")||"recent";
      if(!["recent","views"].includes(sort))return fail(res,400,"Cách sắp xếp không hợp lệ");
      const limit=Math.max(1,Math.min(50,Number(url.searchParams.get("limit"))||12));
      const cursor=Math.max(0,Math.min(2000,Number(url.searchParams.get("cursor"))||0));
      let rows=b.periodReels.filter(r=>!search||String(r.title||"").toLowerCase().includes(search)||
        ("ep"+String(r.episode||"").padStart(3,"0")).includes(search)||String(r.meta_video_id).includes(search));
      if(sort==="views")rows=[...rows].sort((x,y)=>(y.views??-1)-(x.views??-1));
      const slice=rows.slice(cursor,cursor+limit);
      return json(res,200,{reels:slice.map(sanitizeReel),total:rows.length,hasMore:cursor+limit<rows.length,
        nextCursor:cursor+limit<rows.length?cursor+limit:null,partial:b.partial});
    }
    if(/^\/reels\/[0-9a-f-]{36}$/i.test(path)){
      const id=path.split("/").at(-1);
      const reel=b.reels.find(r=>r.id===id);
      if(!reel)return fail(res,404,"Không thấy Reel này trong Page được chọn");
      const history=b.shots.filter(s=>s.page_id===reel.page_id&&s.meta_video_id===reel.meta_video_id)
        .sort((a,c)=>Date.parse(a.sampled_at)-Date.parse(c.sampled_at));
      return json(res,200,{reel:sanitizeReel(reel),history:history.map(s=>({
        sampledAt:s.sampled_at,views:s.views,likes:s.likes,comments:s.comments,shares:s.shares,
        availability:s.metric_availability
      })),page:b.pages.find(p=>p.page_id===reel.page_id)?.name||reel.page_id});
    }
    return fail(res,404,"Không tìm thấy API Analytics");
  }catch(error){
    const msg=String(error.message||"").slice(0,200);
    if(msg.includes("Supabase HTTP 404")||msg.includes("reel_analytics_")&&msg.includes("schema cache"))
      return fail(res,503,"Chưa chạy migration supabase/reels-analytics.sql trên Supabase Production");
    if(error.httpStatus===404)return fail(res,404,msg);
    console.warn("Analytics API:",msg.replace(/access_token=[^&\s]+/gi,"[REDACTED]"));
    return fail(res,500,"Analytics chưa khả dụng. Kiểm tra Supabase migration, quyền Meta và nhật ký đồng bộ.");
  }
}
