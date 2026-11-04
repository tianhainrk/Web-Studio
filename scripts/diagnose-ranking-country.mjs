// Bounded diagnostic: same verified PineDrama ranking route, varied public locale hints.
// Does not use tokens, cookies, proxy services, or playback endpoints.
import {parseLosslessJSON} from "../src/lossless-json.mjs";
const BASE="https://api-va.tiktokv.com/tiktok/md/mini_drama_center/v1/";
const core={aid:"845221",app_name:"tiktok_drama",app_package:"com.ss.iphone.ttmd.video",channel:"App Store",version_code:"46.6.0",app_version:"46.6.0",build_number:"466003",device_platform:"iphone",device_type:"iPhone17,3",os_version:"26.0",os_api:"26",language:"vi",app_language:"vi",locale:"vi_VN",sys_region:"VN",region:"VN",content_language:"vi",tz_name:"Asia/Ho_Chi_Minh",tz_offset:"25200",scene:"6",category_id:"0",cursor:"",count:"10"};
const tests=[
 ["baseline",{},{},null],
 ["US query region",{region:"US",sys_region:"US",locale:"en_US",language:"en",app_language:"en",content_language:"en"},{}],
 ["carrier country VN",{carrier_region:"VN",op_region:"VN",residence:"VN"},{}],
 ["country and store VN",{country:"VN",store_region:"VN",account_region:"VN"},{}],
 ["country headers VN",{},{"x-tt-country-code":"VN","x-tt-region":"VN","x-tt-store-region":"VN"}],
 ["individual header x-tt-country-code VN",{},{"x-tt-country-code":"VN"}],
 ["individual header x-tt-region VN",{},{"x-tt-region":"VN"}],
 ["all VN query hints",{carrier_region:"VN",op_region:"VN",residence:"VN",store_region:"VN",country:"VN",timezone_name:"Asia/Ho_Chi_Minh"},{}],
 ["carrier_region VN only",{carrier_region:"VN"},{}],
 ["op_region VN only",{op_region:"VN"},{}],
 ["residence VN only",{residence:"VN"},{}],
 ["carrier + op",{carrier_region:"VN",op_region:"VN"},{}],
 ["carrier + residence",{carrier_region:"VN",residence:"VN"},{}],
 ["op + residence",{op_region:"VN",residence:"VN"},{}],
 ["carrier US control",{carrier_region:"US",op_region:"US",residence:"US"},{}],
 ["minimal US (control)",{region:"US",sys_region:"US"},{}]
];
for(const [name,extra,headers] of tests){
 const u=new URL(BASE);for(const [k,v] of Object.entries({...core,...extra}))u.searchParams.set(k,v);
 try{
  const res=await fetch(u,{headers:{"User-Agent":"PineDrama/466003 CFNetwork/Darwin","Accept":"application/json",...headers},redirect:"error",signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw Error("HTTP "+res.status);
  const raw=await res.text();if(raw.length>2*1024*1024)throw Error("Oversize");
  const data=parseLosslessJSON(raw);
  if(data.status_code!==0)throw Error("status_code="+data.status_code);
  const first=data.collections?.slice(0,3).map(x=>({title:x.title,id:x.collection_id_str,heat_score:x.heat_score}));
  const probe=Object.fromEntries(Object.entries(data.extra||{}).filter(([k])=>/region|country|locale|geo/i.test(k)));
  console.log("PROFILE "+JSON.stringify({name,count:data.collections?.length,updated:data.drama_rankings_update_tsp,cursor:data.cursor,first,geoExtra:probe}));
 }catch(e){console.log("PROFILE_ERROR "+name+" "+e.message)}
 await new Promise(r=>setTimeout(r,650));
}
