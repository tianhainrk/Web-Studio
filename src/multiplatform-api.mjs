import {oauthState,verifyOauthState,encryptToken,decryptToken,db,fetchJSON,getGoogleAccessToken,requiredConfig,validId} from "./reels-core.mjs";
import {cleanPostRequest,isTikTokApprovedPrivate} from "./multiplatform-core.mjs";
const GRAPH="https://open.tiktokapis.com";
const json=(res,code,value)=>{res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
const fail=(res,code,msg)=>json(res,code,{error:String(msg).slice(0,240)});
const redirect=(res,url)=>{res.writeHead(302,{"Location":url,"Cache-Control":"no-store"});res.end();};
async function input(req){let text="";for await(const x of req){text+=x;if(text.length>16000)throw Error("Yêu cầu quá lớn");}return JSON.parse(text||"{}");}
function origin(req){
  const p=String(req.headers["x-forwarded-proto"]||"https").split(",")[0];
  const host=String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0];
  if(p!=="https"||!/^[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(host))throw Error("HTTPS host không hợp lệ");
  return "https://"+host;
}
const callback=(req,provider)=>origin(req)+"/api/reels/multi/oauth/"+provider+"/callback";
async function tikFetch(path,token,body){
  const res=await fetch(GRAPH+path,{method:body===undefined?"GET":"POST",
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json; charset=utf-8"},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.error?.code&&data.error.code!=="ok")
    throw Error("TikTok API "+res.status+": "+String(data.error?.code||"upstream_error").slice(0,70));
  return data.data||{};
}
async function googleRefresh(refresh){
  const form=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,
    refresh_token:refresh,grant_type:"refresh_token"});
  const res=await fetchJSON("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
  if(!res.access_token)throw Error("Không thể làm mới YouTube token");
  return res.access_token;
}
async function tikRefresh(account){
  const token=JSON.parse(decryptToken(account.secret_enc));
  if(Date.now()<Number(token.expires_at||0)-90000&&token.access_token)return token.access_token;
  requiredConfig(["TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET"]);
  const form=new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY,client_secret:process.env.TIKTOK_CLIENT_SECRET,
    grant_type:"refresh_token",refresh_token:token.refresh_token});
  const res=await fetch(GRAPH+"/v2/oauth/token/",{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(15000)});
  const value=await res.json().catch(()=>({}));
  if(!res.ok||!value.access_token)throw Error("TikTok OAuth refresh HTTP "+res.status);
  const next={...token,access_token:value.access_token,refresh_token:value.refresh_token||token.refresh_token,
    expires_at:Date.now()+Number(value.expires_in||3600)*1000};
  await db("multi_publish_accounts?id=eq."+account.id,{method:"PATCH",body:{secret_enc:encryptToken(JSON.stringify(next)),updated_at:new Date().toISOString()}});
  return next.access_token;
}
async function accountToken(account){
  if(account.provider==="tiktok")return tikRefresh(account);
  const tokens=JSON.parse(decryptToken(account.secret_enc));
  return googleRefresh(tokens.refresh_token);
}
export async function multiRoute(req,res,path){
  try{
    const method=req.method,url=new URL(req.url,origin(req));
    if(path==="/config"&&method==="GET")
      return json(res,200,{enabled:process.env.MULTIPLATFORM_ENABLED==="true",
        youtube:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),
        tiktok:!!(process.env.TIKTOK_CLIENT_KEY&&process.env.TIKTOK_CLIENT_SECRET),
        tiktokMediaReady:!!process.env.TIKTOK_VERIFIED_MEDIA_HOST,
        tiktokPublicApproved:process.env.TIKTOK_PUBLIC_POSTING_APPROVED==="true",
        workerEnabled:process.env.MULTIPLATFORM_PUBLISH_ENABLED==="true"});
    if(process.env.MULTIPLATFORM_ENABLED!=="true")return fail(res,503,"Đăng đa nền tảng chưa bật trên Vercel");
    if(/^\/oauth\/(youtube|tiktok)\/start$/.test(path)&&method==="GET"){
      const provider=path.split("/")[2];
      requiredConfig(provider==="youtube"?["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","SESSION_SECRET"]:
        ["TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET","SESSION_SECRET"]);
      const state=oauthState(provider,origin(req));
      if(provider==="youtube"){
        const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");
        for(const [k,v] of Object.entries({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:callback(req,provider),
          response_type:"code",scope:"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
          access_type:"offline",prompt:"consent",state}))u.searchParams.set(k,v);
        return redirect(res,u.toString());
      }
      const u=new URL("https://www.tiktok.com/v2/auth/authorize/");
      for(const [k,v] of Object.entries({client_key:process.env.TIKTOK_CLIENT_KEY,redirect_uri:callback(req,provider),
        response_type:"code",scope:"user.info.basic,video.publish",state}))u.searchParams.set(k,v);
      return redirect(res,u.toString());
    }
    if(/^\/oauth\/(youtube|tiktok)\/callback$/.test(path)&&method==="GET"){
      const provider=path.split("/")[2],state=url.searchParams.get("state"),code=url.searchParams.get("code");
      if(!verifyOauthState(state,provider,origin(req)))return fail(res,403,"OAuth state không hợp lệ");
      if(!code)return fail(res,400,"Đã từ chối hoặc hủy cấp quyền OAuth");
      let externalId,name,tokens,scope="";
      if(provider==="youtube"){
        const form=new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri:callback(req,provider),grant_type:"authorization_code"});
        const data=await fetchJSON("https://oauth2.googleapis.com/token",{method:"POST",
          headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
        if(!data.refresh_token)throw Error("YouTube chưa cấp refresh_token; thử cấp quyền OAuth lại");
        const ch=await fetchJSON("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          {headers:{"Authorization":"Bearer "+data.access_token}});
        const channel=ch.items?.[0];
        if(!channel?.id)throw Error("Tài khoản Google không có kênh YouTube");
        externalId=channel.id;name=String(channel.snippet?.title||channel.id).slice(0,140);
        tokens={refresh_token:data.refresh_token};scope=data.scope||"";
      }else{
        const form=new URLSearchParams({client_key:process.env.TIKTOK_CLIENT_KEY,client_secret:process.env.TIKTOK_CLIENT_SECRET,
          code,grant_type:"authorization_code",redirect_uri:callback(req,provider)});
        const response=await fetch(GRAPH+"/v2/oauth/token/",{method:"POST",
          headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(15000)});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.access_token||!data.refresh_token||!data.open_id)
          throw Error("TikTok chưa cấp đầy đủ access/refresh token ("+response.status+")");
        externalId=String(data.open_id);scope=data.scope||"";
        const profile=await tikFetch("/v2/user/info/?fields=open_id,display_name",data.access_token);
        name=String(profile.user?.display_name||externalId).slice(0,140);
        tokens={refresh_token:data.refresh_token,access_token:data.access_token,
          expires_at:Date.now()+Number(data.expires_in||3600)*1000};
      }
      await db("multi_publish_accounts?on_conflict=provider,external_id",{method:"POST",
        prefer:"resolution=merge-duplicates,return=minimal",
        body:{provider,external_id:externalId,display_name:name,secret_enc:encryptToken(JSON.stringify(tokens)),
          scopes:scope,active:true,updated_at:new Date().toISOString()}});
      return redirect(res,origin(req)+"/?connected="+provider+"#multiplatform");
    }
    if(path==="/accounts"&&method==="GET"){
      const accounts=await db("multi_publish_accounts?select=id,provider,external_id,display_name,active,scopes,connected_at&order=provider.asc,display_name.asc&limit=100");
      return json(res,200,{accounts});
    }
    if(path==="/jobs"&&method==="GET"){
      const jobs=await db("multi_publish_jobs?select=id,account_id,provider,filename,title,caption,scheduled_at,privacy,status,remote_id,remote_status,error,created_at&order=scheduled_at.desc&limit=200");
      return json(res,200,{jobs});
    }
    if(path==="/tiktok/creator"&&method==="POST"){
      const body=await input(req);
      if(!/^[0-9a-f-]{36}$/i.test(String(body.accountId||"")))return fail(res,400,"Account ID không hợp lệ");
      const account=(await db("multi_publish_accounts?id=eq."+body.accountId+"&provider=eq.tiktok&active=eq.true&select=id,provider,secret_enc&limit=1"))?.[0];
      if(!account)return fail(res,404,"Tài khoản TikTok không khả dụng");
      const data=await tikFetch("/v2/post/publish/creator_info/query/",await accountToken(account),{});
      return json(res,200,{creator:{privacy_level_options:data.privacy_level_options||[],
        max_video_post_duration_sec:data.max_video_post_duration_sec||null,
        duet_disabled:!!data.duet_disabled,stitch_disabled:!!data.stitch_disabled,
        comment_disabled:!!data.comment_disabled}});
    }
    if(path==="/jobs"&&method==="POST"){
      const b=await input(req);
      const clean=cleanPostRequest(b,{verifiedHost:process.env.TIKTOK_VERIFIED_MEDIA_HOST||"",
        publicTikTokApproved:process.env.TIKTOK_PUBLIC_POSTING_APPROVED==="true"});
      const account=(await db("multi_publish_accounts?id=eq."+clean.account_id+
        "&active=eq.true&select=id,provider,secret_enc,scopes&limit=1"))?.[0];
      if(!account||account.provider!==clean.provider)return fail(res,403,"Tài khoản không được kết nối");
      if(clean.provider==="tiktok"){
        const scope=account.scopes.split(/[\s,]+/);
        if(!scope.includes("video.publish"))return fail(res,403,"TikTok chưa cấp quyền video.publish");
        const creator=await tikFetch("/v2/post/publish/creator_info/query/",await accountToken(account),{});
        if(!isTikTokApprovedPrivate(clean.privacy,creator))
          return fail(res,403,"Chế độ hiển thị không nằm trong lựa chọn TikTok cung cấp");
      }
      const gd=await getGoogleAccessToken();
      const meta=await fetchJSON("https://www.googleapis.com/drive/v3/files/"+
        encodeURIComponent(clean.file_id)+"?fields=id,name,mimeType,size,parents",
        {headers:{"Authorization":"Bearer "+gd}});
      if(meta.name!==clean.filename||!String(meta.mimeType).includes("video/")||
        !Array.isArray(meta.parents)||!meta.parents.includes(clean.folder_id))
        return fail(res,400,"File Google Drive không đúng tập hoặc thư mục đã chọn");
      if(!(Number(meta.size)>0)||Number(meta.size)>512*1024*1024)
        return fail(res,400,"Bản đầu tiên hỗ trợ MP4 tối đa 512 MiB");
      const rows=await db("multi_publish_jobs",{method:"POST",prefer:"return=representation",body:clean});
      return json(res,201,{job:rows?.[0]||null,message:"Đã xếp lịch; worker chưa chạy nếu chưa bật MULTIPLATFORM_PUBLISH_ENABLED"});
    }
    if(path==="/jobs/cancel"&&method==="POST"){
      const b=await input(req);
      if(!/^[0-9a-f-]{36}$/i.test(String(b.id||"")))return fail(res,400,"Job ID không hợp lệ");
      const rows=await db("multi_publish_jobs?id=eq."+b.id+"&status=eq.queued",{method:"PATCH",prefer:"return=representation",
        body:{status:"cancelled",updated_at:new Date().toISOString()}});
      return rows?.length?json(res,200,{ok:true}):fail(res,409,"Chỉ có thể hủy video chưa bắt đầu upload");
    }
    return fail(res,404,"Không có API đa nền tảng tương ứng");
  }catch(e){console.error("multi api",String(e?.message||"error").slice(0,180));return fail(res,500,String(e?.message||"Lỗi hệ thống"));}
}
