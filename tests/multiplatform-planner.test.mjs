import test from "node:test";
import assert from "node:assert/strict";
import {prepareYouTubeAiRequest,youtubeAiPrompt,youtubeAiRequest,normalizeYouTubeAiDraft,
  safeYoutubeRetry,cleanYoutubeUpdate,YOUTUBE_AI_BATCH_LIMIT} from "../src/multiplatform-planner.mjs";

const now=Date.parse("2026-11-07T02:00:00Z");
const items=[
  {episode:1,filename:"EP001.mp4",scheduledAt:"2026-11-08T02:00:00Z"},
  {episode:2,filename:"EP002.mp4",scheduledAt:"2026-11-08T04:00:00Z"}
];
const base={seriesTitle:"Trùng Sinh, Tôi Chỉ Muốn Làm Giàu",instructions:"Ngắn, rõ, có hashtag",items};
const reply=(times=["09:15","11:10"])=>JSON.stringify({items:[
  {episode:1,title:"Trùng Sinh Tập 1 #Shorts",description:"Tập đầu trong series. #Shorts",publishTime:times[0]},
  {episode:2,title:"Trùng Sinh Tập 2 #Shorts",description:"Tiếp tục theo dõi câu chuyện. #Shorts",publishTime:times[1]}
]});

test("AI validates exact episode batch, metadata and future Vietnamese schedule",()=>{
  const parsed=prepareYouTubeAiRequest(base,{now});
  assert.equal(parsed.items.length,2);
  assert.equal(YOUTUBE_AI_BATCH_LIMIT,8);
  assert.throws(()=>prepareYouTubeAiRequest({...base,items:[...items,items[0]]},{now}),/trùng|tăng dần/);
  assert.throws(()=>prepareYouTubeAiRequest({...base,items:[{...items[0],filename:"other.mp4"}]},{now}),/không hợp lệ/);
  assert.throws(()=>prepareYouTubeAiRequest({...base,items:[{...items[0],scheduledAt:"2026-11-06T02:00:00Z"}]},{now}),/lịch YouTube/i);
  assert.throws(()=>prepareYouTubeAiRequest({...base,items:new Array(9).fill(items[0])},{now}),/1 đến 8/);
  assert.ok(youtubeAiPrompt(parsed).includes("KHÔNG bịa"));
  assert.equal(youtubeAiRequest("hello").generationConfig.responseMimeType,"application/json");
});
test("AI JSON gives previewable title/description and guarded suggested times",()=>{
  const slots=prepareYouTubeAiRequest(base,{now}).items;
  const draft=normalizeYouTubeAiDraft(reply(),slots,{now});
  assert.equal(draft.length,2);
  assert.equal(draft[0].title,"Trùng Sinh Tập 1 #Shorts");
  assert.equal(draft[0].scheduledAt,"2026-11-08T02:15:00.000Z");
  assert.equal(draft[1].scheduledAt,"2026-11-08T04:10:00.000Z");
  assert.ok(draft.every(x=>x.aiTimeApplied));
  const fallback=normalizeYouTubeAiDraft(reply(["22:00","11:00"]),slots,{now});
  assert.equal(fallback[0].scheduledAt,"2026-11-08T02:00:00.000Z");
  assert.equal(fallback[0].aiTimeApplied,false);
});
test("AI cannot change episode membership or generate overlong title",()=>{
  const slots=prepareYouTubeAiRequest(base,{now}).items;
  assert.throws(()=>normalizeYouTubeAiDraft(JSON.stringify({items:[]}),slots,{now}),/đủ/);
  const swapped=JSON.parse(reply());swapped.items[0].episode=3;
  assert.throws(()=>normalizeYouTubeAiDraft(JSON.stringify(swapped),slots,{now}),/thứ tự/);
  const long=JSON.parse(reply());long.items[0].title="a".repeat(101);
  assert.throws(()=>normalizeYouTubeAiDraft(JSON.stringify(long),slots,{now}),/100/);
  assert.throws(()=>normalizeYouTubeAiDraft("not json",slots,{now}),/JSON/);
});
test("Only remote-less failed YouTube uploads qualify for safe retry",()=>{
  assert.ok(safeYoutubeRetry({provider:"youtube",status:"failed",remote_id:null}));
  assert.ok(!safeYoutubeRetry({provider:"youtube",status:"needs_review",remote_id:null}));
  assert.ok(!safeYoutubeRetry({provider:"youtube",status:"failed",remote_id:"someRemoteId"}));
  assert.ok(!safeYoutubeRetry({provider:"tiktok",status:"failed",remote_id:null}));
});
test("Only future, bounded metadata edits can modify queued video",()=>{
  const clean=cleanYoutubeUpdate({title:"Tập mới #Shorts",caption:"Mô tả đã duyệt",
    scheduledAt:"2026-11-09T02:00:00Z"},{now});
  assert.equal(clean.title,"Tập mới #Shorts");
  assert.equal(clean.scheduled_at,"2026-11-09T02:00:00.000Z");
  assert.throws(()=>cleanYoutubeUpdate({title:"",scheduledAt:"2026-11-09T02:00:00Z"},{now}),/Tiêu đề/);
  assert.throws(()=>cleanYoutubeUpdate({title:"Tập",scheduledAt:"2026-11-06T02:00:00Z"},{now}),/Giờ đăng/);
});
