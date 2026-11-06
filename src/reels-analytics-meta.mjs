import {statusOf,numberOrNull} from "./reels-analytics-core.mjs";
const GRAPH="https://graph.facebook.com/v26.0";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=ms=>Math.min(15000,Math.max(500,ms));
export const PAGE_METRICS=[
  {name:"page_media_view",column:"media_views",period:"day"},
  {name:"page_post_engagements",column:"engagements",period:"day"},
  {name:"page_daily_follows_unique",column:"follows",period:"day"}
];
export const VIDEO_METRICS=["fb_reels_total_plays","blue_reels_play_count"];
export class MetaAnalyticsError extends Error{
  constructor(message,status,code){super(message);this.name="MetaAnalyticsError";this.status=status;this.code=code;}
}
export async function graphFetch(path,token,{params={},attempts=3,fetcher=fetch}={}){
  if(typeof token!=="string"||!token)throw Error("Meta Page token chưa sẵn sàng");
  if(!/^\/[A-Za-z0-9_./-]+$/.test(path))throw Error("Đường dẫn Meta không hợp lệ");
  const url=new URL(GRAPH+path);
  for(const [key,value] of Object.entries(params))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  for(let attempt=0;attempt<attempts;attempt++){
    let response;
    try{response=await fetcher(url.toString(),{headers:{"Authorization":"Bearer "+token},signal:AbortSignal.timeout(18000)});}
    catch(error){
      if(attempt<attempts-1){await sleep(wait(550*(attempt+1)**2));continue;}
      throw new MetaAnalyticsError("Meta không phản hồi",503,0);
    }
    let data=null;
    try{data=await response.json();}catch{}
    if(response.ok&&!data?.error)return data||{};
    const code=data?.error?.code||response.status;
    const isRetry=response.status===429||response.status>=500||code===4||code===17||code===32||code===613;
    if(isRetry&&attempt<attempts-1){
      const retryAfter=Number(response.headers?.get?.("retry-after")||0);
      await sleep(wait(retryAfter?retryAfter*1000:700*(attempt+1)**2));continue;
    }
    throw new MetaAnalyticsError(
      // Safe, short classification only; raw Graph response may contain sensitive identifiers.
      isRetry?"Meta tạm giới hạn lưu lượng":
      code===190?"Meta access token không hợp lệ/hết hạn":
      code===10||code===200?"Meta từ chối quyền truy cập": 
      code===100?"Meta không hỗ trợ trường/metric này":"Meta trả về lỗi HTTP "+response.status,
      response.status,code
    );
  }
}
function metricNumber(data,name){
  const obj=(data?.data||[]).find(x=>x.name===name)||data?.data?.[0];
  if(!obj)return null;
  const value=obj.total_value?.value??obj.values?.at(-1)?.value;
  return numberOrNull(value);
}
export async function probeVideo(videoId,token){
  const availability={},metric_values={};
  let views=null,likes=null,comments=null,shares=null;
  let viewMetric=null,permalink=null,postId=null;
  // One metric per request: a deprecated value must not invalidate other probes.
  for(const metric of VIDEO_METRICS){
    try{
      const data=await graphFetch("/"+videoId+"/video_insights",token,{params:{metric}});
      const v=metricNumber(data,metric);
      availability[metric]=v===null?"no_data":"supported";
      if(v!==null){metric_values[metric]=v;if(views===null){views=v;viewMetric=metric;}}
    }catch(error){availability[metric]=statusOf(error);}
    if(views!==null)break;
  }
  // Probe metadata separately. A video ID is NOT assumed to equal its post ID.
  for(const field of ["permalink_url","post_id"]){
    try{
      const meta=await graphFetch("/"+videoId,token,{params:{fields:field}});
      const value=meta[field];
      availability[field]=value?"supported":"no_data";
      if(field==="permalink_url"&&typeof value==="string"&&/^https:\/\/(www\.|m\.)?facebook\.com\//.test(value))permalink=value.slice(0,1024);
      if(field==="post_id"&&/^[0-9_]+$/.test(String(value||"")))postId=String(value);
    }catch(e){availability[field]=statusOf(e);}
  }
  // Likes/comments/shares can require the POST object instead of the video object.
  for(const [metric,query] of [
    ["likes","likes.limit(0).summary(true)"],
    ["comments","comments.limit(0).summary(true)"],
    ["shares","shares"]
  ]){
    const target=postId||videoId;
    try{
      const data=await graphFetch("/"+target,token,{params:{fields:query}});
      const value=metric==="shares"?data.shares?.count:data[metric]?.summary?.total_count;
      const n=numberOrNull(value);
      availability[metric]=n===null?"no_data":"supported";
      if(metric==="likes")likes=n;else if(metric==="comments")comments=n;else shares=n;
    }catch(error){availability[metric]=statusOf(error);}
  }
  if(views===null&&availability[VIDEO_METRICS[0]]==="missing_permission")
    availability.views="missing_permission";
  else availability.views=views===null?"no_data":"supported";
  metric_values.view_source=viewMetric;
  return {views,likes,comments,shares,availability,metric_values,permalink,postId};
}
export async function probePageDaily(pageId,token,{since,until}={}){
  const daily=new Map(),availability={};
  for(const {name,column,period} of PAGE_METRICS){
    try{
      const response=await graphFetch("/"+pageId+"/insights",token,{params:{metric:name,period,since,until}});
      const data=(response.data||[]).find(x=>x.name===name);
      const values=data?.values||[];
      availability[name]=values.length?"supported":"no_data";
      for(const item of values){
        const end=Date.parse(item.end_time||"");
        const date=Number.isFinite(end)?new Date(end-86400000).toISOString().slice(0,10):null;
        const val=numberOrNull(item.value);
        if(!date||val===null)continue;
        const row=daily.get(date)||{metric_date:date,media_views:null,engagements:null,follows:null,
          metric_values:{},metric_availability:{}};
        row[column]=val;row.metric_values[name]=val;row.metric_availability[name]="supported";daily.set(date,row);
      }
    }catch(error){availability[name]=statusOf(error);}
  }
  // Preserve missing values, not zero, and attach why a metric was unavailable.
  for(const row of daily.values())for(const {name} of PAGE_METRICS)
    if(!row.metric_availability[name])row.metric_availability[name]=availability[name]||"no_data";
  return {rows:[...daily.values()],availability};
}
export async function probePageCapabilities(pageId,token,videoId=null){
  let identity=null,identityStatus="no_data",followerCount=null;
  try{
    identity=await graphFetch("/"+pageId,token,{params:{fields:"id,name,followers_count"}});
    identityStatus="supported";
    followerCount=numberOrNull(identity.followers_count);
  }catch(error){
    identityStatus=statusOf(error);
    try{identity=await graphFetch("/"+pageId,token,{params:{fields:"id,name"}});identityStatus="supported";}
    catch(e){identityStatus=statusOf(e);}
  }
  const until=new Date().toISOString().slice(0,10);
  const since=new Date(Date.now()-4*86400000).toISOString().slice(0,10);
  const daily=await probePageDaily(pageId,token,{since,until});
  const video=videoId?await probeVideo(videoId,token):null;
  return {pageId,name:identity?.name||null,identityStatus,followerCount,
    pageMetrics:daily.availability,videoMetrics:video?.availability||null,
    checkedAt:new Date().toISOString()};
}
