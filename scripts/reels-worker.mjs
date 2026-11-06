import {db,audit,decryptToken,getGoogleAccessToken,fetchJSON,requiredConfig} from "../src/reels-core.mjs";
import {reelUploadHeaders} from "../src/reels-upload.mjs";
const graph="https://graph.facebook.com/v26.0";
async function patch(id,changes){
  return db("reel_jobs?id=eq."+id,{method:"PATCH",prefer:"return=minimal",body:{...changes,updated_at:new Date().toISOString()}});
}
async function pageToken(pageId){
  const pages=await db("reel_pages?page_id=eq."+pageId+"&select=token_enc,active");
  if(!pages?.[0]?.active)throw Error("Fanpage đã ngắt kết nối");
  return decryptToken(pages[0].token_enc);
}
async function uploadVideo(job,token){
  const gd=await getGoogleAccessToken();
  const meta=await fetchJSON("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(job.file_id)+"?fields=id,name,size,mimeType,parents",{headers:{Authorization:"Bearer "+gd}});
  if(meta.name!==job.filename||!String(meta.mimeType).includes("video/")||!Array.isArray(meta.parents)||!meta.parents.includes(job.folder_id))throw Error("Tập phim Google Drive đã bị thay đổi");
  const size=Number(meta.size);
  if(!Number.isSafeInteger(size)||size<=0||size>512*1024*1024)throw Error("Video phải nhỏ hơn 512 MiB");
  const session=await fetchJSON(graph+"/me/video_reels?"+new URLSearchParams({access_token:token,upload_phase:"start"}),{method:"POST"});
  if(!/^\d+$/.test(String(session.video_id))||!session.upload_url)throw Error("Meta không cấp phiên upload");
  const id=String(session.video_id);
  await patch(job.id,{meta_video_id:id});
  const uploader=new URL(session.upload_url);
  if(uploader.protocol!=="https:"||uploader.hostname!=="rupload.facebook.com")throw Error("Meta trả upload URL không được phép");
  const fromDrive=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(job.file_id)+"?alt=media",{headers:{Authorization:"Bearer "+gd,"Accept-Encoding":"identity"},signal:AbortSignal.timeout(360000)});
  if(!fromDrive.ok||!fromDrive.body)throw Error("Không thể đọc video từ Google Drive (HTTP "+fromDrive.status+")");
  const result=await fetch(uploader,{method:"POST",duplex:"half",headers:reelUploadHeaders(token,size),body:fromDrive.body,signal:AbortSignal.timeout(360000)});
  const upload=await result.json().catch(()=>({}));
  if(!result.ok||!upload.success)throw Error("Meta upload HTTP "+result.status+": "+JSON.stringify(upload).slice(0,150));
  const finish=await fetchJSON(graph+"/me/video_reels?"+new URLSearchParams({access_token:token,video_id:id,upload_phase:"finish",video_state:"PUBLISHED",description:String(job.caption||"").slice(0,2200),title:job.filename}),{method:"POST"});
  if(finish.success!==true)throw Error("Meta chưa xác nhận hoàn thành đăng video");
  await patch(job.id,{status:"processing",error:null});
  await audit("reel_sent_to_meta",{jobId:job.id,metaVideoId:id},job.id);
  return id;
}
async function reconcile(){
  const rows=await db("reel_jobs?status=eq.processing&meta_video_id=not.is.null&select=id,page_id,meta_video_id&order=updated_at.asc&limit=20");
  for(const job of rows||[]){
    try{
      const token=await pageToken(job.page_id);
      const response=await fetchJSON(graph+"/"+job.meta_video_id+"?"+new URLSearchParams({fields:"status",access_token:token}));
      const status=response.status||{};
      const published=status.publishing_phase?.status==="complete"||status.video_status==="published";
      const failed=["error","upload_failed"].includes(status.video_status)||status.publishing_phase?.status==="error";
      await patch(job.id,{status:published?"published":failed?"failed":"processing",meta_status:status});
      if(published||failed)await audit("reel_status",{jobId:job.id,result:published?"published":"failed"},job.id);
    }catch(err){console.error("reconcile",job.id,err.message);}
  }
}
export async function main(){
  requiredConfig(["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","REELS_ENCRYPTION_KEY","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"]);
  await reconcile();
  // Each GitHub Actions cron execution can be delayed. Drain a small batch of
  // overdue Reels while leaving time for cleanup under the 25-minute timeout.
  const started=Date.now();
  const batchLimit=Math.max(1,Math.min(8,Number(process.env.REELS_BATCH_LIMIT)||8));
  let processed=0,failed=0;
  for(let attempt=0;attempt<batchLimit&&Date.now()-started<20*60000;attempt++){
    const jobs=await db("rpc/claim_reel_jobs",{method:"POST",body:{p_limit:1}});
    const job=jobs?.[0];
    if(!job)break;
    processed++;
    console.log("reel claimed",job.id,"page",job.page_id,"scheduled",job.scheduled_at);
    try{
      const token=await pageToken(job.page_id);
      await uploadVideo(job,token);
      console.log("reel delivered to Meta",job.id);
    }catch(err){
      failed++;
      // Never emit access tokens, raw API responses or Drive links to Actions logs.
      console.error("reel job failed",job.id,String(err.message||err).slice(0,220));
      await patch(job.id,{status:"failed",error:String(err.message||err).slice(0,400)});
      await audit("reel_failed",{jobId:job.id,error:String(err.message||err).slice(0,300)},job.id);
    }
  }
  console.log("reels worker jobs",processed,"failed",failed,"elapsed_ms",Date.now()-started);
  if(processed===batchLimit)console.log("reels worker reached per-run batch limit; next invocation will continue queue");
}
if(import.meta.url===new URL("file://"+process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1;});
