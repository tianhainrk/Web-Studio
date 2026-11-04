// Read-only bounded diagnostics for PineDrama New Works (native scene=8).
// No auth, session, media, or video data; no source repository changes.
import {parseLosslessJSON} from "../src/lossless-json.mjs";
const URL_BASE="https://api-va.tiktokv.com/tiktok/md/mini_drama_center/v1/";
const base={aid:"845221",app_name:"tiktok_drama",app_package:"com.ss.iphone.ttmd.video",channel:"App Store",version_code:"46.6.0",app_version:"46.6.0",build_number:"466003",device_platform:"iphone",device_type:"iPhone17,3",os_version:"26.0",os_api:"26",language:"vi",app_language:"vi",locale:"vi_VN",sys_region:"VN",region:"VN",content_language:"vi",tz_name:"Asia/Ho_Chi_Minh",tz_offset:"25200",scene:"8",category_id:"0",cursor:"",count:"12"};
const conditions=[
  ["baseline",{}],
  ["carrier_region=VN",{carrier_region:"VN"}],
  ["carrier_region=US",{carrier_region:"US"}],
  ["op_region=VN",{op_region:"VN"}],
  ["residence=VN",{residence:"VN"}],
  ["country=VN",{country:"VN"}],
  ["store_region=VN",{store_region:"VN"}],
  ["carrier_region=VN,count=10",{carrier_region:"VN",count:"10"}],
  ["carrier_region=VN,recent_days=7 (non-native)",{carrier_region:"VN",recent_days:"7"}],
  ["carrier_region=VN,scene=7 (ranking latest comparison)",{carrier_region:"VN",scene:"7"}]
];
const newest={};
for(const [name,diff] of conditions){
 const u=new URL(URL_BASE);
 for(const [k,v] of Object.entries({...base,...diff}))u.searchParams.set(k,v);
 try{
   const response=await fetch(u,{headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin","Accept":"application/json"},redirect:"error",signal:AbortSignal.timeout(12000)});
   if(response.status!==200)throw Error("HTTP "+response.status);
   const raw=await response.text();
   if(raw.length>2*1024*1024)throw Error("too much data");
   const data=parseLosslessJSON(raw);
   if(data.status_code!==0)throw Error("status_code "+data.status_code);
   const rows=Array.isArray(data.collections)?data.collections:[];
   const first=rows.slice(0,8).map(row=>({title:row.title,id:String(row.collection_id_str||row.collection_id),num_watched:row.num_watched,heat_score:row.heat_score,create_time:row.create_time,release_time:row.release_time}));
   newest[name]=new Set(rows.map(x=>String(x.collection_id_str||x.collection_id)));
   console.log("NEW_WORKS_RESULT "+JSON.stringify({name,count:rows.length,hasMore:data.has_more,cursor:data.cursor,rankingUpdatedAt:data.drama_rankings_update_tsp,first}));
   const metadata=rows[0]||{};
   console.log("META_KEYS "+name+" "+JSON.stringify(Object.keys(metadata).filter(k=>/time|date|release|publish|updated|new|country|region/i.test(k))));
 }catch(e){console.log("NEW_WORKS_ERROR "+name+" "+String(e.message).slice(0,120))}
 await new Promise(r=>setTimeout(r,450));
}
const baseIDs=newest["baseline"]||new Set(),vietnamIDs=newest["carrier_region=VN"]||new Set();
console.log("COMPARISON "+JSON.stringify({baselineCount:baseIDs.size,vietnamCount:vietnamIDs.size,same:[...baseIDs].filter(id=>vietnamIDs.has(id)).length,onlyVietnam:[...vietnamIDs].filter(id=>!baseIDs.has(id)).slice(0,10)}));
const firstURL=new URL(URL_BASE);
for(const [k,v] of Object.entries({...base,carrier_region:"VN"}))firstURL.searchParams.set(k,v);
try{
 const res=await fetch(firstURL,{headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin"},signal:AbortSignal.timeout(12000)});
 const data=parseLosslessJSON(await res.text());
 if(data.has_more&&data.cursor){
  const nextURL=new URL(firstURL);nextURL.searchParams.set("cursor",data.cursor);
  const response=await fetch(nextURL,{headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin"},signal:AbortSignal.timeout(12000)});
  const second=parseLosslessJSON(await response.text());
  const a=new Set((data.collections||[]).map(x=>String(x.collection_id_str||x.collection_id)));
  const b=new Set((second.collections||[]).map(x=>String(x.collection_id_str||x.collection_id)));
  console.log("NEW_WORKS_PAGE2 "+JSON.stringify({first:a.size,second:b.size,uniqueAdditional:[...b].filter(x=>!a.has(x)).length,cursor:second.cursor,hasMore:second.has_more,titles:(second.collections||[]).slice(0,5).map(x=>x.title)}));
 }
}catch(e){console.log("NEW_WORKS_PAGE2_ERROR "+e.message)}
