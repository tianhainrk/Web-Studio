import {parseLosslessJSON} from "./lossless-json.mjs";
// Native PineDrama library endpoints verified in AnPinime's 2026-11-02 library audit.
// Metadata-only client: bounded requests, no cookies, no auth bypass, no media downloads.
import {decodeCatalog, ProviderError, numericID} from "./provider.mjs";

export const FEEDS = Object.freeze(["home","hot","ranking","new","categories"]);
const SOURCE="https://api-va.tiktokv.com";
const TIMEOUT_MS=12000;
const MAX_BODY=2*1024*1024;
const markerNames=["all_settings","all_characters","all_stories","all_releases"];
const categoriesCache={time:0,value:null};
export const common=()=>({
  aid:"845221",app_name:"tiktok_drama",app_package:"com.ss.iphone.ttmd.video",
  channel:"App Store",version_code:"46.6.0",app_version:"46.6.0",build_number:"466003",
  device_platform:"iphone",device_type:process.env.PINE_DEVICE_TYPE||"iPhone17,3",
  os_version:process.env.PINE_OS_VERSION||"26.0",os_api:process.env.PINE_OS_API||"26",
  language:"vi",app_language:"vi",locale:"vi_VN",sys_region:"VN",region:"VN",
  // Verified 2026-11-02: carrier_region=VN selects the native Vietnamese top-hot list.
  // region/sys_region alone only localize titles, not the ranking's country.
  carrier_region:process.env.PINE_CARRIER_REGION||"VN",
  content_language:"vi",tz_name:process.env.PINE_TZ_NAME||"Etc/UTC",tz_offset:process.env.PINE_TZ_OFFSET||"0"
});

