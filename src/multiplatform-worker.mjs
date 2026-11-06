import {db,decryptToken,encryptToken,getGoogleAccessToken,fetchJSON,requiredConfig} from "./reels-core.mjs";
import {verifyMediaUrl,tiktokStatus,isTikTokApprovedPrivate,tiktokChunkPlan} from "./multiplatform-core.mjs";
const tik="https://open.tiktokapis.com";
const now=()=>new Date().toISOString();
async function patch(id,changes){await db("multi_publish_jobs?id=eq."+id,{method:"PATCH",body:{...changes,updated_at:now()}});}
async function getAccount(id){
  const x=await db("multi_publish_accounts?id=eq."+id+"&active=eq.true&select=id,provider,secret_enc,scopes,external_id&limit=1");
  if(!x?.[0])throw Error("Tài khoản đã ngắt kết nối");
  return x[0];
}
async function tokenFor(account){
  const t=JSON.parse(decryptToken(account.secret_enc));
  if(account.provider==="youtube"){
    const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,
      refresh_token:t.refresh_token,grant_type:"refresh_token"});
    const x=await fetchJSON("https://oauth2.googleapis.com/token",{method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    if(!x.access_token)throw Error("Google từ chối làm mới token");
    return x.access_token;
  }
  if(Date.now()<Number(t.expires_at||0)-90000&&t.access_token)return t.access_token;
  const body=new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY,client_secret:process.env.TIKTOK_CLIENT_SECRET,
    refresh_token:t.refresh_token,grant_type:"refresh_token"});
  const x=await fetch(tik+"/v2/oauth/token/",{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(20000)});
  const data=await x.json().catch(()=>({}));
  if(!x.ok||!data.access_token)throw Error("TikTok OAuth refresh HTTP "+x.status);
  const next={...t,access_token:data.access_token,refresh_token:data.refresh_token||t.refresh_token,
    expires_at:Date.now()+Number(data.expires_in||3600)*1000};
  await db("multi_publish_accounts?id=eq."+account.id,{method:"PATCH",
    body:{secret_enc:encryptToken(JSON.stringify(next)),updated_at:now()}});
  return next.access_token;
}
async function tikRequest(path,token,body){
  const response=await fetch(tik+path,{method:"POST",headers:{"Authorization":"Bearer "+token,
    "Content-Type":"application/json; charset=utf-8"},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error?.code&&data.error.code!=="ok")
    throw Error("TikTok API "+response.status+" "+String(data.error?.code||"error").slice(0,70));
  return data.data||{};
}
async function driveInfo(job){
  const token=await getGoogleAccessToken();
  const path="https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(job.file_id);
  const x=await fetchJSON(path+"?fields=id,name,size,mimeType,parents",
    {headers:{"Authorization":"Bearer "+token}});
  const size=Number(x.size);
  if(x.name!==job.filename||x.mimeType!=="video/mp4"||!x.parents?.includes(job.folder_id)||
    !Number.isSafeInteger(size)||size<1||size>512*1024*1024)
    throw Error("Video MP4 Google Drive không hợp lệ, đã đổi thư mục hoặc vượt 512 MiB");
  return {token,size,url:path+"?alt=media"};
}
function safeSession(url){
  const u=new URL(String(url||""));
  if(u.protocol!=="https:"||!["www.googleapis.com","uploads.gdata.youtube.com"].includes(u.hostname))
    throw Error("YouTube trả về URL phiên upload không hợp lệ");
  return u.toString();
}
async function youtubeUpload(job,access){
  const gd=await driveInfo(job);
  const body=JSON.stringify({snippet:{title:job.title,description:job.caption,categoryId:"24"},
    status:{privacyStatus:job.privacy,selfDeclaredMadeForKids:false}});
  const init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{
    method:"POST",headers:{"Authorization":"Bearer "+access,"Content-Type":"application/json; charset=utf-8",
      "X-Upload-Content-Length":String(gd.size),"X-Upload-Content-Type":"video/mp4"},
    body,signal:AbortSignal.timeout(25000),redirect:"error"});
  if(!init.ok)throw Error("YouTube tạo phiên upload HTTP "+init.status);
  const target=safeSession(init.headers.get("location"));
  // The session URL can carry upload authorization. Never persist or log it.
  const media=await fetch(gd.url,{headers:{"Authorization":"Bearer "+gd.token,"Accept-Encoding":"identity"},
    signal:AbortSignal.timeout(360000),redirect:"error"});
  if(!media.ok||!media.body)throw Error("Drive không đọc được video HTTP "+media.status);
  const result=await fetch(target,{method:"PUT",duplex:"half",
    headers:{"Authorization":"Bearer "+access,"Content-Type":"video/mp4","Content-Length":String(gd.size)},
    body:media.body,signal:AbortSignal.timeout(900000),redirect:"error"});
  if(!result.ok)throw Error("YouTube upload HTTP "+result.status+"; cần kiểm tra thủ công trước khi thử lại");
  const payload=await result.json().catch(()=>({}));
  if(!/^[A-Za-z0-9_-]{8,30}$/.test(String(payload.id||"")))throw Error("YouTube chưa trả video ID; cần kiểm tra thủ công");
  return String(payload.id);
}

