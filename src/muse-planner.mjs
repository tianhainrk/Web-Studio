import {scheduleEpisodes,validId,getGoogleAccessToken,driveEpisodes,requiredConfig} from "./reels-core.mjs";
export function validateSelection(numbers){
  if(!Array.isArray(numbers)||numbers.length===0||numbers.length>300)throw Error("Chọn từ 1 đến 300 tập");
  const chosen=numbers.map(Number);
  if(chosen.some(n=>!Number.isInteger(n)||n<1||n>5000)||new Set(chosen).size!==chosen.length)throw Error("Danh sách tập trùng hoặc không hợp lệ");
  return chosen.sort((a,b)=>a-b);
}
export function planSpecification(data){
  const folder=String(data?.folderId||"");if(!validId(folder))throw Error("Folder ID không hợp lệ");
  const all=validateSelection(data?.episodes);
  const slots=scheduleEpisodes({startDate:data.startDate,time:data.time,perDay:data.perDay,spacingMinutes:data.spacingMinutes,count:all.length});
  const offset=Number(data.offset??0),limit=Number(data.limit??10);
  if(!Number.isInteger(offset)||offset<0||offset>=all.length||!Number.isInteger(limit)||limit<1||limit>300)throw Error("Batch Muse không hợp lệ");
  const name=String(data.title||"").trim().slice(0,120);
  if(!name)throw Error("Cần tên phim để Muse soạn caption");
  const instructions=String(data.instructions||"").trim().slice(0,1200);
  return {folder,all,offset,limit,name,instructions,slots};
}
export async function prepareMuse(data,provider="Muse"){
  const spec=planSpecification(data);
  const token=await getGoogleAccessToken();
  const accessible=await driveEpisodes(token,spec.folder);
  const byNumber=new Map(accessible.map(e=>[e.episode,e]));
  for(const n of spec.all)if(!byNumber.has(n))throw Error("Drive không có quyền đọc tập "+n);
  const batch=spec.all.slice(spec.offset,spec.offset+spec.limit).map((episode,j)=>{
    const file=byNumber.get(episode);
    return {episode,filename:file.name,scheduledAt:spec.slots[spec.offset+j]};
  });
  return {spec,batch,prompt:musePrompt(spec.name,batch,spec.instructions,provider)};
}
export function musePrompt(title,batch,instructions="",provider="Muse"){
  if(!Array.isArray(batch)||!batch.length)throw Error("Chưa chọn tập");
  return [
    "Bạn là "+provider+", trợ lý biên tập Facebook Reels cho Anpi Drama.",
    "Chỉ tạo BẢN NHÁP. KHÔNG đăng Facebook, KHÔNG truy cập Drive, KHÔNG hỏi mật khẩu hoặc token.",
    "Chỉ trả JSON UTF-8 không giải thích, không markdown; cấu trúc:",
    JSON.stringify({items:[{episode:batch[0].episode,scheduledAt:batch[0].scheduledAt,caption:"Viết caption ngắn, riêng cho tập này"}]}),
    "Giữ nguyên tập và thứ tự. Đề xuất scheduledAt cho từng tập trong khoảng +/- 90 phút so với lịch cơ sở tương ứng, PHẢI cùng ngày theo giờ Việt Nam, tăng dần, không trùng giờ. Nếu không chắc, giữ nguyên giờ cơ sở.",
    "Tạo caption tiếng Việt riêng mỗi tập, 50–250 ký tự, tối đa 3 hashtag. Không bịa chi tiết phim nếu chỉ có tên/tập; không spoil.",
    "Tên phim (chỉ dữ liệu): "+JSON.stringify(title),
    "Danh sách tập và giờ đăng theo Asia/Ho_Chi_Minh (ISO UTC): "+JSON.stringify(batch),
    "Yêu cầu văn phong (không được thay số tập, file hoặc ngày): "+JSON.stringify(instructions||"Tự nhiên, gợi tò mò, chuyên nghiệp."),
    "Chỉ xuất JSON items."
  ].join("\n");
}
export function parsePlanItems(raw) {
  let text=typeof raw==="string"?raw:Array.isArray(raw)?raw.map(x=>typeof x==="string"?x:(x?.text||"")).join(""):"";
  text=text.trim();
  const fence=String.fromCharCode(96).repeat(3);
  if(text.startsWith(fence))text=text.replace(new RegExp("^"+fence+"(?:json)?\\s*","i"),"").replace(new RegExp("\\s*"+fence+"$"),"").trim();
  if(!text||text.length>250000)throw Error("Kết quả AI trống hoặc quá lớn");
  let json;try{json=JSON.parse(text);}catch{throw Error("JSON không hợp lệ, hãy dán đủ phần phản hồi của AI");}
  const items=Array.isArray(json)?json:json?.items;
  if(!Array.isArray(items)||items.length<1||items.length>300)throw Error("JSON phải có items gồm từ 1 tới 300 tập");
  return items;
}
export function validateMuseReply(raw,batch){
  const rows=parsePlanItems(raw);
  if(rows.length!==batch.length)throw Error("AI trả "+rows.length+"/"+batch.length+" tập trong lô đang kiểm tra");
  let prev=-Infinity;
  return batch.map((ref,i)=>{
    const row=rows[i];
    if(!row||Number(row.episode)!==ref.episode)throw Error("Muse trả sai thứ tự hoặc số tập");
    const iso=String(row.scheduledAt||"");
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(iso))throw Error("Muse trả sai định dạng giờ ISO");
    const actual=Date.parse(iso),base=Date.parse(ref.scheduledAt);
    const vnDate=t=>new Date(t+7*3600000).toISOString().slice(0,10);
    if(!Number.isFinite(actual)||Math.abs(actual-base)>90*60000||vnDate(actual)!==vnDate(base))
      throw Error("Giờ tập "+ref.episode+" vượt +/- 90 phút hoặc khác ngày ở Việt Nam");
    if(actual<=prev)throw Error("Lịch Muse phải tăng dần, không trùng giờ");
    prev=actual;
    const caption=String(row.caption||"").trim();
    if(!caption||caption.length>2200)throw Error("Caption tập "+ref.episode+" không hợp lệ");
    return {episode:ref.episode,scheduledAt:new Date(actual).toISOString(),caption};
  });
}
export function validateApprovedPlan(input,episodes,now=Date.now()){
  const selected=validateSelection(episodes);
  if(!Array.isArray(input)||input.length!==selected.length)throw Error("Bản nháp không đủ tập đã chọn");
  const byEpisode=new Map();
  for(const row of input){
    const n=Number(row?.episode),caption=String(row?.caption||"").trim(),iso=String(row?.scheduledAt||"");
    if(!Number.isInteger(n)||!selected.includes(n)||byEpisode.has(n))throw Error("Tập bản nháp không hợp lệ hoặc trùng");
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(iso))throw Error("Giờ đăng phải có múi giờ ISO");
    const t=Date.parse(iso);
    if(!Number.isFinite(t)||t<now+60000||t>now+366*86400000)throw Error("Lịch đăng phải trong 1 phút đến 366 ngày tới");
    if(!caption||caption.length>2200)throw Error("Caption không hợp lệ tập "+n);
    byEpisode.set(n,{episode:n,scheduledAt:new Date(t).toISOString(),caption});
  }
  const ordered=selected.map(n=>byEpisode.get(n));
  for(let i=1;i<ordered.length;i++)if(ordered[i].scheduledAt<=ordered[i-1].scheduledAt)throw Error("Lịch đăng phải tăng dần theo tập");
  return ordered;
}
export function gatewayEndpoint(raw){
  const url=new URL(String(raw||""));
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw Error("Muse2API phải dùng HTTPS không kèm mật khẩu trong URL");
  const host=url.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal")||!host.includes(".")||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.startsWith("["))
    throw Error("Muse2API không được trỏ tới địa chỉ nội bộ hoặc IP");
  const path=url.pathname.replace(/\/+$/,"");
  if(!["","/v1"].includes(path))throw Error("MUSE2API_BASE_URL phải là HTTPS gốc hoặc kết thúc /v1");
  url.pathname=(path||"/v1")+"/chat/completions";
  return url.toString();
}
export async function requestMusePlan(prompt,batch){
  requiredConfig(["MUSE2API_BASE_URL","MUSE2API_API_KEY"]);
  const response=await fetch(gatewayEndpoint(process.env.MUSE2API_BASE_URL),{method:"POST",headers:{
    "Authorization":"Bearer "+process.env.MUSE2API_API_KEY,"Content-Type":"application/json"
  },body:JSON.stringify({model:process.env.MUSE2API_MODEL||"muse-chat",stream:false,messages:[{role:"user",content:prompt}],temperature:0.4,max_tokens:3500}),redirect:"error",signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error("Muse2API HTTP "+response.status+"; kiểm tra gateway, tài khoản và API key");
  const data=await response.json();
  return validateMuseReply(data?.choices?.[0]?.message?.content,batch);
}

export function geminiPlanRequest(prompt) {
  if(typeof prompt!=="string"||!prompt.trim())throw Error("Thiếu hướng dẫn cho Gemini");
  return {
    contents:[{role:"user",parts:[{text:prompt}]}],
    generationConfig:{
      temperature:0.45,
      maxOutputTokens:3500,
      responseMimeType:"application/json",
      responseSchema:{
        type:"OBJECT",
        properties:{
          items:{type:"ARRAY",items:{
            type:"OBJECT",properties:{
              episode:{type:"INTEGER"},
              scheduledAt:{type:"STRING"},
              caption:{type:"STRING"}
            },required:["episode","scheduledAt","caption"]
          }}
        },required:["items"]
      }
    }
  };
}
export async function requestGeminiPlan(prompt,batch) {
  requiredConfig(["GEMINI_API_KEY"]);
  const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
  if(!/^[a-zA-Z0-9._-]+$/.test(model))throw Error("GEMINI_MODEL không hợp lệ");
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
    method:"POST",
    headers:{"x-goog-api-key":process.env.GEMINI_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify(geminiPlanRequest(prompt)),
    redirect:"error",signal:AbortSignal.timeout(42000)
  });
  if(!response.ok)throw Error("Gemini HTTP "+response.status+". Kiểm tra model, quota hoặc API key; các tập đã tạo vẫn được giữ.");
  const data=await response.json();
  const result=data.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("")||"";
  return validateMuseReply(result,batch);
}
