import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseFilter,periodDays,vietnamDay,statusOf,snapshotLatest,attachLatest,aggregate,pageComparison,
  trend,reelDeltaTrend,bestTimes,recommendations} from "../src/reels-analytics-core.mjs";
import {probePageDaily,probeVideo,graphFetch} from "../src/reels-analytics-meta.mjs";
const date="2026-11-06T05:00:00.000Z";
const pages=[{page_id:"111",name:"Page A",active:true},{page_id:"222",name:"Page B",active:true}];
const post=(page,id,n)=>({id:page+":"+id,page_id:page,meta_video_id:id,
  published_at:"2026-11-04T12:00:00.000Z",title:"EP"+n+".mp4",episode:n});
const shots=[
  {page_id:"111",meta_video_id:"123",sampled_at:"2026-11-05T12:00:00.000Z",views:120,likes:8,comments:2,shares:3},
  {page_id:"222",meta_video_id:"123",sampled_at:"2026-11-05T13:00:00.000Z",views:75,likes:null,comments:1,shares:null},
  {page_id:"111",meta_video_id:"123",sampled_at:"2026-11-06T13:00:00.000Z",views:150,likes:9,comments:2,shares:4}
];
test("period and page ID filters enforce strict values",()=>{
  assert.deepEqual(parseFilter(new URL("https://example.test?period=30&pageId=111")),{pageId:"111",period:30});
  assert.throws(()=>parseFilter(new URL("https://example.test?period=14")));
  assert.throws(()=>parseFilter(new URL("https://example.test?pageId=not-an-id")));
  assert.equal(periodDays(7,new Date(date)).length,7);
  assert.equal(vietnamDay("2026-11-05T20:00:00.000Z"),"2026-11-06");
});
test("Reel identity includes Page ID so same Meta video ID cannot mix",()=>{
  const map=snapshotLatest(shots);
  assert.equal(map.size,2);
  const rows=attachLatest([post("111","123",1),post("222","123",1)],shots);
  assert.equal(rows[0].views,150);
  assert.equal(rows[1].views,75);
  assert.equal(rows[1].likes,null);
  const per=pageComparison(pages,rows,periodDays(7,new Date(date)));
  assert.equal(per[0].metrics.views.value,150);
  assert.equal(per[1].metrics.views.value,75);
  assert.equal(per[1].metrics.likes.value,null);
  assert.equal(per[1].metrics.likes.known,0);
});
test("missing values remain NULL, not zero, and counts track coverage",()=>{
  const rows=attachLatest([post("111","123",1),post("111","999",2)],shots);
  const result=aggregate(rows,periodDays(7,new Date(date)));
  assert.deepEqual(result.metrics.views,{value:150,known:1,total:2,partial:true});
  assert.equal(aggregate([post("111","991",2)],periodDays(7,new Date(date))).metrics.views.value,null);
  assert.equal(statusOf({status:403,code:200}),"missing_permission");
  assert.equal(statusOf({status:400,code:100}),"unsupported");
});
test("Page daily trend keeps unavailable dates empty",()=>{
  const d=[{page_id:"111",metric_date:"2026-11-06",media_views:99},
           {page_id:"222",metric_date:"2026-11-06",media_views:null}];
  const all=trend(d,7,"all","views",new Date(date));
  assert.equal(all.at(-1).value,99);
  assert.equal(all.at(-2).value,null);
  assert.equal(all.at(-1).partial,true);
});
test("Daily Reel deltas require consecutive snapshot dates",()=>{
  const values=reelDeltaTrend(shots,"111","views",7,new Date(date));
  assert.equal(values.at(-1).value,30);
  assert.equal(values.at(-2).value,null);
});
test("Posting hour recommendations require observed 24-hour samples",()=>{
  const posts=[post("111","123",1)];
  const h=bestTimes(posts,shots,"111",{minSamples:3});
  assert.ok(h.every(x=>x.median24hViews===null));
  assert.equal(recommendations(h).sufficient,false);
  assert.match(recommendations(h).message,/Chưa đủ/);
});
test("Graph request uses Authorization header, not query token",async()=>{
  let incoming;
  const fetcher=async(url,options)=>{incoming={url,options};return{
    ok:true,status:200,json:async()=>({data:[]}),headers:{get:()=>null}
  };};
  await graphFetch("/123/video_insights","very_private_token",{params:{metric:"fb_reels_total_plays"},fetcher});
  assert.doesNotMatch(incoming.url,/very_private_token/);
  assert.equal(incoming.options.headers.Authorization,"Bearer very_private_token");
});
test("Original Analytics demo remains design source and no mocked numbers reach production",()=>{
  const html=readFileSync(new URL("../public/reels-analytics.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/reels-analytics.css",import.meta.url),"utf8");
  const js=readFileSync(new URL("../public/reels-analytics.js",import.meta.url),"utf8");
  const index=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const parent=readFileSync(new URL("../public/reels.js",import.meta.url),"utf8");
  assert.match(index,/data-rd-view="analytics"/);
  assert.match(index,/id="rdAnalyticsFrame"/);
  for(const id of ["metrics","trendSvg","heatGrid","compareContent","pageTable","reelRows","mobileRows","topReels","modalStats"])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(css,/\\.heat-grid/);
  assert.match(css,/@media/);
  assert.match(js,/\/api\/reels\/analytics/);
  assert.doesNotMatch(js,/base:24000|Math\.sin|dữ liệu mẫu|data-page="a"/);
  assert.match(parent,/anpi-reels-analytics-height/);
  assert.match(parent,/analyticsEnabled/);
});
test("Analytics remains feature gated until verified Meta access",()=>{
  const api=readFileSync(new URL("../src/reels-api.mjs",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../scripts/reels-analytics-worker.mjs",import.meta.url),"utf8");
  const yaml=readFileSync(new URL("../.github/workflows/reels-analytics.yml",import.meta.url),"utf8");
  const sql=readFileSync(new URL("../supabase/reels-analytics.sql",import.meta.url),"utf8");
  assert.match(api,/read_insights/);
  assert.match(api,/REELS_ANALYTICS_ENABLED/);
  assert.match(worker,/REELS_ANALYTICS_ENABLED/);
  assert.match(yaml,/vars\.REELS_ANALYTICS_ENABLED == 'true'/);
  assert.match(sql,/enable row level security/g);
  assert.match(sql,/claim_reel_analytics_requests/);
});