function safeTikTokUploadUrl(value){
  const u=new URL(String(value||""));
  if(u.protocol!=="https:"||u.username||u.password||
    !/^(?:open-upload|upload(?:\\.[a-z0-9-]+)?)\\.tiktokapis\\.com$/i.test(u.hostname))
    throw Error("URL phiên upload TikTok không hợp lệ");
  return u.toString();
}
async function directDriveUpload(job,access,creator){
  const drive=await driveInfo(job);
  const plan=tiktokChunkPlan(drive.size);
  const answer=await tikRequest("/v2/post/publish/video/init/",access,{
    post_info:{title:job.caption.slice(0,2200),privacy_level:job.privacy,
      disable_duet:!!creator.duet_disabled,disable_comment:!!creator.comment_disabled,
      disable_stitch:!!creator.stitch_disabled},
    source_info:{source:"FILE_UPLOAD",video_size:drive.size,
      chunk_size:plan.chunkSize,total_chunk_count:plan.chunkCount}
  });
  if(!/^v_[a-z_]+/i.test(String(answer.publish_id||""))||!answer.upload_url)
    throw Error("TikTok chưa trả publish_id/upload_url");
  const uploadUrl=safeTikTokUploadUrl(answer.upload_url);
  // Persist remote_id BEFORE transferring any chunks. Retrying an ambiguous
  // transfer could publish a duplicate video; require manual review instead.
  await patch(job.id,{remote_id:answer.publish_id,remote_status:{status:"UPLOADING",method:"FILE_UPLOAD"}});
  for(let i=0;i<plan.chunks.length;i++){
    const part=plan.chunks[i];
    const media=await fetch(drive.url,{headers:{Authorization:"Bearer "+drive.token,
      Range:"bytes="+part.start+"-"+part.end,"Accept-Encoding":"identity"},
      signal:AbortSignal.timeout(120000),redirect:"error"});
    const total=part.end-part.start+1;
    const range=media.headers.get("content-range")||"";
    if(!(media.status===206&&range===`bytes ${part.start}-${part.end}/${drive.size}`) &&
      !(media.status===200&&plan.chunks.length===1&&Number(media.headers.get("content-length"))===total))
      throw Error("Drive không trả đúng đoạn dữ liệu HTTP Range cần tải TikTok");
    if(!media.body)throw Error("Drive không cung cấp dữ liệu video");
    const response=await fetch(uploadUrl,{method:"PUT",duplex:"half",
      headers:{"Content-Type":"video/mp4","Content-Length":String(total),
        "Content-Range":`bytes ${part.start}-${part.end}/${drive.size}`},
      body:media.body,signal:AbortSignal.timeout(240000),redirect:"error"});
    const expected=i===plan.chunks.length-1?201:206;
    if(response.status!==expected)
      throw Error("TikTok upload chunk "+(i+1)+"/"+plan.chunks.length+" HTTP "+response.status);
  }
  return answer.publish_id;
}
async function tiktokPost(job,access){
  const creator=await tikRequest("/v2/post/publish/creator_info/query/",access,{});
  if(!isTikTokApprovedPrivate(job.privacy,creator))throw Error("TikTok không cho phép quyền riêng tư này");
  if(process.env.TIKTOK_PUBLIC_POSTING_APPROVED!=="true"&&job.privacy!=="SELF_ONLY")
    throw Error("TikTok chưa audit; chỉ được gửi ở chế độ riêng tư");
  if(!job.source_url)return directDriveUpload(job,access,creator);
  verifyMediaUrl(job.source_url,process.env.TIKTOK_VERIFIED_MEDIA_HOST||"");
  const answer=await tikRequest("/v2/post/publish/video/init/",access,{
    post_info:{title:job.caption.slice(0,2200),privacy_level:job.privacy,
      disable_duet:!!creator.duet_disabled,disable_comment:!!creator.comment_disabled,
      disable_stitch:!!creator.stitch_disabled},
    source_info:{source:"PULL_FROM_URL",video_url:job.source_url}
  });
  if(!/^v_[a-z_]+/i.test(String(answer.publish_id||"")))
    throw Error("TikTok chưa trả publish_id");
  await patch(job.id,{remote_id:answer.publish_id,remote_status:{status:"PULLING",method:"PULL_FROM_URL"}});
  return answer.publish_id;
}
async function reconcile(){
  const rows=await db("multi_publish_jobs?status=eq.processing&remote_id=not.is.null"+
    "&select=id,account_id,provider,remote_id,privacy&order=updated_at.asc&limit=15");
  for(const job of rows){
    try{
      const account=await getAccount(job.account_id),access=await tokenFor(account);
      if(job.provider==="tiktok"){
        const r=await tikRequest("/v2/post/publish/status/fetch/",access,{publish_id:job.remote_id});
        const status=tiktokStatus(r.status);
        await patch(job.id,{status,remote_status:{status:r.status,public_post_ids:r.publicaly_available_post_id||[]},
          ...(status==="failed"?{error:"TikTok báo đăng thất bại; kiểm tra trước khi đăng lại"}:{})});
      }else{
        const x=await fetchJSON("https://www.googleapis.com/youtube/v3/videos?"+
          new URLSearchParams({part:"status",id:job.remote_id}),
          {headers:{"Authorization":"Bearer "+access}});
        const status=x.items?.[0]?.status||{};
        const failed=["failed","rejected","deleted"].includes(status.uploadStatus);
        const done=status.uploadStatus==="processed";
        await patch(job.id,{status:failed?"failed":done?(status.privacyStatus==="private"?"uploaded_private":"published"):"processing",
          remote_status:{uploadStatus:status.uploadStatus||null,privacyStatus:status.privacyStatus||null}});
      }
    }catch(err){console.warn("multi reconcile",job.id,String(err?.message||"error").slice(0,120));}
  }
}
export async function main(){
  if(process.env.MULTIPLATFORM_PUBLISH_ENABLED!=="true"){
    console.log("Multiplatform worker disabled; no uploads");
    return;
  }
  requiredConfig(["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","REELS_ENCRYPTION_KEY",
    "GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"]);
  await reconcile();
  const start=Date.now();
  let sent=0,errors=0;
  for(let i=0;i<3&&Date.now()-start<16*60000;i++){
    const claimed=await db("rpc/claim_multi_publish_jobs",{method:"POST",body:{p_limit:1}});
    const job=claimed?.[0];if(!job)break;
    let uploadStarted=false;
    try{
      const account=await getAccount(job.account_id);
      if(account.provider!==job.provider)throw Error("Provider/account không trùng nhau");
      if(job.provider==="youtube"){
        const token=await tokenFor(account);uploadStarted=true;
        const videoId=await youtubeUpload(job,token);
        await patch(job.id,{status:"processing",remote_id:videoId,error:null,
          remote_status:{uploadStatus:"uploaded",privacyStatus:job.privacy}});
      }else{
        if(!process.env.TIKTOK_CLIENT_KEY||!process.env.TIKTOK_CLIENT_SECRET)
          throw Error("Thiếu cấu hình TikTok");
        const token=await tokenFor(account);uploadStarted=true;
        const publishId=await tiktokPost(job,token);
        await patch(job.id,{status:"processing",remote_id:publishId,error:null,
          remote_status:{status:"PROCESSING_UPLOAD"}});
      }
      sent++;console.log("multi accepted",job.id,job.provider);
    }catch(e){
      errors++;
      const msg=String(e?.message||"Lỗi xuất bản").replace(/access_token=[^&\s]+/gi,"access_token=[REDACTED]").slice(0,230);
      await patch(job.id,{status:uploadStarted?"needs_review":"failed",error:msg});
      console.error("multi job failed",job.id,job.provider,msg);
    }
  }
  console.log("multiplatform worker completed",JSON.stringify({sent,errors}));
}
if(import.meta.url===new URL("file://"+process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1;});
