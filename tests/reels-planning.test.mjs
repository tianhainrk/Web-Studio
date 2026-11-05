import test from "node:test";
import assert from "node:assert/strict";
import {balancedCounts,balancedSchedule,validateBalancedSchedule,normalizeBalancedReply,daySummary,vnDate} from "../src/reels-planning.mjs";
import {museDrivePrompt,planSpecification,validateGoldenMuseReply} from "../src/muse-planner.mjs";
const from="2026-12-06",now=Date.parse("2026-12-01T00:00:00Z");
const refs=n=>balancedSchedule({startDate:from,count:n}).map((scheduledAt,i)=>({
  episode:i+1,scheduledAt,filename:"EP"+String(i+1).padStart(3,"0")+".mp4",fileId:"driveFileABC"+i
}));
test("balanced AI scheduler gives 71 -> 11/10/10/10/10/10/10 and 80 -> eight equal days",()=>{
  assert.deepEqual(balancedCounts(71),[11,10,10,10,10,10,10]);
  assert.deepEqual(balancedCounts(80),[10,10,10,10,10,10,10,10]);
  assert.deepEqual(balancedCounts(19),[19]);
  assert.deepEqual(balancedCounts(8),[8]); // exception when entire collection has under 10
  const schedule=balancedSchedule({startDate:from,count:71});
  assert.equal(schedule.length,71);
  assert.deepEqual(daySummary(schedule.map((scheduledAt,i)=>({episode:i+1,scheduledAt}))).map(x=>x.count),balancedCounts(71));
  assert.equal(vnDate(schedule[0]),from);
  assert.ok(schedule.every(x=>Number.isFinite(Date.parse(x))));
});
test("Golden hour imports accept AI-optimized times while keeping days balanced",()=>{
  const entries=refs(80);
  const rows=entries.map(x=>({episode:x.episode,scheduledAt:x.scheduledAt,caption:"Tập "+x.episode+" · đón xem trên Anpi Drama"}));
  // Deliberate adjustment: propose a later time inside the existing episode's day.
  const moved=Date.parse(rows[1].scheduledAt)+15*60000;
  rows[1].scheduledAt=new Date(moved).toISOString();
  const result=validateGoldenMuseReply(JSON.stringify({items:rows}),entries,{startDate:from,now});
  assert.equal(result.plan.length,80);
  assert.equal(result.adjusted,0);
  assert.deepEqual(validateBalancedSchedule(result.plan,from,now),balancedCounts(80));
});
test("legacy Muse 71-item schedule with only 10 slots/day is safely rebalanced",()=>{
  const entries=refs(71);
  const original=Array.from({length:71},(_,i)=>({
    episode:i+1,scheduledAt:new Date(Date.parse(from+"T07:00:00+07:00")+Math.floor(i/10)*86400000+(i%10)*80*60000).toISOString(),
    caption:"Tập "+(i+1)+" · caption từ video thực tế"
  }));
  const result=normalizeBalancedReply(original,entries,{startDate:from,now});
  assert.equal(result.plan.length,71);
  assert.ok(result.adjusted>0);
  assert.deepEqual(validateBalancedSchedule(result.plan,from,now),[11,10,10,10,10,10,10]);
});
test("server rejects unbalanced dates, duplicate hours and posts in the past",()=>{
  const e=refs(10);
  const plan=e.map(x=>({episode:x.episode,caption:"caption",scheduledAt:x.scheduledAt}));
  assert.doesNotThrow(()=>validateBalancedSchedule(plan,from,now));
  assert.throws(()=>validateBalancedSchedule([{...plan[0],scheduledAt:plan[1].scheduledAt},...plan.slice(1)],from,now));
  assert.throws(()=>validateBalancedSchedule([{...plan[0],scheduledAt:"2026-12-07T12:00:00.000Z"},...plan.slice(1)],from,now));
  assert.throws(()=>validateBalancedSchedule(plan,from,Date.parse("2026-12-09T00:00:00.000Z")));
});
test("Muse single instruction requires gold-hour planning, no summary/evidence, exact Drive ID",()=>{
  const e=refs(71);
  const prompt=museDrivePrompt("Phim A","museDriveFolder123456",e,"",{
    aiSchedule:true,pageName:"Anpi Page",startDate:from
  });
  assert.match(prompt,/Anpi Page/);
  assert.match(prompt,/71 video/);
  assert.match(prompt,/mỗi ngày ít nhất 10 tập/i);
  assert.match(prompt,/giờ vàng/i);
  assert.match(prompt,/không bịa số liệu/i);
  assert.match(prompt,/Không cần summary hoặc evidence/i);
  assert.match(prompt,/EP071.mp4/);
  assert.match(prompt,/XÓA TOÀN BỘ BẢN SAO VIDEO/);
  const spec=planSpecification({folderId:"museDriveFolder123456",episodes:Array.from({length:71},(_,i)=>i+1),
    startDate:from,offset:0,limit:71,title:"Phim A",aiSchedule:true});
  assert.deepEqual(spec.slots,e.map(x=>x.scheduledAt));
});
