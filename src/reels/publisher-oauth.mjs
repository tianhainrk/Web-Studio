import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {saveCredential,credential,listCredentials,removeCredential} from "./publisher-storage.mjs";

const META_VERSION=process.env.META_GRAPH_VERSION||"v24.0";
const origin=()=>String(process.env.STUDIO_PUBLIC_URL||"").replace(/\/$/,"");
function absoluteOrigin(){
  const u=new URL(origin());if(u.protocol!=="https:"||u.pathname!=="/"||u.search||u.hash)
    throw Error("STUDIO_PUBLIC_URL phải là HTTPS origin của website");
  return u.origin;
}
function metaApp(){
  if(!process.env.META_APP_ID||!process.env.META_APP_SECRET)throw Error("Chưa cấu hình Meta Developer App");
  return {id:process.env.META_APP_ID,secret:process.env.META_APP_SECRET};
}
function googleApp(){
  if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET)
    throw Error("Chưa cấu hình Google OAuth Client ID/Secret");
  return {id:process.env.GOOGLE_CLIENT_ID,secret:process.env.GOOGLE_CLIENT_SECRET};
}
const callbackUrl=provider=>absoluteOrigin()+"/api/publisher/oauth/"+provider+"/callback";
function sign(text){return createHmac("sha256",process.env.SESSION_SECRET||"").update(text).digest("base64url");}
export function oauthStart(provider,sessionCookie){
  if(!["meta","google"].includes(provider))throw Error("OAuth provider không hợp lệ");
  if(!sessionCookie)throw Error("Cần phiên đăng nhập");
  const nonce=randomBytes(18).toString("base64url");
  const body=[provider,Math.floor(Date.now()/1000),nonce,sign(sessionCookie)].join("|");
  const state=Buffer.from(body).toString("base64url")+"."+sign(body);
  const redirect=callbackUrl(provider);
  let url;
  if(provider==="meta"){
    const app=metaApp();
    url=new URL("https://www.facebook.com/"+META_VERSION+"/dialog/oauth");
    for(const [k,v] of Object.entries({client_id:app.id,redirect_uri:redirect,state,
      response_type:"code",scope:"pages_show_list,pages_read_engagement,pages_manage_posts"}))url.searchParams.set(k,v);
  }else{
    const app=googleApp();
    url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for(const [k,v] of Object.entries({client_id:app.id,redirect_uri:redirect,state,
      response_type:"code",access_type:"offline",prompt:"consent",
      scope:"https://www.googleapis.com/auth/drive.readonly"}))url.searchParams.set(k,v);
  }
  return url.href;
}
export function validateOAuthState(state,provider,sessionCookie){
  const [encoded,mac]=String(state||"").split(".");
  if(!encoded||!mac||!sessionCookie)throw Error("Phiên OAuth không hợp lệ");
  const body=Buffer.from(encoded,"base64url").toString("utf8");
  const current=sign(body);
  const a=Buffer.from(mac),b=Buffer.from(current);
  if(a.length!==b.length||!timingSafeEqual(a,b))throw Error("OAuth state không hợp lệ");
  const [name,time,nonce,bind]=body.split("|");
  if(name!==provider||!nonce||bind!==sign(sessionCookie)||
     !Number.isSafeInteger(Number(time))||Math.abs(Date.now()/1000-Number(time))>600)
    throw Error("Phiên OAuth đã hết hạn hoặc sai tài khoản");
}
async function fetchJSON(url,options){
  const res=await fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(30000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error("OAuth HTTP "+res.status+": "+String(data.error?.message||data.error_description||data.error||"Không xác định").slice(0,180));
  return data;
}
export async function oauthFinish(provider,code){
  if(!code||String(code).length>3000)throw Error("Thiếu mã OAuth");
  if(provider==="meta"){
    const app=metaApp();
    const args=new URLSearchParams({client_id:app.id,client_secret:app.secret,
      redirect_uri:callbackUrl("meta"),code:String(code)});
    const token=await fetchJSON("https://graph.facebook.com/"+META_VERSION+"/oauth/access_token?"+args);
    const extend=new URLSearchParams({grant_type:"fb_exchange_token",client_id:app.id,
      client_secret:app.secret,fb_exchange_token:token.access_token});
    const long=await fetchJSON("https://graph.facebook.com/"+META_VERSION+"/oauth/access_token?"+extend);
    const me=await fetchJSON("https://graph.facebook.com/"+META_VERSION+"/me?fields=id,name&access_token="+encodeURIComponent(long.access_token));
    const userId=String(me.id||"");
    if(!/^\d+$/.test(userId))throw Error("Không xác thực được Meta user");
    // Persist long-lived user token; Page tokens are imported only after rights verified.
    await saveCredential({id:"meta-user-"+userId,provider:"meta-user",
      displayName:String(me.name||"Facebook account").slice(0,100),
      secret:{access_token:long.access_token,user_id:userId},
      metadata:{expiresIn:long.expires_in||null,createdAt:new Date().toISOString()}});
    const pages=await fetchJSON("https://graph.facebook.com/"+META_VERSION+"/me/accounts?fields=id,name,access_token,tasks&limit=100&access_token="+encodeURIComponent(long.access_token));
    let count=0;
    for(const page of pages.data||[]){
      if(!/^\d+$/.test(String(page.id))||!page.access_token)continue;
      if(Array.isArray(page.tasks)&&!page.tasks.some(t=>["CREATE_CONTENT","MANAGE"].includes(t)))continue;
      await saveCredential({id:"meta-page-"+page.id,provider:"meta-page",
        displayName:String(page.name||page.id).slice(0,100),
        secret:{page_id:String(page.id),access_token:page.access_token},
        metadata:{pageId:String(page.id),userId,tasks:page.tasks||[]}});
      count++;
    }
    return {provider:"meta",count};
  }
  if(provider==="google"){
    const app=googleApp();
    const form=new URLSearchParams({client_id:app.id,client_secret:app.secret,
      code:String(code),redirect_uri:callbackUrl("google"),grant_type:"authorization_code"});
    const tokens=await fetchJSON("https://oauth2.googleapis.com/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form
    });
    if(!tokens.refresh_token)throw Error("Google không trả refresh_token, hãy thu hồi quyền ứng dụng và kết nối lại");
    await saveCredential({id:"google-drive",provider:"google-drive",displayName:"Google Drive",
      secret:{refresh_token:tokens.refresh_token},metadata:{scope:tokens.scope||""}});
    return {provider:"google",count:1};
  }
  throw Error("OAuth provider không được hỗ trợ");
}
export async function googleAccessToken(){
  const row=await credential("google-drive");
  if(!row?.secret?.refresh_token)throw Error("Google Drive chưa kết nối với backend");
  const app=googleApp();
  const form=new URLSearchParams({client_id:app.id,client_secret:app.secret,
    refresh_token:row.secret.refresh_token,grant_type:"refresh_token"});
  const r=await fetchJSON("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form
  });
  if(!r.access_token)throw Error("Không làm mới được Google Drive token");
  return r.access_token;
}
export async function pageToken(pageId){
  const page=await credential("meta-page-"+String(pageId));
  if(!page?.secret?.access_token)throw Error("Fanpage chưa kết nối Meta OAuth");
  return page.secret.access_token;
}
export async function connectedResources(){
  return {pages:await listCredentials("meta-page"),
    driveConnected:Boolean(await credential("google-drive"))};
}
export async function disconnectProvider(provider,id){
  if(provider==="google")return removeCredential("google-drive");
  if(provider==="meta"&&/^\d+$/.test(String(id)))return removeCredential("meta-page-"+id);
  throw Error("Yêu cầu ngắt kết nối không hợp lệ");
}
export const graphVersion=META_VERSION;
