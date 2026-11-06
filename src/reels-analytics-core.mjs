// Pure aggregation. Missing values are null and never coerced to 0.
export const PERIODS=new Set([7,30,90]);
export const METRICS=["views","likes","comments","shares"];
export function parseFilter(url){
  const raw=Number(url.searchParams.get("period")||30);
  if(!PERIODS.has(raw))throw Error("Chỉ hỗ trợ khoảng 7, 30 hoặc 90 ngày");
  const pageId=url.searchParams.get("pageId")||"all";
  if(pageId!=="all"&&!/^\d{1,20}$/.test(pageId))throw Error("Fanpage ID không hợp lệ");
  return {pageId,period:raw};
}
export function vietnamDay(time){
  const ms=Date.parse(time);
  if(!Number.isFinite(ms))return null;
  return new Date(ms+7*3600000).toISOString().slice(0,10);
}
export function periodDays(period,now=new Date()){
  if(!PERIODS.has(period))throw Error("Khoảng ngày không hợp lệ");
  const end=Date.parse(vietnamDay(now.toISOString())+"T00:00:00+07:00");
  return Array.from({length:period},(_,i)=>vietnamDay(new Date(end-(period-1-i)*86400000).toISOString()));
}
export function numberOrNull(v){
  return typeof v==="number"&&Number.isFinite(v)&&v>=0?v:null;
}
export function statusOf(error){
  const code=Number(error?.code||error?.status||0);
  const msg=String(error?.message||error||"").toLowerCase();
  if(code===190||code===200||code===10||msg.includes("permission")||msg.includes("access token")||msg.includes("oauth"))return "missing_permission";
  if(code===100||msg.includes("invalid metric")||msg.includes("nonexisting field")||msg.includes("does not exist"))return "unsupported";
  return "error";
}
export function snapshotLatest(snapshots){
  const map=new Map();
  for(const s of snapshots||[]){
    const key=s.page_id+":"+s.meta_video_id;
    const other=map.get(key);
    if(!other||Date.parse(s.sampled_at)>Date.parse(other.sampled_at))map.set(key,s);
  }
  return map;
}
export function attachLatest(posts,snapshots){
  const latest=snapshotLatest(snapshots);
  return (posts||[]).map(p=>{
    const snap=latest.get(p.page_id+":"+p.meta_video_id);
    return {...p,views:numberOrNull(snap?.views),likes:numberOrNull(snap?.likes),
      comments:numberOrNull(snap?.comments),shares:numberOrNull(snap?.shares),
      availability:snap?.metric_availability||{},sampledAt:snap?.sampled_at||null};
  });
}
function totals(posts,metric){
  let sum=0,known=0;
  for(const p of posts){const x=numberOrNull(p[metric]);if(x!==null){sum+=x;known++;}}
  return {value:known?sum:null,known,total:posts.length,partial:known>0&&known<posts.length};
}
export function aggregate(posts,dates){
  const set=new Set(dates);
  const relevant=posts.filter(p=>p.published_at&&set.has(vietnamDay(p.published_at)));
  const values=Object.fromEntries(METRICS.map(metric=>[metric,totals(relevant,metric)]));
  return {totalPosts:relevant.length,metrics:values};
}
export function pageComparison(pages,posts,dates){
  return pages.map(page=>{
    const scoped=posts.filter(x=>x.page_id===page.page_id);
    return {pageId:page.page_id,name:page.name,active:page.active,...aggregate(scoped,dates)};
  });
}
export function trend(daily,period,pageId,metric,now=new Date()){
  const days=periodDays(period,now);
  if(!["views","engagements","follows"].includes(metric))return days.map(date=>({date,value:null,known:0}));
  const key=metric==="views"?"media_views":metric;
  return days.map(date=>{
    const rows=daily.filter(x=>x.metric_date===date&&(pageId==="all"||x.page_id===pageId));
    const known=rows.filter(x=>numberOrNull(x[key])!==null);
    return {date,value:known.length?known.reduce((sum,x)=>sum+x[key],0):null,known:known.length,partial:rows.length>known.length};
  });
}
function median(values){
  if(!values.length)return null;
  const a=[...values].sort((x,y)=>x-y);
  return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;
}
export function reelDeltaTrend(snapshots,pageId,metric,period,now=new Date()){
  if(!METRICS.includes(metric))throw Error("Metric không được hỗ trợ");
  const days=periodDays(period,now),valid=new Set(days),groups=new Map();
  for(const snap of snapshots){
    if(pageId!=="all"&&snap.page_id!==pageId)continue;
    const val=numberOrNull(snap[metric]),day=vietnamDay(snap.sampled_at);
    if(val===null||!day)continue;
    const key=snap.page_id+":"+snap.meta_video_id,items=groups.get(key)||[];
    items.push({...snap,day,value:val});groups.set(key,items);
  }
  const perDay=new Map();
  for(const items of groups.values()){
    const bestByDay=new Map();
    for(const row of items){
      const prev=bestByDay.get(row.day);
      if(!prev||Date.parse(row.sampled_at)>Date.parse(prev.sampled_at))bestByDay.set(row.day,row);
    }
    const sorted=[...bestByDay.values()].sort((a,b)=>a.day.localeCompare(b.day));
    for(let i=1;i<sorted.length;i++){
      const row=sorted[i],prev=sorted[i-1];
      // Never invent deltas across missing calendar days.
      if(!valid.has(row.day)||(Date.parse(row.day+"T00:00:00Z")-Date.parse(prev.day+"T00:00:00Z")!==86400000))continue;
      const arr=perDay.get(row.day)||[];
      arr.push(Math.max(0,row.value-prev.value));perDay.set(row.day,arr);
    }
  }
  return days.map(date=>{
    const values=perDay.get(date)||[];
    return {date,value:values.length?values.reduce((sum,x)=>sum+x,0):null,
      known:values.length,source:"snapshot_daily_growth"};
  });
}
export function bestTimes(posts,snapshots,pageId,{minSamples=3}={}){
  const byVideo=new Map();
  for(const s of snapshots){
    if(pageId!=="all"&&s.page_id!==pageId)continue;
    const k=s.page_id+":"+s.meta_video_id;
    const bucket=byVideo.get(k)||[];bucket.push(s);byVideo.set(k,bucket);
  }
  const buckets=new Map();
  for(const p of posts){
    if((pageId!=="all"&&p.page_id!==pageId)||!p.published_at)continue;
    const published=Date.parse(p.published_at);
    const early=(byVideo.get(p.page_id+":"+p.meta_video_id)||[])
      .filter(x=>Number.isFinite(Date.parse(x.sampled_at))&&Date.parse(x.sampled_at)>=published+18*3600000&&Date.parse(x.sampled_at)<=published+48*3600000&&numberOrNull(x.views)!==null)
      .sort((a,b)=>Date.parse(a.sampled_at)-Date.parse(b.sampled_at));
    if(!early.length)continue;
    // One point per Reel nearest 24h; cannot compare raw lifetime across old/new posts.
    const selected=early.reduce((best,x)=>Math.abs(Date.parse(x.sampled_at)-published-24*3600000)<
      Math.abs(Date.parse(best.sampled_at)-published-24*3600000)?x:best);
    const vn=new Date(published+7*3600000),day=(vn.getUTCDay()+6)%7;
    const hour=vn.getUTCHours(),bin=Math.floor(hour/2)*2;
    const key=day+":"+bin;
    const vals=buckets.get(key)||[];vals.push(selected.views);buckets.set(key,vals);
  }
  const result=[];
  for(let day=0;day<7;day++)for(let hour=0;hour<24;hour+=2){
    const values=buckets.get(day+":"+hour)||[];
    result.push({weekday:day,hour,count:values.length,median24hViews:values.length>=minSamples?median(values):null,
      confidence:values.length>=8?"moderate":values.length>=minSamples?"low":"insufficient"});
  }
  return result;
}
export function recommendations(slots){
  const valid=slots.filter(x=>x.median24hViews!==null).sort((a,b)=>b.median24hViews-a.median24hViews);
  return {sufficient:valid.length>=3,minSamples:3,sampleTotal:slots.reduce((s,x)=>s+x.count,0),
    slots:valid.slice(0,5),message:valid.length>=3?"Gợi ý từ trung vị views gần 24 giờ sau đăng; chưa bảo đảm tăng lượt xem.":"Chưa đủ dữ liệu 24 giờ sau đăng để xác định khung giờ tốt riêng cho Page."};
}
export function sanitizeReel(p){
  return {id:p.id,jobId:p.job_id,pageId:p.page_id,metaVideoId:p.meta_video_id,
    episode:p.episode,filename:p.title||null,campaignId:p.campaign_id,
    publishedAt:p.published_at,permalink:p.permalink_url,
    views:p.views,likes:p.likes,comments:p.comments,shares:p.shares,
    availability:p.availability,sampledAt:p.sampledAt};
}
