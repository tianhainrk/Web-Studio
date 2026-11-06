import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from "node:crypto";

// The OAuth provider returns via a top-level cross-site GET navigation.
// Only these exact callback paths may bypass the generic cross-site filter;
// the callback handler must still validate the signed, short-lived OAuth state.
export function isOAuthCallbackRequest(method,pathname){
  return method==="GET" && (/^\\/reels\\/oauth\\/(?:google|meta)\\/callback$/.test(pathname) || /^\\/reels\\/multi\\/oauth\\/(?:youtube|tiktok)\\/callback$/.test(pathname));
}

export const GRAPH_VERSION = "v26.0";
export const TIMEZONE = "Asia/Ho_Chi_Minh";

export function encryptionKey(raw=process.env.REELS_ENCRYPTION_KEY||""){
  if(!/^[a-f0-9]{64}$/i.test(raw))throw Error("REELS_ENCRYPTION_KEY phải gồm 64 ký tự hex");
  return Buffer.from(raw,"hex");
}
export function encryptToken(value,key=encryptionKey()){
  if(typeof value!=="string"||!value)throw Error("Không thể mã hóa token rỗng");
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
  const ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(".");
}
export function decryptToken(value,key=encryptionKey()){
  const [v,iv,tag,data,...extra]=String(value||"").split(".");
  if(v!=="v1"||!iv||!tag||!data||extra.length||![iv,tag,data].every(x=>/^[A-Za-z0-9_-]+$/.test(x)))throw Error("Token mã hóa không hợp lệ");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");
}
export function oauthState(provider,origin,secret=process.env.SESSION_SECRET||""){
  if(secret.length<32)throw Error("SESSION_SECRET chưa cấu hình");
  const payload=Buffer.from(JSON.stringify({provider,origin,iat:Date.now(),nonce:randomBytes(16).toString("hex")})).toString("base64url");
  const mac=createHmac("sha256",secret).update(payload).digest("base64url");
  return payload+"."+mac;
}
export function verifyOauthState(state,provider,origin,secret=process.env.SESSION_SECRET||""){
  try{
    const [payload,signature,...extra]=String(state||"").split(".");
    if(extra.length||!payload||!signature||secret.length<32)return false;
    const valid=createHmac("sha256",secret).update(payload).digest("base64url");
    const a=Buffer.from(signature),b=Buffer.from(valid);
    if(a.length!==b.length||!timingSafeEqual(a,b))return false;
    const x=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    return x.provider===provider&&x.origin===origin&&Number.isFinite(x.iat)&&Date.now()-x.iat>=0&&Date.now()-x.iat<600000;
  }catch{return false;}
}
export function validId(id){return typeof id==="string"&&/^[a-zA-Z0-9_-]{8,160}$/.test(id);}
export function episodeNo(name){
  const m=/^EP0*([1-9][0-9]{0,3})\.mp4$/i.exec(String(name||""));
  return m?Number(m[1]):null;
}
export function scheduleEpisodes({startDate,time,perDay,spacingMinutes,count}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("Ngày hoặc giờ không hợp lệ");
  const per=Number(perDay),spacing=Number(spacingMinutes),n=Number(count);
  if(!Number.isInteger(per)||per<1||per>24||!Number.isInteger(spacing)||spacing<1||spacing>1440||!Number.isInteger(n)||n<1||n>300)throw Error("Giới hạn lịch đăng không hợp lệ");
  const [hour,minute]=time.split(":").map(Number);
  if(hour*60+minute+(Math.min(n,per)-1)*spacing>=1440)throw Error("Khoảng cách đăng khiến lịch vượt sang ngày tiếp theo");
  const first=Date.parse(startDate+"T"+time+":00+07:00");
  if(!Number.isFinite(first)||new Date(first+7*3600000).toISOString().slice(0,10)!==startDate)throw Error("Ngày bắt đầu không hợp lệ");
  return Array.from({length:n},(_,i)=>new Date(first+Math.floor(i/per)*86400000+(i%per)*spacing*60000).toISOString());
}
export function requiredConfig(keys){
  const missing=keys.filter(k=>!process.env[k]);
  if(missing.length)throw Error("Thiếu biến môi trường: "+missing.join(", "));
}
export async function db(path,{method="GET",body,prefer}={}){
  requiredConfig(["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"]);
  const base=process.env.SUPABASE_URL.replace(/\/$/,"");
  if(!/^https:\/\//.test(base))throw Error("SUPABASE_URL phải là HTTPS");
  const url=base+"/rest/v1/"+path;
  const res=await fetch(url,{method,headers:{
    "apikey":process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization":"Bearer "+process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type":"application/json",
    ...(prefer?{"Prefer":prefer}:{})
  },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw Error("Supabase HTTP "+res.status+": "+String(data?.message||data?.error||"lỗi database").slice(0,200));
  return data;
}
export async function audit(action,details={},jobId=null){
  try{await db("reel_audit",{method:"POST",prefer:"return=minimal",body:{action,job_id:jobId,details}});}catch(e){console.warn("audit",e.message);}
}
export function clientConfig(){
  return {supabase:!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY),
    google:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),
    meta:!!(process.env.META_APP_ID&&process.env.META_APP_SECRET),
    gemini:!!process.env.GEMINI_API_KEY,muse:!!(process.env.MUSE2API_BASE_URL&&process.env.MUSE2API_API_KEY),
    analyticsEnabled:process.env.REELS_ANALYTICS_ENABLED==="true",worker:"github_actions",timezone:TIMEZONE};
}
export async function fetchJSON(url,{method="GET",body,headers={},timeout=20000}={}){
  const res=await fetch(url,{method,headers,...(body===undefined?{}:{body}),signal:AbortSignal.timeout(timeout)});
  const raw=await res.text();
  let data;try{data=JSON.parse(raw);}catch{data={message:raw.slice(0,200)};}
  if(!res.ok||data?.error)throw Error("HTTP "+res.status+": "+String(data?.error?.message||data?.message||"Remote API error").slice(0,220));
  return data;
}
export async function getGoogleAccessToken(){
  const rows=await db("reel_connections?provider=eq.google&select=secret_enc");
  if(!rows?.[0])throw Error("Chưa kết nối Google Drive OAuth dành cho Reels");
  requiredConfig(["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"]);
  const form=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:decryptToken(rows[0].secret_enc),grant_type:"refresh_token"});
  const token=await fetchJSON("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
  if(!token.access_token)throw Error("Google không cấp access token");
  return token.access_token;
}
export async function driveList(token,q,fields="nextPageToken,files(id,name,mimeType,size,description)",max=1000){
  const files=[];let pageToken;
  do{
    const url=new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q",q);url.searchParams.set("fields",fields||"nextPageToken,files(id,name,mimeType,size,parents)");
    url.searchParams.set("pageSize","100");url.searchParams.set("spaces","drive");
    if(pageToken)url.searchParams.set("pageToken",pageToken);
    const data=await fetchJSON(url,{headers:{"Authorization":"Bearer "+token}});
    files.push(...(data.files||[]));pageToken=data.nextPageToken;
  }while(pageToken&&files.length<max);
  return files.slice(0,max);
}
export async function driveSeries(token){
  const roots=await driveList(token,"name = 'PineDrama-Library' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  if(!roots.length)return [];
  const root=roots[0];const folders=await driveList(token,"'"+root.id+"' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false","nextPageToken,files(id,name,mimeType,description,appProperties)");
  return folders.map(x=>({id:x.id,name:x.name,title:String(x.appProperties?.title||x.name).slice(0,160)}));
}
export async function driveEpisodes(token,folderId){
  if(!validId(folderId))throw Error("ID thư mục Drive không hợp lệ");
  const files=await driveList(token,"'"+folderId+"' in parents and trashed = false",undefined,500);
  return files.map(x=>({...x,episode:episodeNo(x.name)})).filter(x=>x.episode!==null&&x.mimeType!=="application/vnd.google-apps.folder").sort((a,b)=>a.episode-b.episode);
}
