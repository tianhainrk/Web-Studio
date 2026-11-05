import {db,fetchJSON,getGoogleAccessToken,requiredConfig} from "./reels-core.mjs";

const ai="https://generativelanguage.googleapis.com";
const drive="https://www.googleapis.com/drive/v3/files/";
const MAX_FILE_SIZE=512*1024*1024;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function videoCaptionPrompt({title,episode,total,instructions=""}){
  if(!Number.isInteger(Number(episode))||Number(episode)<1)throw Error("Số tập không hợp lệ");
  return [
    "Bạn là trợ lý biên tập của Anpi Drama. Đây là VIDEO THỰC của tập phim đính kèm.",
    "Hãy xem cả hình ảnh, lời thoại và âm thanh, rồi viết caption Facebook Reels bằng tiếng Việt sát với nội dung VIDEO này.",
    "Chỉ mô tả tình tiết có thể xác nhận từ video, không tự bịa tên nhân vật, không spoil đoạn kết hoặc tạo thông tin sai.",
    "Caption ngắn 70–260 ký tự, gợi tò mò tự nhiên, tối đa 3 hashtag, không kêu gọi vi phạm bản quyền.",
    "Viết 'summary' 1 câu ngắn về sự kiện thực tế trong video để người dùng kiểm tra chất lượng trước khi đăng.",
    "Trả JSON với 2 trường 'caption' và 'summary', không cần ngày giờ (Anpi Drama giữ lịch gốc).",
    "Tên phim: "+JSON.stringify(String(title||"").slice(0,160)),
    "Tập phim: "+Number(episode)+"/"+Number(total),
    "Một hướng dẫn duy nhất áp dụng cho tất cả tập trong chiến dịch: "+JSON.stringify(String(instructions||"Viết tự nhiên, tránh tiết lộ kết thúc.").slice(0,1200))
  ].join("\n");
}
export function validateVideoCaption(raw){
  const s=typeof raw==="string"?raw.trim():"";
  if(!s||s.length>12000)throw Error("Gemini không trả JSON caption hợp lệ");
  let data;try{data=JSON.parse(s);}catch{throw Error("Gemini không trả JSON đúng cấu trúc");}
  const caption=String(data?.caption||"").trim();
  const summary=String(data?.summary||"").trim();
  if(!caption||caption.length>2200||!summary||summary.length>1500)throw Error("Thiếu caption hoặc tóm tắt video");
  return {caption,summary};
}
export function geminiVideoRequest(uri,mimeType,prompt){
  if(!uri||!mimeType||!prompt)throw Error("Thiếu dữ liệu video");
  return {
    contents:[{parts:[{file_data:{mime_type:mimeType,file_uri:uri}},{text:prompt}]}],
    generationConfig:{temperature:0.45,maxOutputTokens:1000,responseMimeType:"application/json",
      responseSchema:{type:"OBJECT",properties:{caption:{type:"STRING"},summary:{type:"STRING"}},required:["caption","summary"]}
    }
  };
}
function geminiHeaders(extra={}){
  requiredConfig(["GEMINI_API_KEY"]);
  return {"x-goog-api-key":process.env.GEMINI_API_KEY,...extra};
}
async function uploadDriveVideo(item,folderId){
  const token=await getGoogleAccessToken();
  const id=encodeURIComponent(item.file_id);
  const meta=await fetchJSON(drive+id+"?fields=id,name,size,mimeType,parents",{headers:{Authorization:"Bearer "+token}});
  if(meta.name!==item.filename||!meta.parents?.includes(folderId)||meta.mimeType!=="video/mp4")
    throw Error("Video Drive bị thay đổi hoặc không phải MP4 trong thư mục đã chọn");
  const size=Number(meta.size);
  if(!Number.isSafeInteger(size)||size<=0||size>MAX_FILE_SIZE)
    throw Error("Video phải có kích thước từ 1 byte đến 512 MiB");
  const start=await fetch(ai+"/upload/v1beta/files",{
    method:"POST",
    headers:geminiHeaders({
      "Content-Type":"application/json",
      "X-Goog-Upload-Protocol":"resumable",
      "X-Goog-Upload-Command":"start",
      "X-Goog-Upload-Header-Content-Length":String(size),
      "X-Goog-Upload-Header-Content-Type":"video/mp4"
    }),
    body:JSON.stringify({file:{display_name:"anpi-episode-"+item.episode+".mp4"}}),
    signal:AbortSignal.timeout(60000)
  });
  if(!start.ok)throw Error("Không tạo được Gemini upload session (HTTP "+start.status+")");
  const location=start.headers.get("x-goog-upload-url");
  if(!location)throw Error("Gemini không trả resumable upload URL");
  const parsed=new URL(location);
  if(parsed.protocol!=="https:"||parsed.hostname!=="generativelanguage.googleapis.com")
    throw Error("Gemini upload trả tên miền không hợp lệ");
  const file=await fetch(drive+id+"?alt=media",{
    headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(420000)
  });
  if(!file.ok||!file.body)throw Error("Không thể đọc video từ Drive (HTTP "+file.status+")");
  const uploaded=await fetch(location,{
    method:"POST",duplex:"half",
    headers:{"Content-Type":"video/mp4","X-Goog-Upload-Offset":"0","X-Goog-Upload-Command":"upload, finalize"},
    body:file.body,signal:AbortSignal.timeout(420000)
  });
  const result=await uploaded.json().catch(()=>null);
  if(!uploaded.ok||!result?.file?.name||!result?.file?.uri)
    throw Error("Gemini upload thất bại (HTTP "+uploaded.status+")");
  return result.file;
}
async function awaitActiveFile(file){
  if(!/^files\/[A-Za-z0-9_-]+$/.test(String(file.name||"")))throw Error("Gemini trả tên file không hợp lệ");
  for(let i=0;i<60;i++){
    const info=await fetchJSON(ai+"/v1beta/"+file.name,{headers:geminiHeaders(),timeout:30000});
    if(info.state==="ACTIVE")return info;
    if(info.state==="FAILED")throw Error("Gemini xử lý video thất bại");
    await sleep(5000);
  }
  throw Error("Gemini xử lý video quá thời gian chờ; worker sẽ thử lại");
}
async function removeUploaded(file){
  if(!/^files\/[A-Za-z0-9_-]+$/.test(String(file?.name||"")))return;
  try{await fetch(ai+"/v1beta/"+file.name,{method:"DELETE",headers:geminiHeaders(),signal:AbortSignal.timeout(20000)});}
  catch(e){console.warn("Gemini cleanup failed",e.message);}
}
export async function analyzeVideoItem(item,batch){
  let uploaded;
  try{
    uploaded=await uploadDriveVideo(item,batch.folder_id);
    const file=await awaitActiveFile(uploaded);
    const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
    if(!/^[a-zA-Z0-9._-]+$/.test(model))throw Error("GEMINI_MODEL không hợp lệ");
    const res=await fetch(ai+"/v1beta/models/"+model+":generateContent",{
      method:"POST",
      headers:geminiHeaders({"Content-Type":"application/json"}),
      body:JSON.stringify(geminiVideoRequest(file.uri,"video/mp4",videoCaptionPrompt({
        title:batch.title,episode:item.episode,total:batch.total,instructions:batch.instructions
      }))),
      signal:AbortSignal.timeout(180000)
    });
    if(!res.ok)throw Error("Gemini phân tích video HTTP "+res.status);
    const data=await res.json();
    const content=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    return validateVideoCaption(content);
  }finally{await removeUploaded(uploaded);}
}
export async function updateBatchState(batchId){
  const rows=await db("reel_ai_items?batch_id=eq."+encodeURIComponent(batchId)+"&select=status");
  const ready=rows.filter(x=>x.status==="ready").length;
  const failed=rows.filter(x=>x.status==="failed").length;
  const queued=rows.filter(x=>x.status==="queued"||x.status==="running").length;
  const status=queued?"running":failed?"partial":"completed";
  await db("reel_ai_batches?id=eq."+batchId,{method:"PATCH",body:{status,updated_at:new Date().toISOString()}});
  return {status,ready,failed,pending:queued};
}
export async function runVideoBatchWorker(){
  requiredConfig(["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","REELS_ENCRYPTION_KEY","GEMINI_API_KEY"]);
  const claimed=await db("rpc/claim_reel_ai_item",{method:"POST",body:{}});
  const item=claimed?.[0];if(!item){console.log("No Gemini video jobs to analyze");return {processed:0};}
  const batch=(await db("reel_ai_batches?id=eq."+item.batch_id+"&select=*&limit=1"))?.[0];
  if(!batch)throw Error("Không tìm thấy chiến dịch phân tích video");
  try{
    const result=await analyzeVideoItem(item,batch);
    await db("reel_ai_items?id=eq."+item.id,{method:"PATCH",body:{
      status:"ready",caption:result.caption,summary:result.summary,error:null,updated_at:new Date().toISOString()
    }});
    console.log("Gemini analyzed video episode",item.episode);
  }catch(error){
    const msg=String(error.message||error).slice(0,350);
    console.error("Gemini episode",item.episode,msg);
    await db("reel_ai_items?id=eq."+item.id,{method:"PATCH",body:{
      status:item.attempts>=3?"failed":"queued",error:msg,updated_at:new Date().toISOString()
    }});
  }
  const progress=await updateBatchState(item.batch_id);
  console.log("Video batch progress",item.batch_id,progress);
  return {processed:1,...progress};
}