export function parseJSONResponse(data) {
  if(!data || typeof data!=="object" || Array.isArray(data))throw new ProviderError("Phản hồi danh mục không hợp lệ","invalid_json");
  return decodeCatalog(data);
}
async function request(path,params={},body=null){
  const url=new URL("/tiktok/md/"+path,SOURCE);
  for(const [k,v] of Object.entries({...common(),...params}).sort(([a],[b])=>a.localeCompare(b)))
    url.searchParams.set(k,String(v));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),TIMEOUT_MS);
  try{
    const response=await fetch(url,{
      method:body===null?"GET":"POST",
      headers:{
        "User-Agent":"PineDrama/466003 CFNetwork/Darwin",
        "Accept":"application/json",
        ...(body===null?{}:{"Content-Type":"application/json","Agw-Js-Conv":"str"})
      },
      body:body===null?undefined:JSON.stringify(body),
      redirect:"manual",signal:abort.signal
    });
    if(response.status!==200)throw new ProviderError("PineDrama HTTP "+response.status,"upstream_http");
    if(Number(response.headers.get("content-length")||0)>MAX_BODY)throw new ProviderError("Phản hồi quá lớn","limit");
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length===0||bytes.length>MAX_BODY)throw new ProviderError("Phản hồi rỗng/quá lớn","limit");
    let data;
    try{data=parseLosslessJSON(bytes)}catch{throw new ProviderError("PineDrama trả về JSON không hợp lệ","invalid_json")}
    if(data.status_code!==0||(data.biz_code!=null&&data.biz_code!==0))
      throw new ProviderError("PineDrama từ chối truy vấn danh mục","upstream_denied");
    return data;
  } catch(e){
    if(e instanceof ProviderError)throw e;
    throw new ProviderError(e.name==="AbortError"?"PineDrama timeout":"Không kết nối được PineDrama","network");
  } finally{clearTimeout(timer)}
}
export function catalogPlan({feed="home",cursor="",count=null,loaded=[],total=0}={}){
  if(!FEEDS.includes(feed)||feed==="categories")throw new ProviderError("Feed không hợp lệ","invalid_feed");
  if(typeof cursor!=="string"||cursor.length>512)throw new ProviderError("Cursor không hợp lệ","bad_cursor");
  if(feed==="home"){
    if(![14,24,50].includes(Number(count??14)))throw new ProviderError("Trang chủ hỗ trợ 14, 24, 50 phim","invalid_count");
    if(!Array.isArray(loaded)||loaded.length>20||loaded.some(x=>{try{numericID(x);return false}catch{return true}})||new Set(loaded).size!==loaded.length)
      throw new ProviderError("Danh sách ID trang trước không hợp lệ","invalid_ids");
    if(!Number.isSafeInteger(total)||total<0||total>5000||(total>0&&!loaded.length)||(!total&&loaded.length))
      throw new ProviderError("Trạng thái tải thêm không hợp lệ","invalid_count");
    return {path:"mini_drama_center/v1/",params:{
      scene:"1",category_id:"0",cursor:"",count:String(count??14),
      drama_request_type:total>0?"load_more":"init_fetch",
      drama_current_collections:loaded.join(","),
      collection_count_in_session:String(total)
    }};
  }
  const scene={hot:"6",ranking:"7",new:"8"}[feed];
  const size=Number(count??(feed==="new"?12:10));
  // Native "New Works" uses a 7-day feed scene=8 with count=12.
  // Do not add recent_days=7; that parameter belongs to category_filter/v1 POST.
  if(feed==="new"&&size!==12)throw new ProviderError("Tác phẩm mới chỉ hỗ trợ count=12 theo ứng dụng gốc","invalid_count");
  if(feed!=="new"&&![10,12].includes(size))throw new ProviderError("Bảng xếp hạng chỉ hỗ trợ 10 hoặc 12 phim","invalid_count");
  return {path:"mini_drama_center/v1/",params:{
    scene,category_id:"0",cursor,count:String(size)
  }};
}
export function summarizeCategories(data){
  const lists=data.category_filter_lists;
  if(!Array.isArray(lists)||lists.length!==4)
    throw new ProviderError("PineDrama chưa trả đủ 4 nhóm thể loại","invalid_categories");
  return lists.map((group,index)=>{
    const options=group.category_filters;
    if(!Array.isArray(options)||!options.length||options[0].name_en!==markerNames[index])
      throw new ProviderError("Cấu trúc nhóm thể loại chưa được xác minh","invalid_categories");
    const seen=new Set();
    const normalized=options.map((raw,i)=>{
      const type=Number(raw.filter_type);
      const title=typeof raw.name==="string"?raw.name.trim():"";
      let id="";
      if(type===1&&i===0&&String(raw.category_id)==="0") id="all";
      else if(type===2&&index<3)id=numericID(raw.category_id);
      else if(type===3&&index===3&&[7,30].includes(Number(raw.recent_days)))id="days:"+raw.recent_days;
      else throw new ProviderError("Bộ lọc PineDrama không hợp lệ","invalid_categories");
      if(!title||seen.has(id))throw new ProviderError("Tên/ID bộ lọc không hợp lệ","invalid_categories");
      seen.add(id);
      return {id,title,raw};
    });
    return {key:["background","character","story","release"][index],
      title:options[0].name, options:normalized};
  });
}
let categoryFirstResponse=null;
async function getCategoryMetadata(){
  if(categoriesCache.value&&Date.now()-categoriesCache.time<5*60*1000)
    return categoriesCache.value;
  const data=await request("mini_drama/category_filter/v1/",{},{
    category_filters:[],cursor:"",count:12
  });
  const groups=summarizeCategories(data);
  categoriesCache.value=groups;categoriesCache.time=Date.now();
  categoryFirstResponse=data;
  return groups;
}
export function categoryRequestBody(groups,choice={},cursor=""){
  if(typeof cursor!=="string"||cursor.length>512)throw new ProviderError("Cursor không hợp lệ","bad_cursor");
  const chosenKeys=["background","character","story","release"];
  if(!choice||typeof choice!=="object"||Array.isArray(choice))throw new ProviderError("Bộ lọc không hợp lệ","invalid_categories");
  if(Object.keys(choice).some(key=>!chosenKeys.includes(key)))
    throw new ProviderError("Khóa thể loại không hợp lệ","invalid_categories");
  let selected=false;
  const picks=groups.map(group=>{
    const value=choice[group.key]||"all";
    const option=group.options.find(o=>o.id===value);
    if(!option)throw new ProviderError("Bộ lọc không tồn tại trên PineDrama","invalid_categories");
    if(value!=="all")selected=true;
    return option.raw;
  });
  return {body:{category_filters:selected?picks:[],cursor,count:12},selected};
}
function publicGroups(groups){return groups.map(g=>({
  key:g.key,title:g.title,options:g.options.map(o=>({id:o.id,title:o.title}))
}))}
export function enrichCatalog(data,extra={}){
  const page=parseJSONResponse(data);
  return {...page,mode:"live",...extra,movies:page.movies.map((m,index)=>{
    const row=data.collections[index]||{};
    const views=Number(row.num_watched);
    const heat=Number(row.heat_score);
    return {...m,
      viewCount:row.num_watched!=null&&Number.isSafeInteger(views)&&views>=0?views:null,
      heatScore:row.heat_score!=null&&Number.isSafeInteger(heat)&&heat>=0?heat:null,
      genres:typeof row.categories==="string"?row.categories:""};
  }),
  rankingUpdatedAt:Number.isSafeInteger(Number(data.drama_rankings_update_tsp))&&Number(data.drama_rankings_update_tsp)>0?Number(data.drama_rankings_update_tsp):null
  };
}
export async function discoverLibrary({feed="home",cursor="",count=null,loaded=[],total=0,filters={}}={}){
  if(feed==="categories"){
    const groups=await getCategoryMetadata();
    const {body,selected}=categoryRequestBody(groups,filters,cursor);
    const data=(!selected&&!cursor&&categoryFirstResponse)?categoryFirstResponse:
      await request("mini_drama/category_filter/v1/",{},body);
    if(!selected&&!cursor)categoryFirstResponse=null;
    return enrichCatalog(data,{feed,categoryGroups:publicGroups(groups)});
  }
  const plan=catalogPlan({feed,cursor,count,loaded,total});
  const data=await request(plan.path,plan.params);
  return enrichCatalog(data,{
    feed,
    sourceScene:Number(plan.params.scene),
    effectiveRegion:common().carrier_region,
    periodDays:feed==="new"?7:null
  });
}
