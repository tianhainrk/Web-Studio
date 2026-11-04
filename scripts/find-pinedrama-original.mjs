// Bounded, read-only inspection of the original mini-drama public catalog response.
// Never logs tokens, cookies, full URLs, media or raw service payloads.
import {discoverLibrary} from "../src/library.mjs";
import {parseLosslessJSON} from "../src/lossless-json.mjs";
const target="trong sinh ga cho chong kiep truoc";
const normalize=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const words=target.split(" ");
const matches=s=>{const a=normalize(s);return a.includes(target)||words.filter(w=>a.includes(w)).length>=5||(a.includes("trong sinh")&&a.includes("chong"))};
let total=0,duplicates=0,hits=[];
for(const feed of ["hot","ranking","new","categories","home"]){
 let cursor="",loaded=[],visited=new Set(),seen=new Set(),hasMore=true,stopped="";
 const limit={hot:10,ranking:8,new:8,categories:5,home:4}[feed];
 for(let page=0;page<limit&&hasMore;page++){
  try{
    const data=await discoverLibrary({feed,cursor,count:feed==="home"?14:feed==="new"||feed==="categories"?12:10,loaded:loaded.slice(-20),total:loaded.length});
    const before=seen.size;
    for(const row of data.movies){
      total++;
      if(seen.has(row.id)){duplicates++;continue;}
      seen.add(row.id);loaded.push(row);
      if(matches(row.title)){
        hits.push({feed,page:page+1,id:row.id,title:row.title,num_watched:row.viewCount,rank:page*10+data.movies.indexOf(row)+1});
      }
    }
    if(page===0)console.log("FEED "+feed+" first titles: "+data.movies.slice(0,3).map(m=>m.title).join(" | "));
    console.log("SCAN "+feed+" page="+(page+1)+" rows="+data.movies.length+" unique="+seen.size+" cursor="+(data.nextCursor||"[empty]")+" more="+data.serverHasMore);
    hasMore=data.serverHasMore;
    if(feed==="home"){if(seen.size===before){stopped="no new IDs";break;}}
    else{
      if(!data.nextCursor||visited.has(data.nextCursor)||cursor===data.nextCursor){stopped="no advancing cursor";break}
      visited.add(data.nextCursor);cursor=data.nextCursor;
    }
  }catch(e){stopped=e.code+" "+e.message;break}
 }
 console.log("FEED_SUMMARY "+feed+" unique="+seen.size+" stopped="+stopped);
}
console.log("TARGET_MATCHES "+JSON.stringify(hits));
console.log("TOTAL_ROWS "+total+" DUPLICATES "+duplicates);
// Inspect raw public catalog metadata keys: no media URLs, no personal data.
const base="https://api-va.tiktokv.com/tiktok/md/mini_drama_center/v1/";
const params={
aid:"845221",app_name:"tiktok_drama",app_package:"com.ss.iphone.ttmd.video",channel:"App Store",
version_code:"46.6.0",app_version:"46.6.0",build_number:"466003",device_platform:"iphone",
device_type:"iPhone17,3",os_version:"26.0",os_api:"26",language:"vi",app_language:"vi",
locale:"vi_VN",sys_region:"VN",region:"VN",content_language:"vi",tz_name:"Asia/Ho_Chi_Minh",tz_offset:"25200",
scene:"6",category_id:"0",cursor:"",count:"10"
};
try{
 const u=new URL(base);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 const response=await fetch(u,{headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin","Accept":"application/json"},signal:AbortSignal.timeout(12000)});
 const raw=await response.text();
 if(raw.length>2*1024*1024)throw Error("oversized response");
 const data=parseLosslessJSON(raw);
 const row=data.collections?.[0]||{};
 const keys=Object.keys(row).filter(k=>/(watch|view|play|rank|hot|score|heat|popul|count|stat|metric|like|collect)/i.test(k));
 console.log("RAW_STATS_FIELDS "+JSON.stringify(Object.fromEntries(keys.map(k=>[k,typeof row[k]==="object"?"[complex data]":String(row[k]).slice(0,60)]))));
 console.log("RAW_TOPLEVEL_FIELDS "+Object.keys(data).join(","));
}catch(e){console.log("RAW_STATS_ERROR "+e.message)}
// Alternate 'scene=2' is explicitly NOT the top-hot ranking, but helps inspect source variation.
try{
 const u=new URL(base);for(const [k,v] of Object.entries({...params,scene:"2"}))u.searchParams.set(k,v);
 const response=await fetch(u,{headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin"},signal:AbortSignal.timeout(12000)});
 const raw=await response.text();if(raw.length>2*1024*1024)throw Error("oversized");
 const data=parseLosslessJSON(raw);
 const rows=data.collections||[];
 console.log("SCENE2 count="+rows.length+" status="+data.status_code+" titles="+rows.slice(0,8).map(r=>r.title).join(" | "));
 const match=rows.filter(r=>matches(r.title));
 console.log("SCENE2_TARGET "+JSON.stringify(match.map(r=>({id:String(r.collection_id_str||r.collection_id),title:r.title,num_watched:r.num_watched}))));
}catch(e){console.log("SCENE2_ERROR "+e.message)}
