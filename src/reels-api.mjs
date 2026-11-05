import {prepareMuse,parsePlanItems,validateMuseReply,validateApprovedPlan,requestMusePlan,requestGeminiPlan,musePrompt,planSpecification} from "./muse-planner.mjs";
import {oauthState,verifyOauthState,encryptToken,db,audit,clientConfig,fetchJSON,getGoogleAccessToken,driveSeries,driveEpisodes,scheduleEpisodes,validId,requiredConfig} from "./reels-core.mjs";
const graph="https://graph.facebook.com/v26.0";
const permittedScopes="pages_show_list,pages_read_engagement,pages_manage_posts";
function json(res,status,value){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(value));}
function redirect(res,url){res.writeHead(302,{"Location":url,"Cache-Control":"no-store"});res.end();}
function fail(res,code,message){return json(res,code,{error:message});}
async function body(req){
  let data="";for await(const chunk of req){data+=chunk.toString("utf8");if(data.length>120000)throw Error("Request quá lớn");}
  return JSON.parse(data||"{}");
}
function origin(req){
  const proto=(req.headers["x-forwarded-proto"]||"https").split(",")[0];
  const host=(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0];
  if(proto!=="https"||!/^[a-zA-Z0-9.-]+(?::[0-9]{2,5})?$/.test(host))throw Error("HTTPS host không hợp lệ");
  return "https://"+host;
}
function redirectURI(req,provider){return origin(req)+"/api/reels/oauth/"+provider+"/callback";}
async function metaPageToken(pageId){
  const pages=await db("reel_pages?page_id=eq."+encodeURIComponent(pageId)+"&select=token_enc,active,name");
  if(!pages?.[0]?.active)throw Error("Fanpage chưa được kết nối hoặc đã vô hiệu hóa");
  const {decryptToken}=await import("./reels-core.mjs");
  return decryptToken(pages[0].token_enc);
}
export async function reelsRoute(req,res,path){
  try{
    const url=new URL(req.url,origin(req));
    const method=req.method;
    if(path==="/config"&&method==="GET")return json(res,200,clientConfig());
    if(path==="/oauth/google/start"&&method==="GET"){
      requiredConfig(["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","SESSION_SECRET"]);
      const p=new URL("https://accounts.google.com/o/oauth2/v2/auth");
      p.searchParams.set("client_id",process.env.GOOGLE_CLIENT_ID);
      p.searchParams.set("redirect_uri",redirectURI(req,"google"));
      p.searchParams.set("response_type","code");
      p.searchParams.set("scope","https://www.googleapis.com/auth/drive.file");
      p.searchParams.set("access_type","offline");p.searchParams.set("prompt","consent");
      p.searchParams.set("state",oauthState("google",origin(req)));
      return redirect(res,p.toString());
    }
    if(path==="/oauth/meta/start"&&method==="GET"){
      requiredConfig(["META_APP_ID","META_APP_SECRET","SESSION_SECRET"]);
      const p=new URL("https://www.facebook.com/v26.0/dialog/oauth");
      p.searchParams.set("client_id",process.env.META_APP_ID);p.searchParams.set("redirect_uri",redirectURI(req,"meta"));
      p.searchParams.set("scope",permittedScopes);p.searchParams.set("response_type","code");
      p.searchParams.set("state",oauthState("meta",origin(req)));
      return redirect(res,p.toString());
    }
    if(/^\/oauth\/(google|meta)\/callback$/.test(path)&&method==="GET"){
      const provider=path.split("/")[2],state=url.searchParams.get("state"),code=url.searchParams.get("code");
      if(!verifyOauthState(state,provider,origin(req)))return fail(res,403,"OAuth state không hợp lệ/hết hạn");
      if(!code)return fail(res,400,"OAuth chưa cấp quyền: "+(url.searchParams.get("error_description")||"Không có code"));
      if(provider==="google"){
        const form=new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectURI(req,"google"),grant_type:"authorization_code"});
        const token=await fetchJSON("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
        if(!token.refresh_token)throw Error("Google không trả refresh token; hãy cấp lại quyền với prompt consent");
        await db("reel_connections?on_conflict=provider",{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:{provider:"google",secret_enc:encryptToken(token.refresh_token),updated_at:new Date().toISOString()}});
      }else{
        const params=new URLSearchParams({client_id:process.env.META_APP_ID,redirect_uri:redirectURI(req,"meta"),client_secret:process.env.META_APP_SECRET,code});
        const short=await fetchJSON(graph+"/oauth/access_token?"+params);
        const long=await fetchJSON(graph+"/oauth/access_token?"+new URLSearchParams({grant_type:"fb_exchange_token",client_id:process.env.META_APP_ID,client_secret:process.env.META_APP_SECRET,fb_exchange_token:short.access_token}));
        const userToken=long.access_token||short.access_token;
        await db("reel_connections?on_conflict=provider",{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:{provider:"meta",secret_enc:encryptToken(userToken),updated_at:new Date().toISOString()}});
        let next=graph+"/me/accounts?"+new URLSearchParams({fields:"id,name,access_token,tasks",limit:"100",access_token:userToken});
        let count=0;
        while(next&&count++<10){
          const data=await fetchJSON(next);
          for(const page of data.data||[]){
            if(!/^\d+$/.test(String(page.id))||!page.access_token)continue;
            await db("reel_pages?on_conflict=page_id",{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",body:{page_id:String(page.id),name:String(page.name||page.id),token_enc:encryptToken(page.access_token),active:true,updated_at:new Date().toISOString()}});
          }
          next=data.paging?.next;
          if(next&&!next.startsWith(graph+"/"))next=null;
        }
      }
      await audit("oauth_connected",{provider});
      return redirect(res,origin(req)+"/?connected="+encodeURIComponent(provider)+"#reels");
    }
    if(path==="/pages"&&method==="GET"){
      const pages=await db("reel_pages?select=page_id,name,active,updated_at&order=name.asc");
      return json(res,200,{pages});
    }
    if(path==="/pages/active"&&method==="POST"){
      const b=await body(req);if(!/^\d+$/.test(String(b.pageId)))return fail(res,400,"Page ID không hợp lệ");
      const rows=await db("reel_pages?page_id=eq."+b.pageId,{method:"PATCH",prefer:"return=representation",body:{active:!!b.active,updated_at:new Date().toISOString()}});
      if(!rows?.length)return fail(res,404,"Không tìm thấy Fanpage");
      await audit("page_status",{pageId:b.pageId,active:!!b.active});return json(res,200,{ok:true});
    }
    if(path==="/pages/delete"&&method==="POST"){
      const b=await body(req);if(!/^\d+$/.test(String(b.pageId)))return fail(res,400,"Page ID không hợp lệ");
      const active=await db("reel_jobs?page_id=eq."+b.pageId+"&status=in.(queued,uploading,processing)&select=id&limit=1");
      if(active.length)return fail(res,409,"Fanpage đang có lịch chưa hoàn tất; hãy hủy lịch trước");
      await db("reel_pages?page_id=eq."+b.pageId,{method:"DELETE"});
      await audit("page_removed",{pageId:b.pageId});return json(res,200,{ok:true});
    }
    if(path==="/drive/series"&&method==="GET"){
      const token=await getGoogleAccessToken();
      return json(res,200,{series:await driveSeries(token)});
    }
    if(path==="/drive/episodes"&&method==="GET"){
      const folder=url.searchParams.get("folder")||"";
      if(!validId(folder))return fail(res,400,"Folder ID không hợp lệ");
      const token=await getGoogleAccessToken();
      return json(res,200,{episodes:await driveEpisodes(token,folder)});
    }
    if(path==="/audit"&&method==="GET"){
      const events=await db("reel_audit?select=id,action,job_id,details,created_at&order=created_at.desc&limit=100");
      return json(res,200,{events});
    }
    if(path==="/muse/prepare"&&method==="POST"){
      const request=await body(req);const prepared=await prepareMuse(request);
      return json(res,200,{prompt:prepared.prompt,entries:prepared.batch,total:prepared.spec.all.length});
    }
    if(path==="/ai/generate"&&method==="POST"){
      const request=await body(req);
      const provider=String(request.provider||"gemini");
      if(!["gemini","muse"].includes(provider))return fail(res,400,"AI provider không hợp lệ");
      const prepared=await prepareMuse(request);
      const prompt=musePrompt(prepared.spec.name,prepared.batch,prepared.spec.instructions,provider==="gemini"?"Gemini":"Muse");
      const plan=provider==="gemini"?await requestGeminiPlan(prompt,prepared.batch):await requestMusePlan(prompt,prepared.batch);
      await audit("ai_plan_drafted",{episodes:plan.map(x=>x.episode),provider});
      return json(res,200,{plan,provider,status:"draft"});
    }
    if(path==="/muse/generate"&&method==="POST"){
      const request=await body(req);const prepared=await prepareMuse(request);
      const plan=await requestMusePlan(prepared.prompt,prepared.batch);
      await audit("muse_plan_drafted",{episodes:plan.map(x=>x.episode),provider:"muse2api"});
      return json(res,200,{plan,provider:"muse2api",status:"draft"});
    }
    if(path==="/muse/parse"&&method==="POST"){
      const request=await body(req);
      const items=parsePlanItems(String(request.reply||""));
      const selected=Array.isArray(request.episodes)?[...request.episodes].map(Number).sort((a,b)=>a-b):[];
      const offset=selected.indexOf(Number(items[0]?.episode));
      if(offset<0||offset+items.length>selected.length)return fail(res,400,"JSON chứa tập ngoài danh sách đã chọn");
      const prepared=await prepareMuse({...request,offset,limit:items.length});
      const plan=validateMuseReply(String(request.reply||""),prepared.batch);
      return json(res,200,{plan,entries:prepared.batch,provider:"muse_manual",status:"draft"});
    }
    if(path==="/gemini/generate"&&method==="POST"){
      const request=await body(req);
      const prepared=await prepareMuse({...request,limit:Math.min(8,Number(request.limit)||8)},"Gemini");
      const plan=await requestGeminiPlan(prepared.prompt,prepared.batch);
      await audit("gemini_plan_drafted",{episodes:plan.map(x=>x.episode),provider:"gemini"});
      return json(res,200,{plan,entries:prepared.batch,provider:"gemini",status:"draft"});
    }
    if(path==="/campaigns"&&method==="GET"){
      const campaigns=await db("reel_campaigns?select=id,name,page_id,folder_id,start_at,per_day,spacing_minutes,status,created_at&order=created_at.desc&limit=100");
      return json(res,200,{campaigns});
    }
    if(path==="/jobs"&&method==="GET"){
      const jobs=await db("reel_jobs?select=id,campaign_id,page_id,episode,file_id,filename,caption,scheduled_at,status,meta_video_id,error,updated_at&order=scheduled_at.asc&limit=400");
      return json(res,200,{jobs});
    }
    if(path==="/campaigns/create"&&method==="POST"){
      const b=await body(req);
      if(typeof b.name!=="string"||b.name.trim().length<3||b.name.length>100)return fail(res,400,"Tên chiến dịch cần từ 3 đến 100 ký tự");
      const pageId=String(b.pageId||""),folderId=String(b.folderId||"");
      if(!/^\d+$/.test(pageId)||!validId(folderId))return fail(res,400,"Page hoặc folder ID không hợp lệ");
      const selection=Array.isArray(b.episodes)?b.episodes.map(Number):[];
      if(!selection.length||selection.length>300||selection.some(x=>!Number.isInteger(x)||x<1||x>5000)||new Set(selection).size!==selection.length)return fail(res,400,"Danh sách tập không hợp lệ");
      await metaPageToken(pageId);
      const token=await getGoogleAccessToken();const available=await driveEpisodes(token,folderId);
      const chosen=selection.map(n=>available.find(e=>e.episode===n));
      if(chosen.some(x=>!x))return fail(res,400,"Có tập không tồn tại trong Drive");
      const approved=Array.isArray(b.plan)?validateApprovedPlan(b.plan,selection):null;
      const times=approved?approved.map(x=>x.scheduledAt):scheduleEpisodes({startDate:b.startDate,time:b.time,perDay:b.perDay,spacingMinutes:b.spacingMinutes,count:chosen.length});
      if(Date.parse(times[0])<Date.now()+60000)return fail(res,400,"Ngày đăng đầu tiên cần cách hiện tại ít nhất 1 phút");
      const caption=String(b.caption||"").trim();
      if(!approved&&caption.length>2200)return fail(res,400,"Caption không được vượt 2200 ký tự");
      const campaigns=await db("reel_campaigns",{method:"POST",prefer:"return=representation",body:{name:b.name.trim(),page_id:pageId,folder_id:folderId,start_at:times[0],per_day:Number(b.perDay),spacing_minutes:Number(b.spacingMinutes),status:"active"}});
      const campaign=campaigns?.[0];if(!campaign?.id)throw Error("Không thể lưu chiến dịch");
      const jobs=chosen.map((e,i)=>({campaign_id:campaign.id,page_id:pageId,folder_id:folderId,file_id:e.id,filename:e.name,episode:e.episode,scheduled_at:times[i],caption:approved?approved[i].caption:caption.replace(/\{episode\}/g,String(e.episode)),status:"queued"}));
      try{await db("reel_jobs",{method:"POST",prefer:"return=minimal",body:jobs});}
      catch(e){await db("reel_campaigns?id=eq."+campaign.id,{method:"DELETE"});throw e;}
      await audit("campaign_created",{campaignId:campaign.id,episodes:jobs.length,pageId},null);
      return json(res,201,{ok:true,id:campaign.id,count:jobs.length});
    }
    if(path==="/jobs/cancel"&&method==="POST"){
      const b=await body(req);
      if(!/^[0-9a-f-]{36}$/i.test(String(b.id||"")))return fail(res,400,"Job ID không hợp lệ");
      const jobs=await db("reel_jobs?id=eq."+b.id+"&status=eq.queued",{method:"PATCH",prefer:"return=representation",body:{status:"cancelled",updated_at:new Date().toISOString()}});
      if(!jobs?.length)return fail(res,409,"Chỉ hủy được lịch chưa bắt đầu đăng");
      await audit("job_cancelled",{jobId:b.id},b.id);return json(res,200,{ok:true});
    }
    if(path==="/jobs/reconcile"&&method==="POST"){
      const b=await body(req);if(!/^[0-9a-f-]{36}$/i.test(String(b.id||"")))return fail(res,400,"Job ID không hợp lệ");
      const jobs=await db("reel_jobs?id=eq."+b.id+"&select=*&limit=1");
      const job=jobs?.[0];if(!job?.meta_video_id)return fail(res,409,"Chưa có Meta Video ID để đối soát");
      const token=await metaPageToken(job.page_id);
      const info=await fetchJSON(graph+"/"+encodeURIComponent(job.meta_video_id)+"?"+new URLSearchParams({fields:"status",access_token:token}));
      const status=info.status||{};
      const published=status.publishing_phase?.status==="complete"||status.video_status==="published";
      const failed=["error","upload_failed"].includes(status.video_status)||status.publishing_phase?.status==="error";
      const next=published?"published":failed?"failed":"processing";
      await db("reel_jobs?id=eq."+job.id,{method:"PATCH",body:{status:next,meta_status:status,updated_at:new Date().toISOString()}});
      await audit("job_reconciled",{jobId:job.id,status:next},job.id);
      return json(res,200,{ok:true,status:next,meta:status});
    }
    if(path==="/caption"&&method==="POST"){
      const b=await body(req);
      const provider=String(b.provider||"gemini");
      const title=String(b.title||"").slice(0,180),episode=Number(b.episode);
      if(!title||!Number.isInteger(episode)||episode<1||episode>5000)return fail(res,400,"Thiếu tên phim hoặc số tập");
      const prompt="Viết một caption Facebook Reels tự nhiên bằng tiếng Việt cho phim \""+title+"\" tập "+episode+". Tránh tiết lộ đoạn kết, không đưa tuyên bố sai, không hứa hẹn bản quyền. Ngắn gọn dưới 300 ký tự, thêm tối đa 3 hashtag; chỉ trả caption.";
      let caption;
      if(provider==="gemini"){
        requiredConfig(["GEMINI_API_KEY"]);
        const data=await fetchJSON("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(process.env.GEMINI_MODEL||"gemini-2.5-flash")+":generateContent?key="+encodeURIComponent(process.env.GEMINI_API_KEY),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:400}}),timeout:30000});
        caption=data.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
      }else if(provider==="muse"){
        requiredConfig(["MUSEAI_CAPTION_ENDPOINT","MUSEAI_API_KEY"]);
        const endpoint=new URL(process.env.MUSEAI_CAPTION_ENDPOINT);
        if(endpoint.protocol!=="https:"||!["api.muse.ai","muse.ai"].includes(endpoint.hostname))return fail(res,400,"MuseAI endpoint chưa được xác minh; chỉ chấp nhận tên miền chính thức đã cho phép");
        const data=await fetchJSON(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+process.env.MUSEAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({prompt}),timeout:30000});
        caption=String(data.caption||data.text||"");
      }else{return fail(res,400,"Provider không hợp lệ");}
      if(!caption)return fail(res,502,"AI không trả caption");
      await audit("caption_generated",{provider,title,episode});
      return json(res,200,{caption:caption.slice(0,1000),provider});
    }
    return fail(res,404,"Reels route không tồn tại");
  }catch(err){console.error("reels api",err.message);return fail(res,/Thiếu biến|không hợp lệ|chưa|không tồn tại/i.test(err.message)?400:502,err.message);}
}
