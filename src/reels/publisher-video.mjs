import {randomUUID} from "node:crypto";
import {db,credential,getPost,patchPost,campaign} from "./publisher-storage.mjs";
import {googleAccessToken,pageToken,graphVersion} from "./publisher-oauth.mjs";

const GRAPH="https://graph-video.facebook.com/"+graphVersion;
const CHUNK=3*1024*1024;
function safeId(value){if(!/^[\w-]{10,128}$/.test(String(value||"")))throw Error("Drive File ID không hợp lệ");return String(value);}
function safePage(value){if(!/^\d{5,25}$/.test(String(value||"")))throw Error("Meta Page ID không hợp lệ");return String(value);}
async function driveFile(fileId,token){
  const url="https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(safeId(fileId))+
    "?fields=id,name,mimeType,size,trashed";
  const res=await fetch(url,{headers:{Authorization:"Bearer "+token},redirect:"error",signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error("Không lấy được file Drive: HTTP "+res.status);
  const item=await res.json();
  if(item.trashed||!Number.isSafeInteger(Number(item.size))||Number(item.size)<1||Number(item.size)>2*1024*1024*1024)
    throw Error("File Drive trống hoặc quá giới hạn thử nghiệm 2 GB");
  if(item.mimeType!=="video/mp4"&&!String(item.name||"").toLowerCase().endsWith(".mp4"))
    throw Error("File không phải MP4");
  return {size:Number(item.size),name:item.name};
}
async function driveRange(fileId,token,start,size){
  const end=Math.min(start+CHUNK,size)-1;
  const url="https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(safeId(fileId))+"?alt=media";
  const res=await fetch(url,{headers:{Authorization:"Bearer "+token,Range:"bytes="+start+"-"+end},
    redirect:"error",signal:AbortSignal.timeout(45000)});
  if(res.status!==206)throw Error("Drive phải trả HTTP 206 cho tải theo chunk; hiện là "+res.status);
  const range=res.headers.get("content-range")||"";
  if(!range.startsWith("bytes "+start+"-"))throw Error("Drive trả Content-Range không khớp");
  const bytes=await res.arrayBuffer();
  if(bytes.byteLength!==end-start+1)throw Error("Đọc chunk Drive chưa đủ");
  return Buffer.from(bytes);
}
async function graphPost(pageId,token,fields,{video=false}={}){
  const form=new URLSearchParams(fields);
  const url=(video?GRAPH:"https://graph.facebook.com/"+graphVersion)+"/"+safePage(pageId)+"/videos";
  const res=await fetch(url,{method:"POST",headers:{
    Authorization:"Bearer "+token,"Content-Type":"application/x-www-form-urlencoded"
  },body:form,redirect:"error",signal:AbortSignal.timeout(45000)});
  const value=await res.json().catch(()=>({}));
  if(!res.ok||value.error)throw Error("Meta HTTP "+res.status+": "+String(value.error?.message||"Không rõ").slice(0,200));
  return value;
}
async function graphTransfer(pageId,token,session,start,chunk){
  const data=new FormData();
  data.set("upload_phase","transfer");
  data.set("upload_session_id",String(session));
  data.set("start_offset",String(start));
  data.set("video_file_chunk",new Blob([chunk],{type:"application/octet-stream"}),"chunk.bin");
  const res=await fetch(GRAPH+"/"+safePage(pageId)+"/videos",{
    method:"POST",headers:{Authorization:"Bearer "+token},body:data,
    redirect:"error",signal:AbortSignal.timeout(55000)});
  const result=await res.json().catch(()=>({}));
  if(!res.ok||result.error)throw Error("Meta chunk HTTP "+res.status+": "+String(result.error?.message||"Không rõ").slice(0,200));
  return result;
}
export async function beginVideoUpload(postId){
  const existing=await getPost(postId);
  if(!existing)throw Error("Không tìm thấy bài đăng");
  if(existing.status!=="approved")throw Error("Bài đăng chưa được duyệt hoặc đã tải lên");
  if(!existing.rights_approved||!existing.editorial_approved||!existing.caption)
    throw Error("Chưa đủ quyền phân phối, duyệt và caption");
  if(new Date(existing.scheduled_at).getTime()<Date.now()+20*60*1000)
    throw Error("Giờ đăng cần còn cách hiện tại ít nhất 20 phút để upload và Meta xử lý");
  const parent=await campaign(existing.campaign_id);
  if(!parent||parent.status!=="approved")throw Error("Chiến dịch chưa được duyệt");
  const pageId=safePage(existing.page_id);
  const page=await credential("meta-page-"+pageId);
  if(!page)throw Error("Page này chưa được Meta xác thực");
  const token=await googleAccessToken();
  const file=await driveFile(existing.drive_file_id,token);
  const current=await patchPost(postId,{status:"initializing",last_error:null},
    {status:"eq.approved"});
  try{
    const response=await graphPost(pageId,await pageToken(pageId),{
      upload_phase:"start",file_size:String(file.size)
    },{video:true});
    if(!response.upload_session_id||!response.video_id)throw Error("Meta không trả session và video_id");
    return await patchPost(postId,{
      status:"uploading",file_size:file.size,upload_session_id:String(response.upload_session_id),
      meta_video_id:String(response.video_id),start_offset:Number(response.start_offset||0),
      end_offset:Number(response.end_offset||CHUNK),last_error:null
    },{status:"eq.initializing"});
  }catch(error){
    await patchPost(postId,{status:"failed",last_error:String(error.message).slice(0,400)},
      {status:"eq.initializing"}).catch(()=>{});
    throw error;
  }
}
export async function transferOneChunk(postId){
  const post=await getPost(postId);
  if(!post||post.status!=="uploading"||!post.upload_session_id)
    throw Error("Không có phiên upload hợp lệ");
  const start=Number(post.start_offset||0),size=Number(post.file_size||0);
  if(!Number.isSafeInteger(start)||start<0||start>size||!size)throw Error("Vị trí upload không hợp lệ");
  if(start===size)return {done:true,post};
  // Optimistic lock: only one worker may take this chunk at once.
  const lock=randomUUID();
  await patchPost(postId,{status:"transferring",lock_token:lock},{
    status:"eq.uploading",start_offset:"eq."+start
  });
  try{
    const [googleToken,metaToken]=await Promise.all([googleAccessToken(),pageToken(post.page_id)]);
    const bytes=await driveRange(post.drive_file_id,googleToken,start,size);
    const next=await graphTransfer(post.page_id,metaToken,post.upload_session_id,start,bytes);
    const offset=Number(next.start_offset);
    if(!Number.isSafeInteger(offset)||offset<=start||offset>size)
      throw Error("Meta trả offset không hợp lệ hoặc không tiến lên");
    const saved=await patchPost(postId,{
      status:"uploading",start_offset:offset,
      end_offset:Number(next.end_offset||size),lock_token:null,last_error:null
    },{status:"eq.transferring",lock_token:"eq."+lock});
    return {done:offset===size,offset,total:size,post:saved};
  }catch(error){
    await patchPost(postId,{
      status:"failed",lock_token:null,last_error:String(error.message).slice(0,400)
    },{status:"eq.transferring",lock_token:"eq."+lock}).catch(()=>{});
    throw error;
  }
}
export async function finalizeVideoUpload(postId){
  const post=await getPost(postId);
  if(!post||post.status!=="uploading"||!post.upload_session_id)
    throw Error("Không có upload để hoàn tất");
  if(Number(post.start_offset)!==Number(post.file_size))
    throw Error("Còn chunk chưa chuyển xong");
  if(new Date(post.scheduled_at).getTime()<Date.now()+10*60*1000)
    throw Error("Giờ đăng cách hiện tại dưới 10 phút, hãy lập lại lịch");
  const claim=await patchPost(postId,{status:"finalizing"},{status:"eq.uploading"});
  try{
    const stamp=Math.floor(new Date(claim.scheduled_at).getTime()/1000);
    const title=String(claim.title||"").slice(0,150);
    const description=String(claim.caption||"").slice(0,1500)+
      (Array.isArray(claim.hashtags)&&claim.hashtags.length?"\n"+claim.hashtags.join(" "):"");
    const response=await graphPost(claim.page_id,await pageToken(claim.page_id),{
      upload_phase:"finish",upload_session_id:claim.upload_session_id,
      published:"false",scheduled_publish_time:String(stamp),
      unpublished_content_type:"SCHEDULED",title,description
    },{video:true});
    if(response.success!==true&&!response.id)
      throw Error("Meta chưa xác nhận hoàn tất phiên lên lịch");
    return await patchPost(postId,{
      status:"scheduled",meta_response:response,last_error:null
    },{status:"eq.finalizing"});
  }catch(error){
    // FINISH is potentially non-idempotent. Never auto retry on ambiguous response.
    await patchPost(postId,{status:"needs_reconcile",last_error:String(error.message).slice(0,400)},
      {status:"eq.finalizing"}).catch(()=>{});
    throw error;
  }
}
export async function videoStatus(postId){
  const post=await getPost(postId);
  if(!post?.meta_video_id)throw Error("Chưa có Meta Video ID");
  const token=await pageToken(post.page_id);
  const url="https://graph.facebook.com/"+graphVersion+"/"+encodeURIComponent(post.meta_video_id)+
    "?fields=id,status,permalink_url,created_time,published&access_token="+encodeURIComponent(token);
  const res=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(25000)});
  const value=await res.json().catch(()=>({}));
  if(!res.ok||value.error)throw Error("Không đối soát được Meta Video: "+String(value.error?.message||res.status));
  let status=post.status;
  if(value.published===true)status="published";
  // Do not invent published status based on time alone.
  const saved=await patchPost(postId,{status,meta_response:value},
    {status:"eq."+post.status});
  return {post:saved,meta:value};
}
export async function resetFailedUpload(postId){
  const post=await getPost(postId);
  if(!post||post.status!=="failed")throw Error("Không có tác vụ lỗi để tiếp tục");
  // Session may be ambiguous. Resume only when Meta offsets are known.
  if(!post.upload_session_id||!post.file_size)throw Error("Upload khởi tạo lỗi; cần xác minh với Meta trước khi tạo lại");
  return patchPost(postId,{status:"uploading",last_error:null},{status:"eq.failed"});
}
