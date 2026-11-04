import {reelsRoute} from "../src/reels-api.mjs";
import {discoverLibrary, FEEDS} from "../src/library.mjs";
import {discover, playlist, resolve} from "../src/provider.mjs";
import {createHmac,timingSafeEqual} from "node:crypto";
import {parseDramaBoxInput,parseDramaBoxPublicHTML} from "../src/dramadownloader-page.mjs";
import {
  DRAMABOX_FEEDS,
  validDramaBoxId,
  discoverDramaBoxLibrary,
  getDramaBoxSeriesPlaylist,
  resolveDramaBoxTarget
} from "../src/dramabox-provider.mjs";
import {
  startBackgroundTransfer,
  getTransferJob,
  listTransferJobs,
  cancelTransferJob,
  streamRemoteMP4ToDrive
} from "../src/transfer-queue.mjs";
const PASS=process.env.STUDIO_PASSWORD||"", SECRET=process.env.SESSION_SECRET||"";
function send(res,code,body,headers={}){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers});res.end(JSON.stringify(body));}
function equal(a,b){let x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)}
function sig(s){return createHmac("sha256",SECRET).update(s).digest("hex")}
function authed(req){let raw=(req.headers.cookie||"").split(";").map(s=>s.trim()).find(s=>s.startsWith("pws="));if(!raw)return false;let m=/^(\d{13})\.([a-f0-9]{64})$/.exec(raw.slice(4));return !!m&&Number(m[1])>Date.now()&&Number(m[1])<=Date.now()+86400000&&equal(m[2],sig(m[1]))}
async function input(req){let chunks=[],total=0;for await(const c of req){total+=c.length;if(total>524288)throw Error("Body too large");chunks.push(c)}return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}")}
function id(s){return /^[1-9]\d{0,18}$/.test(s||"")&&BigInt(s)<=9223372036854775807n}
const playlistCache=new Map(), streamCache=new Map();
const publicCatalogLimiter=new Map();
async function getVerifiedPlaylist(seriesId,total){
  const now=Date.now(), cached=playlistCache.get(seriesId);
  if(cached&&now-cached.time<60000&&(!total||cached.value.episodes.length===total))return cached.value;
  let result;
  if(Number.isInteger(total)&&total>=1&&total<=5000){
    try{result=await playlist({id:seriesId,episodeCount:total})}
    catch(e){
      if(e.code==="incomplete_playlist")result=await playlist({id:seriesId,episodeCount:null});
      else throw e;
    }
  }else{
    result=await playlist({id:seriesId,episodeCount:null});
  }
  playlistCache.set(seriesId,{time:now,value:result});
  return result;
}
async function getVerifiedStream(ep){
  const key=ep.seriesId+":"+ep.id, now=Date.now(), cached=streamCache.get(key);
  if(cached&&now-cached.time<120000)return cached.value;
  const value=await resolve(ep);
  streamCache.set(key,{time:now,value});
  return value;
}
export default async function handler(req,res){
  try{
    const u=new URL(req.url,"https://localhost"),p="/"+(u.searchParams.get("route")||u.pathname.replace(/^\/api(?:\/index)?\/?/,"")).replace(/^\/+/, "");
    if(p==="/health")return send(res,200,{ok:true,configured:PASS.length>=12&&SECRET.length>=32});
    if(PASS.length<12||SECRET.length<32)return send(res,503,{error:"Set STUDIO_PASSWORD (12+) and SESSION_SECRET (32+) in Vercel"});
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:"Origin rejected"});
    if(req.headers["sec-fetch-site"]==="cross-site")return send(res,403,{error:"Cross-site rejected"});
    if(p==="/login"&&req.method==="POST"){
      const data=await input(req);
      const hashed=s=>createHmac("sha256",SECRET).update(String(s)).digest("hex");
      if(!equal(hashed(data.password||""),hashed(PASS)))return send(res,401,{error:"Sai mật khẩu"});
      let exp=String(Date.now()+86400000),v=exp+"."+sig(exp);
      return send(res,200,{ok:true},{"Set-Cookie":"pws="+v+"; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400"});
    }
    if(p==="/me")return send(res,200,{authenticated:authed(req),googleClientId:authed(req)?process.env.GOOGLE_CLIENT_ID||"":""});
    if(p==="/logout"&&req.method==="POST")return send(res,200,{ok:true},{"Set-Cookie":"pws=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"});
    if(!authed(req))return send(res,401,{error:"Cần đăng nhập"});
    if(p.startsWith("/reels/"))return reelsRoute(req,res,p.slice(6));


    // Read only publicly exposed episode metadata, never video auth or private app APIs.
    if(p==="/dramadownloader/inspect"&&req.method==="POST"){
      const data=await input(req);
      let selection;
      try{selection=parseDramaBoxInput(data.target)}catch(e){return send(res,400,{error:e.message,code:"bad_target"})}
      const remote=selection.origin+"/movie/"+selection.bookId+"/drama";
      const started=Date.now();
      try{
        const upstream=await fetch(remote,{
          method:"GET",redirect:"manual",
          headers:{
            "Accept":"text/html,application/xhtml+xml",
            "User-Agent":"PineDrama-Web-Studio/1.0 (public metadata importer)"
          },
          signal:AbortSignal.timeout(12000)
        });
        if(upstream.status===401||upstream.status===403)
          return send(res,502,{code:"page_access_denied",upstreamStatus:upstream.status,
            error:"DramaBox từ chối truy cập trang phim (HTTP "+upstream.status+"). Không thể tự động lấy metadata từ nguồn này."});
        if(upstream.status>=300&&upstream.status<400)
          return send(res,502,{code:"page_redirect",upstreamStatus:upstream.status,
            error:"Trang phim chuyển hướng; không tự đi theo chuyển hướng không xác minh."});
        if(!upstream.ok)return send(res,502,{code:"upstream_http",upstreamStatus:upstream.status,error:"Trang phim HTTP "+upstream.status});
        const type=upstream.headers.get("content-type")||"";
        if(!/text\/html/i.test(type))return send(res,502,{code:"wrong_type",error:"Trang phim không trả HTML"});
        const declared=Number(upstream.headers.get("content-length")||0);
        if(declared>2*1024*1024)return send(res,502,{code:"too_large",error:"HTML vượt giới hạn 2 MiB"});
        const chunks=[];let length=0;
        if(upstream.body){
          const reader=upstream.body.getReader();
          try{
            while(true){
              const r=await reader.read();if(r.done)break;
              length+=r.value.length;
              if(length>2*1024*1024){await reader.cancel().catch(()=>{});return send(res,502,{code:"too_large",error:"HTML vượt giới hạn 2 MiB"})}
              chunks.push(Buffer.from(r.value));
            }
          }finally{reader.releaseLock()}
        }
        const series=parseDramaBoxPublicHTML(Buffer.concat(chunks).toString("utf8"),selection.bookId);
        return send(res,200,{ok:true,series,sourceUrl:remote,durationMs:Date.now()-started});
      }catch(e){
        if(e.name==="TimeoutError")return send(res,504,{code:"timeout",error:"DramaBox không phản hồi trong 12 giây"});
        return send(res,502,{code:"parse_or_network",error:String(e.message||"Không thể đọc dữ liệu trang phim").slice(0,240)});
      }
    }

    // Authenticated, allowlisted, unsigned diagnostics. Never forward session tokens or secrets.
    if(p==="/dramabox/test"&&req.method==="POST"){
      const supported=new Set(["/drama-box/ap001/bootstrap","/drama-box/he001/theater","/drama-box/he001/recommendBook","/drama-box/he001/recommendChannel","/drama-box/he001/rank","/drama-box/home/classify","/drama-box/book/tagPageInfo","/drama-box/search/index","/drama-box/search/suggest","/drama-box/search/search","/drama-box/chapterv2/detail","/drama-box/chapterv2/list","/drama-box/chapterv2/batch/load","/drama-box/chapterv2/batch/videoPath"]);
      const data=await input(req);
      const domain=String(data.base||"");
      const path=String(data.path||"");
      if(!["https://sapi.dramaboxdb.com","https://sapi.dramaboxvideo.com"].includes(domain)||!supported.has(path))
        return send(res,400,{error:"Máy chủ hoặc endpoint không được phép"});
      if(!data.body||typeof data.body!=="object"||Array.isArray(data.body))
        return send(res,400,{error:"Request body phải là JSON object"});
      const language=data.language==="en"?"en":"vi";
      const remote=domain+path+"?timestamps="+Date.now();
      const start=Date.now();
      try{
        const upstream=await fetch(remote,{
          method:"POST",redirect:"manual",
          headers:{
            "Content-Type":"application/json",
            "Accept":"application/json,text/plain,text/html",
            "User-Agent":"PineDrama-Web-Studio-API-Tester/1.0",
            "version":"700010",
            "vn":"7.0.1",
            "cid":"DRI1000000",
            "package-name":"com.storymatrix.drama",
            "language":language,
            "current-language":language,
            "country-code":"VN",
            "p":"78",
            "pline":"IOS"
          },
          body:JSON.stringify(data.body),
          signal:AbortSignal.timeout(12000)
        });
        const max=96*1024,parts=[];let total=0,truncated=false;
        if(upstream.body){
          const reader=upstream.body.getReader();
          try{
            while(true){
              const part=await reader.read();
              if(part.done)break;
              const chunk=Buffer.from(part.value);
              if(total+chunk.length>max){
                parts.push(chunk.subarray(0,Math.max(0,max-total)));
                truncated=true;
                break;
              }
              parts.push(chunk);total+=chunk.length;
            }
          }finally{
            if(truncated)await reader.cancel().catch(()=>{});
            reader.releaseLock();
          }
        }
        return send(res,200,{
          proxy:"authenticated-unsigned-diagnostic",
          remoteHost:new URL(remote).host,
          path,
          upstreamStatus:upstream.status,
          upstreamStatusText:upstream.statusText,
          upstreamContentType:upstream.headers.get("content-type")||"",
          responseBody:Buffer.concat(parts).toString("utf8"),
          truncated,
          blockedByEdge:upstream.status===403&&/Access Denied|edgesuite/i.test(Buffer.concat(parts).toString("utf8")),
          durationMs:Date.now()-start,
          note:"Không cung cấp sn/tn. HTTP 401/403 có thể là yêu cầu xác thực hoặc bộ lọc WAF."
        });
      }catch(e){
        return send(res,502,{
          error:e?.name==="TimeoutError"?"Máy chủ DramaBox không phản hồi trong 12 giây":"Không kết nối được đến máy chủ DramaBox từ Vercel",
          detail:e?.name||"NetworkError",
          durationMs:Date.now()-start
        });
      }
    }

    if(p==="/dramabox/public"&&req.method==="POST"){
      const data=await input(req);
      const routes={languages:"languages",trending:"trending",search:"search",detail:"detail"};
      const action=String(data.action||"");
      if(!Object.hasOwn(routes,action))return send(res,400,{error:"Chức năng metadata không hợp lệ"});
      const lang=["vi","en","id","ms","th","ko","ja","zh","ar","fr","de","es","pt","tr"].includes(data.lang)?data.lang:"vi";
      const query=String(data.query||"").trim();
      if(action==="search"&&(query.length<2||query.length>80))
        return send(res,400,{error:"Từ khóa phải có từ 2 đến 80 ký tự"});
      if(action==="detail"&&!/^[1-9]\d{0,18}$/.test(query))
        return send(res,400,{error:"ID phim phải là số nguyên dương"});
      const ip=String(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").split(",")[0].trim();
      const key="db-public:"+ip,now=Date.now();
      const bucket=publicCatalogLimiter.get(key)||{count:0,since:now};
      if(now-bucket.since>60000){bucket.count=0;bucket.since=now}
      if(bucket.count>=10)return send(res,429,{error:"Đã gửi 10 yêu cầu/phút. Hãy thử lại sau."});
      bucket.count++;
      publicCatalogLimiter.set(key,bucket);
      if(publicCatalogLimiter.size>500)for(const [k,v] of publicCatalogLimiter)if(now-v.since>60000)publicCatalogLimiter.delete(k);
      const remote=new URL("https://api.dramabox.asia/api/dramabox/"+routes[action]);
      if(action!=="languages")remote.searchParams.set("lang",lang);
      if(action==="search")remote.searchParams.set("q",query);
      if(action==="detail")remote.searchParams.set("id",query);
      const start=Date.now();
      try{
        const resp=await fetch(remote,{method:"GET",redirect:"manual",
          headers:{"Accept":"application/json","X-API-Key":process.env.DRAMABOX_ASIA_API_KEY||"DRAMABOX-ASIA-TRIAL"},
          signal:AbortSignal.timeout(12000)});
        const sizeLimit=120*1024;
        const chunks=[];let length=0,truncated=false;
        if(resp.body){
          const reader=resp.body.getReader();
          try{
            while(true){
              const next=await reader.read();if(next.done)break;
              const bytes=Buffer.from(next.value);
              if(length+bytes.length>sizeLimit){
                chunks.push(bytes.subarray(0,Math.max(0,sizeLimit-length)));
                truncated=true;
                break;
              }
              chunks.push(bytes);length+=bytes.length;
            }
          }finally{if(truncated)await reader.cancel().catch(()=>{});reader.releaseLock()}
        }
        const raw=Buffer.concat(chunks).toString("utf8");
        const contentType=resp.headers.get("content-type")||"";
        return send(res,200,{provider:"DramaBox+ API (third-party, unaffiliated)",
          upstreamStatus:resp.status,upstreamStatusText:resp.statusText,
          upstreamContentType:contentType,
          action,language:lang,query:action==="search"||action==="detail"?query:undefined,
          responseBody:raw,truncated,durationMs:Date.now()-start,
          note:"Nguồn metadata bên thứ ba, chưa xác minh quyền phân phối nội dung; không phải API gốc DramaBox."});
      }catch(e){
        return send(res,502,{error:"Không kết nối được DramaBox+ API",detail:e?.name||"NetworkError",durationMs:Date.now()-start});
      }
    }

    // ==================== DRAMABOX / DRAMADOWNLOADER CATALOG & EPISODES ====================
    if(p==="/dramabox/library"&&req.method==="GET"){
      const feed=u.searchParams.get("feed")||"hot";
      if(!DRAMABOX_FEEDS.includes(feed))return send(res,400,{error:"Loại danh mục DramaBox không hợp lệ"});
      const subType=u.searchParams.get("subType")||"";
      const categoryId=u.searchParams.get("categoryId")||"0";
      const page=Math.max(1,Math.min(500,Number(u.searchParams.get("page")||1)));
      const query=String(u.searchParams.get("query")||u.searchParams.get("q")||"").trim().slice(0,120);
      const lang=u.searchParams.get("lang")==="en"?"en":"vi";
      const result=await discoverDramaBoxLibrary({feed,subType,categoryId,page,query,lang});
      return send(res,200,result);
    }

    if(p==="/dramabox/resolve"&&req.method==="POST"){
      const body=await input(req);
      const target=String(body.target||body.url||body.query||"").trim();
      if(!target)return send(res,400,{error:"Vui lòng nhập link phim hoặc Book ID DramaBox"});
      const pl=await resolveDramaBoxTarget(target,{lang:"vi"});
      return send(res,200,pl);
    }

    if(p==="/dramadownloader-python"&&req.method==="POST"){
      const body=await input(req);
      const pl=await resolveDramaBoxTarget(body.target,{lang:"vi"});
      return send(res,200,{
        ok:true,
        provider:"DramaDownloader (Direct)",
        series:{
          platform:"dramabox",
          series_id:"dramabox:"+pl.id,
          name:pl.movie.title,
          poster:pl.movie.poster,
          description:pl.movie.description,
          genres:pl.movie.genres,
          episode_count:pl.episodes.length,
          reported_episode_count:pl.episodes.length,
          episodes:pl.episodes.map(e=>({
            num:e.number,
            title:e.title,
            locked:e.locked,
            direct_url:e.url,
            source_status:e.url?"python_provider_url":"python_provider_no_url"
          }))
        }
      });
    }

    let dbMatch=p.match(/^\/dramabox\/series\/(\d+)\/episodes$/);
    if(dbMatch&&req.method==="GET"){
      const bookId=validDramaBoxId(dbMatch[1]);
      if(!bookId)return send(res,400,{error:"Book ID DramaBox không hợp lệ"});
      const refresh=u.searchParams.get("refresh")==="1";
      const result=await getDramaBoxSeriesPlaylist(bookId,{refresh});
      return send(res,200,result);
    }

    dbMatch=p.match(/^\/dramabox\/series\/(\d+)\/episodes\/([^/]+)\/stream$/);
    if(dbMatch&&req.method==="GET"){
      const bookId=validDramaBoxId(dbMatch[1]);
      const epIdOrNum=decodeURIComponent(dbMatch[2]);
      if(!bookId)return send(res,400,{error:"Book ID không hợp lệ"});
      const pl=await getDramaBoxSeriesPlaylist(bookId);
      const ep=pl.episodes.find(x=>String(x.id)===epIdOrNum||String(x.number)===epIdOrNum);
      if(!ep||!ep.url)return send(res,404,{error:"Không tìm thấy luồng phát cho tập này"});
      return send(res,200,{url:ep.url,qualities:ep.qualities,mime:"video/mp4",temporary:true});
    }

    dbMatch=p.match(/^\/dramabox\/series\/(\d+)\/episodes\/([^/]+)\/drive-upload$/);
    if(dbMatch&&req.method==="POST"){
      const body=await input(req);
      const bookId=validDramaBoxId(dbMatch[1]);
      const epIdOrNum=decodeURIComponent(dbMatch[2]);
      const folderId=String(body.folderId||"").trim();
      const fileName=String(body.fileName||"").replace(/[\/\\\r\n\0]/g,"_").trim().slice(0,140);
      const accessToken=String(body.accessToken||"").trim();
      if(!bookId||!/^[a-zA-Z0-9_-]{10,128}$/.test(folderId)||!fileName||accessToken.length<16)
        return send(res,400,{error:"Thiếu thông tin thư mục Google Drive hoặc token OAuth"});
      const pl=await getDramaBoxSeriesPlaylist(bookId);
      const ep=pl.episodes.find(x=>String(x.id)===epIdOrNum||String(x.number)===epIdOrNum);
      if(!ep||!ep.url)return send(res,404,{error:"Tập không có URL video hợp lệ"});
      const uploaded=await streamRemoteMP4ToDrive({
        videoUrl:ep.url,
        userAgent:"okhttp/4.10.0",
        folderId,
        fileName,
        accessToken
      });
      return send(res,200,{ok:true,episode:ep.number,size:uploaded.size,file:uploaded.file});
    }

    // ==================== BACKGROUND TRANSFER QUEUE (SURVIVES PAGE EXIT) ====================
    if(p==="/transfer/jobs"&&req.method==="GET"){
      return send(res,200,{ok:true,jobs:listTransferJobs()});
    }

    if(p==="/transfer/status"&&req.method==="GET"){
      const jobId=u.searchParams.get("jobId")||"";
      const job=getTransferJob(jobId);
      if(!job)return send(res,404,{error:"Không tìm thấy tiến trình tải"});
      return send(res,200,{ok:true,job});
    }

    if(p==="/transfer/cancel"&&req.method==="POST"){
      const body=await input(req);
      const job=cancelTransferJob(body.jobId);
      if(!job)return send(res,404,{error:"Không tìm thấy tiến trình tải để dừng"});
      return send(res,200,{ok:true,job});
    }

    if(p==="/transfer/start"&&req.method==="POST"){
      const body=await input(req);
      const series=body.series||{};
      const source=String(series.source||series.platform||"pinedrama").toLowerCase();
      const seriesId=String(series.id||"").trim();
      const accessToken=String(body.accessToken||"").trim();
      const options=body.options||{};
      if(!seriesId||accessToken.length<16){
        return send(res,400,{error:"Thiếu ID phim hoặc Google Drive Access Token"});
      }

      let allEpisodes=[];
      if(source==="dramabox"){
        const pl=await getDramaBoxSeriesPlaylist(seriesId);
        allEpisodes=pl.episodes;
        if(!series.title)series.title=pl.movie.title;
        if(!series.poster)series.poster=pl.movie.poster;
        if(!series.description)series.description=pl.movie.description;
        if(!series.genres)series.genres=pl.movie.genres;
        series.episodeCount=allEpisodes.length;
      }else{
        const pl=await getVerifiedPlaylist(seriesId,Number(series.episodeCount)||null);
        allEpisodes=pl.episodes;
        series.episodeCount=allEpisodes.length;
      }

      if(!allEpisodes.length)return send(res,400,{error:"Danh sách tập phim trống"});

      const mode=options.mode==="range"?"range":"all";
      const fromEp=mode==="range"?Number(options.fromEpisode||1):1;
      const toEp=mode==="range"?Number(options.toEpisode||allEpisodes.length):allEpisodes.length;
      const selectedEpisodes=allEpisodes
        .filter(e=>e.number>=fromEp&&e.number<=toEp)
        .sort((a,b)=>a.number-b.number);

      if(!selectedEpisodes.length){
        return send(res,400,{error:`Không có tập nào trong khoảng ${fromEp} - ${toEp}`});
      }

      const resolveStreamUrl=async ep=>{
        if(source==="dramabox"){
          if(ep.url)return {url:ep.url,userAgent:"okhttp/4.10.0"};
          const fresh=await getDramaBoxSeriesPlaylist(seriesId,{refresh:true});
          const found=fresh.episodes.find(x=>x.number===ep.number);
          if(!found?.url)throw Error(`Tập ${ep.number} không có URL video`);
          return {url:found.url,userAgent:"okhttp/4.10.0"};
        }
        if(ep.locked)throw Error(`Tập ${ep.number} đang bị khóa trên PineDrama`);
        const video=await getVerifiedStream(ep);
        if(video.mime!=="video/mp4")throw Error("Luồng hiện tại không phải MP4 trực tiếp");
        return {url:video.url,userAgent:"PineDrama/466003 CFNetwork/Darwin"};
      };

      const job=startBackgroundTransfer({
        series:{...series,id:seriesId,source,platform:source},
        episodes:allEpisodes,
        selectedEpisodes,
        skipExisting:options.skipExisting!==false,
        accessToken,
        resolveStreamUrl
      });

      return send(res,200,{ok:true,job});
    }
    if(p==="/library"&&req.method==="GET"){
      const feed=u.searchParams.get("feed")||"home";
      if(!FEEDS.includes(feed))return send(res,400,{error:"Loại danh mục không hợp lệ"});
      const cursor=u.searchParams.get("cursor")||"";
      if(cursor.length>512)return send(res,400,{error:"Cursor quá dài"});
      const count=Number(u.searchParams.get("count")||(feed==="home"?14:feed==="new"||feed==="categories"?12:10));
      const total=Number(u.searchParams.get("total")||0);
      const ids=(u.searchParams.get("loaded")||"").split(",").filter(Boolean);
      if(ids.length>20)return send(res,400,{error:"Quá nhiều ID"});
      let filters={};
      if(feed==="categories"){
        const raw=u.searchParams.get("filters")||"{}";
        if(raw.length>512)return send(res,400,{error:"Bộ lọc quá dài"});
        try{filters=JSON.parse(raw)}catch{return send(res,400,{error:"Bộ lọc JSON không hợp lệ"})}
      }
      const result=await discoverLibrary({feed,cursor,count,loaded:ids,total,filters});
      return send(res,200,result);
    }
    if(p==="/catalog"&&req.method==="GET"){
      let count=Number(u.searchParams.get("count")||12),cursor=u.searchParams.get("cursor")||"";
      if(![12,24,50].includes(count)||cursor.length>1000)return send(res,400,{error:"Invalid count/cursor"});
      return send(res,200,await discover({count,cursor}));
    }
    let m=p.match(/^\/series\/(\d+)\/episodes$/);
    if(m&&req.method==="GET"){
      let rawTotal=u.searchParams.get("total"), total=rawTotal?Number(rawTotal):null;
      if(!id(m[1])||(total!==null&&(!Number.isInteger(total)||total<1||total>5000)))return send(res,400,{error:"Bad series"});
      if(u.searchParams.get("refresh")==="1")playlistCache.delete(m[1]);
      return send(res,200,await getVerifiedPlaylist(m[1],total));
    }
    m=p.match(/^\/series\/(\d+)\/episodes\/(\d+)\/stream$/);
    if(m&&req.method==="GET"){
      let rawTotal=u.searchParams.get("total"), total=rawTotal?Number(rawTotal):null;
      if(!id(m[1])||!id(m[2])||(total!==null&&(!Number.isInteger(total)||total<1||total>5000)))return send(res,400,{error:"Bad episode"});
      let list=await getVerifiedPlaylist(m[1],total),ep=list.episodes.find(x=>x.id===m[2]);
      if(!ep)return send(res,404,{error:"Tập không có trong danh sách xác minh"});
      if(ep.locked)return send(res,403,{error:"Tập đang bị khóa"});
      let video=await getVerifiedStream(ep);return send(res,200,{...video,temporary:true});
    }
    m=p.match(/^\/series\/(\d+)\/episodes\/(\d+)\/proxy$/);
    if(m&&(req.method==="HEAD"||req.method==="GET")){
      let rawTotal=u.searchParams.get("total"), total=rawTotal?Number(rawTotal):null;
      if(!id(m[1])||!id(m[2])||(total!==null&&(!Number.isInteger(total)||total<1||total>5000)))return send(res,400,{error:"Bad episode"});
      let list=await getVerifiedPlaylist(m[1],total),ep=list.episodes.find(x=>x.id===m[2]);
      if(!ep)return send(res,404,{error:"Tập không có trong danh sách xác minh"});
      if(ep.locked)return send(res,403,{error:"Tập đang bị khóa"});
      let video=await getVerifiedStream(ep);
      if(video.mime!=="video/mp4")return send(res,422,{error:"Luồng hiện tại không phải MP4 trực tiếp"});
      if(req.method==="HEAD"){
        const upstream=await fetch(video.url,{method:"HEAD",headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin"},signal:AbortSignal.timeout(20000)});
        if(!upstream.ok)return send(res,502,{error:"CDN từ chối HEAD: HTTP "+upstream.status});
        const len=upstream.headers.get("content-length")||"0";
        res.writeHead(200,{"Content-Type":"video/mp4","Content-Length":len,"Accept-Ranges":"bytes","Cache-Control":"no-store"});
        return res.end();
      }
      const rangeHeader=req.headers.range||u.searchParams.get("range")||"";
      const rm=/^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if(!rm)return send(res,400,{error:"Yêu cầu Range bytes=start-end"});
      const start=Number(rm[1]),end=Number(rm[2]);
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start+1>8*1024*1024)
        return send(res,400,{error:"Khoảng byte không hợp lệ hoặc vượt 8 MiB"});
      const upstream=await fetch(video.url,{method:"GET",headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin","Range":`bytes=${start}-${end}`},signal:AbortSignal.timeout(60000)});
      if(upstream.status!==206&&upstream.status!==200)return send(res,502,{error:"CDN HTTP "+upstream.status});
      const buf=Buffer.from(await upstream.arrayBuffer());
      const contentRange=upstream.headers.get("content-range")||`bytes ${start}-${start+buf.length-1}/*`;
      res.writeHead(206,{"Content-Type":"video/mp4","Content-Length":String(buf.length),"Content-Range":contentRange,"Accept-Ranges":"bytes","Cache-Control":"no-store"});
      return res.end(buf);
    }
    m=p.match(/^\/series\/(\d+)\/episodes\/(\d+)\/drive-upload$/);
    if(m&&req.method==="POST"){
      const body=await input(req);
      const rawTotal=body.total??u.searchParams.get("total"), total=rawTotal?Number(rawTotal):null;
      const folderId=String(body.folderId||"").trim();
      const fileName=String(body.fileName||"").replace(/[\/\\\r\n\0]/g,"_").trim().slice(0,140);
      const accessToken=String(body.accessToken||"").trim();
      if(!id(m[1])||!id(m[2])||(total!==null&&(!Number.isInteger(total)||total<1||total>5000)))
        return send(res,400,{error:"ID phim hoặc tập không hợp lệ"});
      if(!/^[a-zA-Z0-9_-]{10,128}$/.test(folderId)||!fileName||accessToken.length<16)
        return send(res,400,{error:"Thiếu thông tin thư mục Google Drive hoặc token OAuth"});
      const list=await getVerifiedPlaylist(m[1],total), ep=list.episodes.find(x=>x.id===m[2]);
      if(!ep)return send(res,404,{error:"Tập không có trong danh sách xác minh"});
      if(ep.locked)return send(res,403,{error:"Tập đang bị khóa"});
      const video=await getVerifiedStream(ep);
      if(video.mime!=="video/mp4")return send(res,422,{error:"Luồng hiện tại không phải MP4 trực tiếp"});
      const upstream=await fetch(video.url,{method:"GET",headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin"},signal:AbortSignal.timeout(90000)});
      if(!upstream.ok)return send(res,502,{error:"Không tải được luồng video từ CDN (HTTP "+upstream.status+")"});
      const bytes=new Uint8Array(await upstream.arrayBuffer());
      if(!bytes.byteLength||bytes.byteLength>120*1024*1024)
        return send(res,502,{error:"Kích thước video không hợp lệ ("+bytes.byteLength+" bytes)"});
      const initRes=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,parents",{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+accessToken,
          "Content-Type":"application/json; charset=UTF-8",
          "X-Upload-Content-Type":"video/mp4",
          "X-Upload-Content-Length":String(bytes.byteLength)
        },
        body:JSON.stringify({name:fileName,parents:[folderId]}),
        signal:AbortSignal.timeout(30000)
      });
      if(!initRes.ok){
        const errBody=await initRes.json().catch(()=>({}));
        return send(res,initRes.status===401||initRes.status===403?401:502,{error:errBody.error?.message||"Google Drive từ chối mở phiên tải lên (HTTP "+initRes.status+")"});
      }
      const location=initRes.headers.get("Location");
      if(!location||!location.startsWith("https://www.googleapis.com/"))
        return send(res,502,{error:"Google Drive không trả về URL phiên resumable"});
      const putRes=await fetch(location,{
        method:"PUT",
        headers:{
          "Content-Type":"video/mp4",
          "Content-Length":String(bytes.byteLength)
        },
        body:bytes,
        signal:AbortSignal.timeout(120000)
      });
      if(putRes.status!==200&&putRes.status!==201){
        const errText=await putRes.text().catch(()=>"");
        return send(res,502,{error:"Google Drive lỗi khi ghi video (HTTP "+putRes.status+"): "+errText.slice(0,120)});
      }
      const meta=await putRes.json().catch(()=>({}));
      return send(res,200,{ok:true,episode:ep.number,size:bytes.byteLength,file:meta});
    }
    return send(res,404,{error:"API not found"});
  }catch(e){console.error("pws",e.code||"error",e.message);return send(res,e.code==="locked"?403:502,{error:e.message||"Lỗi máy chủ",code:e.code||"error"})}
}
