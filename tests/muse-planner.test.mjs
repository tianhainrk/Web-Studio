import test from "node:test";
import assert from "node:assert/strict";
import {planSpecification,musePrompt,validateMuseReply,validateApprovedPlan,validateSelection,gatewayEndpoint,parsePlanItems,geminiPlanRequest} from "../src/muse-planner.mjs";

const episodes=[1,2,3,4,5,6,7,8,9];
const prepared={
  folderId:"collection_123456789",
  title:"Phim ngắn A",episodes,
  startDate:"2026-12-20",time:"19:00",perDay:2,spacingMinutes:60,
  instructions:"Nội dung trung tính"
};
test("Muse planner chooses deterministic 8-item batch with safe UTC slots",()=>{
  const s=planSpecification({...prepared,offset:0,limit:8});
  assert.equal(s.slots.length,9);assert.equal(s.all.length,9);
  assert.equal(s.slots[0],"2026-12-20T12:00:00.000Z");
  const p=musePrompt(s.name,[{episode:1,filename:"EP001.mp4",scheduledAt:s.slots[0]}]);
  assert.match(p,/JSON/);assert.match(p,/EP001/);
  assert.doesNotMatch(p,/Bearer |access_token|ya29\./);
});
test("Muse response parser accepts exact caption and schedule and rejects mismatched plans",()=>{
  const batch=[{episode:1,filename:"EP001.mp4",scheduledAt:"2026-12-20T12:00:00.000Z"},
               {episode:2,filename:"EP002.mp4",scheduledAt:"2026-12-20T13:00:00.000Z"}];
  const rows=batch.map(x=>({episode:x.episode,scheduledAt:x.scheduledAt,caption:"Tập "+x.episode+" · Hãy đón xem diễn biến tiếp theo."}));
  assert.deepEqual(validateMuseReply(JSON.stringify({items:rows}),batch),rows);
  assert.deepEqual(validateMuseReply(JSON.stringify({items:[
    {...rows[0],scheduledAt:"2026-12-20T12:30:00.000Z"},
    {...rows[1],scheduledAt:"2026-12-20T13:30:00.000Z"}
  ]}),batch).map(x=>x.scheduledAt),["2026-12-20T12:30:00.000Z","2026-12-20T13:30:00.000Z"]);
  assert.throws(()=>validateMuseReply(JSON.stringify({items:[
    {...rows[0],scheduledAt:"2026-12-20T13:30:00.000Z"},
    {...rows[1],scheduledAt:"2026-12-20T13:00:00.000Z"}
  ]}),batch));
  assert.throws(()=>validateMuseReply(JSON.stringify({items:rows.slice(0,1)}),batch));
  assert.throws(()=>validateMuseReply(JSON.stringify({items:[{...rows[0],episode:2},rows[1]]}),batch));
  assert.throws(()=>validateMuseReply(JSON.stringify({items:[{...rows[0],scheduledAt:"2026-12-21T12:00:00.000Z"},rows[1]]}),batch));
  assert.throws(()=>validateMuseReply("not JSON",batch));
});
test("approved manual edits must cover exactly selected episodes, increasing in the future",()=>{
  const now=Date.parse("2026-12-01T00:00:00.000Z");
  const good=[{episode:1,scheduledAt:"2026-12-20T12:00:00.000Z",caption:"Tập một."},
              {episode:2,scheduledAt:"2026-12-21T12:00:00.000Z",caption:"Tập hai."}];
  assert.deepEqual(validateApprovedPlan(good,[1,2],now),good);
  assert.throws(()=>validateApprovedPlan(good.slice(0,1),[1,2],now));
  assert.throws(()=>validateApprovedPlan([good[0],{...good[1],scheduledAt:"2026-12-19T12:00:00.000Z"}],[1,2],now));
  assert.throws(()=>validateApprovedPlan(good.map(x=>({...x,scheduledAt:"2026-11-30T12:00:00.000Z"})),[1,2],now));
  assert.throws(()=>validateApprovedPlan([...good,{...good[0]}],[1,2],now));
});
test("Muse gateway rejects malformed or internal URLs",()=>{
  assert.equal(gatewayEndpoint("https://muse.example.com/v1"),"https://muse.example.com/v1/chat/completions");
  for(const url of ["http://muse.example.com","https://localhost/v1","https://127.0.0.1/v1","https://muse.example.com/private","https://me:pass@muse.example.com","https://muse.example.com/?token=secret"]){
    assert.throws(()=>gatewayEndpoint(url));
  }
});
test("cannot exceed Muse batch limits or accept duplicate episodes",()=>{
  assert.throws(()=>validateSelection([1,1]));
  assert.doesNotThrow(()=>planSpecification({...prepared,offset:0,limit:9}));
  assert.throws(()=>planSpecification({...prepared,offset:0,limit:301}));
  assert.throws(()=>planSpecification({...prepared,offset:9,limit:1}));
});

test("full ten-episode Muse JSON can be validated in a single import",()=>{
  const full={...prepared,episodes:[1,2,3,4,5,6,7,8,9,10]};
  const s=planSpecification({...full,offset:0,limit:10});
  const batch=s.all.map((episode,i)=>({episode,filename:"EP"+String(episode).padStart(3,"0")+".mp4",scheduledAt:s.slots[i]}));
  const items=batch.map(x=>({episode:x.episode,scheduledAt:x.scheduledAt,caption:"Phim tập "+x.episode+" – chờ xem diễn biến tiếp theo."}));
  assert.equal(parsePlanItems(JSON.stringify({items})).length,10);
  assert.equal(validateMuseReply(JSON.stringify({items}),batch).length,10);
  assert.equal(validateMuseReply(JSON.stringify({items:items.slice(8)}),batch.slice(8)).length,2);
});
test("Gemini request demands structured JSON for per-episode data",()=>{
  const request=geminiPlanRequest("Hãy tạo caption cho tập 1");
  assert.equal(request.generationConfig.responseMimeType,"application/json");
  assert.deepEqual(request.generationConfig.responseSchema.properties.items.items.required,["episode","scheduledAt","caption"]);
  assert.match(request.contents[0].parts[0].text,/caption/);
});
