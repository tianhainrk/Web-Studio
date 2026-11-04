import {parseLosslessJSON} from "../src/lossless-json.mjs";
const host="https://api-va.tiktokv.com/tiktok/md/mini_drama_center/v1/";
const common={aid:"845221",app_name:"tiktok_drama",app_package:"com.ss.iphone.ttmd.video",channel:"App Store",version_code:"46.6.0",app_version:"46.6.0",build_number:"466003",device_platform:"iphone",device_type:"iPhone17,3",os_version:"26.0",os_api:"26",language:"vi",app_language:"vi",locale:"vi_VN",sys_region:"VN",region:"VN",content_language:"vi",tz_name:"Etc/UTC",tz_offset:"0"};
async function get(scene,cursor="",count=10){
 const url=new URL(host);
 for(const [k,v] of Object.entries({...common,scene:String(scene),category_id:"0",cursor,count:String(count)}))url.searchParams.set(k,v);
 const res=await fetch(url,{headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin","Accept":"application/json"},signal:AbortSignal.timeout(12000)});
 if(res.status!==200)throw Error("status="+res.status);
 const raw=await res.text();if(raw.length>2*1024*1024)throw Error("too large");
 const data=parseLosslessJSON(raw);
 if(data.status_code!==0)throw Error("service status="+data.status_code);
 return data;
}
for(const scene of [6,7,2]){
 let cursor="";const seen=new Set();let first=true;
 for(let page=1;page<=4;page++){
  const data=await get(scene,cursor);
  console.log("SCENE="+scene+" PAGE="+page+" COUNT="+data.collections?.length+" CURSOR="+JSON.stringify(data.cursor)+" HAS_MORE="+data.has_more+" UPDATE_TS="+data.drama_rankings_update_tsp);
  if(first){first=false;for(const row of data.collections.slice(0,5))console.log("HEAD "+JSON.stringify({id:row.collection_id_str,title:row.title,num_watched:row.num_watched,heat_score:row.heat_score,label_hot:row.label_hot}))}
  const target=data.collections?.filter(x=>x.collection_id_str==="7676268004619441173"||/sống lại gả|trọng sinh gả/i.test(x.title));
  target?.forEach(row=>console.log("TARGET "+JSON.stringify({scene,page,id:row.collection_id_str,title:row.title,num_watched:row.num_watched,heat_score:row.heat_score,all_stat_fields:Object.fromEntries(Object.entries(row).filter(([k])=>/heat|watch|score|view|rank|hot|popul|click/i.test(k)).map(([k,v])=>[k,v]))})));
  if(!data.has_more||!data.cursor||seen.has(data.cursor))break;
  seen.add(data.cursor);cursor=data.cursor;
 }
}
