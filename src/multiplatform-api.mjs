import {oauthState,verifyOauthState,encryptToken,decryptToken,db,audit,fetchJSON,getGoogleAccessToken,driveEpisodes,requiredConfig,validId} from "./reels-core.mjs";
import {cleanPostRequest,isTikTokApprovedPrivate} from "./multiplatform-core.mjs";
import {validateYouTubeMuseManifest,youtubeMusePrompt,parseYoutubeMuseReply} from "./multiplatform-muse.mjs";
import {prepareYouTubeAiRequest,youtubeAiPrompt,youtubeAiRequest,normalizeYouTubeAiDraft,safeYoutubeRetry,cleanYoutubeUpdate} from "./multiplatform-planner.mjs";
const GRAPH="https://open.tiktokapis.com";
const json=(res,code,value)=>{res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
const fail=(res,code,msg)=>json(res,code,{error:String(msg).slice(0,240)});
const redirect=(res,url)=>{res.writeHead(302,{"Location":url,"Cache-Control":"no-store"});res.end();};
async function input(req,maxLength=16000){let text="";for await(const x of req){text+=x;if(text.length>maxLength)throw Error("Yêu cầu quá lớn");}return JSON.parse(text||"{}");}
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
        workerEnabled:process.env.MULTIPLATFORM_PUBLISH_ENABLED==="true",
         gemini:!!process.env.GEMINI_API_KEY});
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
      const jobs=await db("multi_publish_jobs?select=id,account_id,provider,folder_id,file_id,filename,title,caption,scheduled_at,privacy,status,remote_id,remote_status,error,updated_at,created_at&order=scheduled_at.desc&limit=500");
      return json(res,200,{jobs});
    }
    if(path==="/muse/youtube/prepare"||path==="/muse/youtube/parse"){
      if(method!=="POST")return fail(res,405,"Phải dùng POST");
      const b=await input(req,path.endsWith("/parse")?270000:18000);
      const accountId=String(b?.accountId||"");
      if(!/^[0-9a-f-]{36}$/i.test(accountId))return fail(res,400,"Chưa chọn kênh YouTube hợp lệ");
      const account=(await db("multi_publish_accounts?id=eq."+accountId+
        "&provider=eq.youtube&active=eq.true&select=id,display_name&limit=1"))?.[0];
      if(!account)return fail(res,404,"Kênh YouTube chưa kết nối hoặc đã tắt");
      let manifest;
      try{manifest=validateYouTubeMuseManifest({...b,accountName:account.display_name});}
      catch(err){return fail(res,400,err.message);}
      const accessible=await driveEpisodes(await getGoogleAccessToken(),manifest.folderId);
      const byEpisode=new Map(accessible.map(x=>[Number(x.episode),x]));
      for(const entry of manifest.items){
        const actual=byEpisode.get(entry.episode);
        if(!actual||actual.id!==entry.fileId||actual.name!==entry.filename||actual.mimeType!=="video/mp4"||
          Number(actual.size)<1||Number(actual.size)>512*1024*1024)
          return fail(res,400,"Tập "+entry.episode+" không còn khớp file MP4 trong Drive");
      }
      if(path==="/muse/youtube/prepare"){
        await audit("youtube_muse_prompt_prepared",{accountId,folderId:manifest.folderId,episodes:manifest.items.length});
        return json(res,200,{prompt:youtubeMusePrompt(manifest),count:manifest.items.length,source:"connected_muse_drive",
          note:"Chỉ là lệnh cho Muse; chưa có bài nào được tạo hoặc đăng"});
      }
      let parsed;
      try{parsed=parseYoutubeMuseReply(String(b.reply||""),manifest);}catch(err){return fail(res,400,err.message);}
      await audit("youtube_muse_json_imported",{accountId,episodes:parsed.plan.map(x=>x.episode),
        skipped:parsed.skipped.length});
      return json(res,200,{...parsed,status:"draft",source:"connected_muse_drive"});
    }
    if(path==="/ai/youtube/plan"&&method==="POST"){
      if(!process.env.GEMINI_API_KEY)return fail(res,503,"Chưa cấu hình GEMINI_API_KEY trên Vercel");
      const b=await input(req);
      let prepared;
      try{prepared=prepareYouTubeAiRequest(b);}catch(e){return fail(res,400,e.message);}
      const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
      if(!/^[A-Za-z0-9._-]+$/.test(model))return fail(res,503,"Model Gemini không hợp lệ");
      const resp=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
        method:"POST",headers:{"x-goog-api-key":process.env.GEMINI_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify(youtubeAiRequest(youtubeAiPrompt(prepared))),redirect:"error",signal:AbortSignal.timeout(45000)});
      if(!resp.ok)return fail(res,502,"Gemini HTTP "+resp.status+"; kiểm tra model, quota hoặc AI API key");
      const data=await resp.json();
      const result=data.candidates?.[0]?.content?.parts?.map(part=>part.text||"").join("")||"";
      let plan;
      try{plan=normalizeYouTubeAiDraft(result,prepared.items);}catch(e){return fail(res,502,e.message);}
      await audit("youtube_ai_plan_drafted",{episodes:plan.map(x=>x.episode),source:"drive_metadata_only"});
      return json(res,200,{plan,source:"metadata_only",status:"draft"});
    }
    if(path==="/jobs/attention"&&method==="GET"){
      const fields="id,account_id,provider,folder_id,file_id,filename,title,caption,scheduled_at,privacy,status,remote_id,remote_status,error,updated_at";
      const active=await db("multi_publish_jobs?provider=eq.youtube&status=in.(failed,uploading,processing,needs_review)"+
        "&select="+fields+"&order=updated_at.desc&limit=200");
      const older=new Date(Date.now()-5*60000).toISOString();
      const overdue=await db("multi_publish_jobs?provider=eq.youtube&status=eq.queued&scheduled_at=lt."+
        encodeURIComponent(older)+"&select="+fields+"&order=scheduled_at.asc&limit=200");
      const records=new Map([...active,...overdue].map(j=>[j.id,j]));
      return json(res,200,{jobs:[...records.values()],checkedAt:new Date().toISOString(),
        partial:active.length>=200||overdue.length>=200});
    }
    if(path==="/jobs/update"&&method==="POST"){
      const b=await input(req),id=String(b.id||"");
      if(!/^[0-9a-f-]{36}$/i.test(id))return fail(res,400,"ID bài YouTube không hợp lệ");
      let updatedBody;
      try{updatedBody=cleanYoutubeUpdate(b);}catch(e){return fail(res,400,e.message);}
      const rows=await db("multi_publish_jobs?id=eq."+id+"&provider=eq.youtube&status=eq.queued",{
        method:"PATCH",prefer:"return=representation",body:{...updatedBody,updated_at:new Date().toISOString()}});
      if(!rows?.length)return fail(res,409,"Chỉ có thể sửa bài YouTube chưa bắt đầu tải lên");
      await audit("youtube_job_updated",{id,episode:rows[0].filename});
      return json(res,200,{ok:true,job:rows[0]});
    }
    if(path==="/jobs/retry"&&method==="POST"){
      const b=await input(req),id=String(b.id||"");
      if(!/^[0-9a-f-]{36}$/i.test(id))return fail(res,400,"ID bài YouTube không hợp lệ");
      const job=(await db("multi_publish_jobs?id=eq."+id+
        "&select=id,provider,status,remote_id,error,filename&limit=1"))?.[0];
      if(!safeYoutubeRetry(job))return fail(res,409,"Chưa xác minh an toàn để đăng lại; cần kiểm tra kênh YouTube trước");
      // A failed pre-upload OAuth/account step has no remote video. The worker
      // sets needs_review for any failure after an upload attempt has started.
      const scheduled=new Date(Date.now()+2*60000).toISOString();
      const rows=await db("multi_publish_jobs?id=eq."+id+"&provider=eq.youtube&status=eq.failed&remote_id=is.null",{
        method:"PATCH",prefer:"return=representation",
        body:{status:"queued",error:null,scheduled_at:scheduled,claimed_at:null,updated_at:new Date().toISOString()}});
      if(!rows?.length)return fail(res,409,"Bài đã đổi trạng thái; tải lại danh sách");
      await audit("youtube_retry_queued",{id,filename:job.filename,previousError:String(job.error||"").slice(0,100)});
      return json(res,200,{ok:true,scheduledAt:scheduled,note:"Đã xếp lại sau 2 phút; worker GitHub Actions phải được bật"});
    }
    if(path==="/jobs/reconcile"&&method==="POST"){
      const b=await input(req),id=String(b.id||"");
      if(!/^[0-9a-f-]{36}$/i.test(id))return fail(res,400,"ID bài YouTube không hợp lệ");
      const job=(await db("multi_publish_jobs?id=eq."+id+
        "&provider=eq.youtube&select=id,account_id,status,remote_id&limit=1"))?.[0];
      if(!job?.remote_id)return fail(res,409,"Không có YouTube video ID; kiểm tra thủ công trước khi đăng lại");
      if(!/^[A-Za-z0-9_-]{8,30}$/.test(job.remote_id))return fail(res,409,"YouTube video ID không hợp lệ");
      const account=(await db("multi_publish_accounts?id=eq."+job.account_id+
        "&provider=eq.youtube&active=eq.true&select=id,provider,secret_enc&limit=1"))?.[0];
      if(!account)return fail(res,409,"Kênh YouTube chưa được kết nối hoặc đã tắt");
      const response=await fetchJSON("https://www.googleapis.com/youtube/v3/videos?"+
        new URLSearchParams({part:"status",id:job.remote_id}),{headers:{"Authorization":"Bearer "+await accountToken(account)}});
      const remote=response.items?.[0]?.status;
      if(!remote)return fail(res,409,"YouTube chưa trả trạng thái video; không tự đăng lại");
      const state=["failed","rejected","deleted"].includes(remote.uploadStatus)?"failed":
        remote.uploadStatus==="processed"?(remote.privacyStatus==="private"?"uploaded_private":"published"):"processing";
      const before=["processing","uploading","needs_review","failed"].includes(job.status);
      let status=job.status;
      if(before){
        const rows=await db("multi_publish_jobs?id=eq."+id+
          "&status=in.(processing,uploading,needs_review,failed)",{
          method:"PATCH",prefer:"return=representation",
          body:{status:state,remote_status:{uploadStatus:remote.uploadStatus||null,
            privacyStatus:remote.privacyStatus||null},updated_at:new Date().toISOString()}});
        status=rows?.[0]?.status||job.status;
      }
      await audit("youtube_job_reconciled",{id,status,remoteId:job.remote_id});
      return json(res,200,{ok:true,status,remote:{uploadStatus:remote.uploadStatus||null,
        privacyStatus:remote.privacyStatus||null}});
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
