import test from "node:test";
import assert from "node:assert/strict";
import {buildCampaignSchedule,CAMPAIGN_TIMEZONE} from "../src/reels/campaign-schedule.mjs";

const pages=Array.from({length:5},(_,pageIndex)=>({
  pageId:String(12000000000+pageIndex),
  seriesId:"series_"+(pageIndex+1),
  episodes:Array.from({length:80},(_,i)=>({
    number:i+1,
    driveFileId:"driveFile_"+pageIndex+"_"+String(i+1).padStart(3,"0"),
    rightsApproved:true
  }))
}));
const date="2026-11-10";

test("five Fanpages yield 400 draft posts over seven days",()=>{
  const all=buildCampaignSchedule({pages,startDate:date});
  assert.equal(all.length,400);
  for(const page of pages){
    const mine=all.filter(x=>x.pageId===page.pageId);
    assert.deepEqual(mine.map(x=>x.episodeNumber),Array.from({length:80},(_,i)=>i+1));
    const days=[...new Set(mine.map(x=>x.localDate))];
    assert.equal(days.length,7);
    assert.deepEqual(days.map(d=>mine.filter(x=>x.localDate===d).length),
      [12,12,12,12,12,12,8]);
  }
});

test("Vietnam local slots and UTC instants are internally consistent",()=>{
  const all=buildCampaignSchedule({pages,startDate:date});
  assert.equal(all[0].scheduledAt,"2026-11-10T01:00:00.000Z");
  assert.equal(all[0].localTime,"08:00");
  assert.equal(all[0].timezone,CAMPAIGN_TIMEZONE);
  assert.equal(all.at(-1).localDate,"2026-11-16");
  assert.ok(all.every(x=>x.localTime>="08:00"&&x.localTime<="22:00"));
  assert.ok(all.every(x=>x.editorialApproved===false&&x.status==="draft"));
});

test("rights missing means not publishable",()=>{
  const selected={...pages[0],episodes:pages[0].episodes.map(x=>({...x,rightsApproved:false}))};
  const all=buildCampaignSchedule({pages:[selected],startDate:date});
  assert.equal(all.length,80);
  assert.ok(all.every(x=>x.status==="awaiting_rights"&&!x.editorialApproved));
});

test("reject invalid input and duplicate publishing identifiers",()=>{
  assert.throws(()=>buildCampaignSchedule({pages,startDate:"2026-02-30"}));
  assert.throws(()=>buildCampaignSchedule({pages:[pages[0],pages[0]],startDate:date}));
  assert.throws(()=>buildCampaignSchedule({pages,startDate:date,days:6}));
  assert.throws(()=>buildCampaignSchedule({pages,startDate:date,windowStart:"21:59",windowEnd:"22:00"}));
  const duplicateFile={...pages[0],episodes:pages[0].episodes.map(x=>({...x,driveFileId:"driveFile_same_000"}))};
  assert.throws(()=>buildCampaignSchedule({pages:[duplicateFile],startDate:date}));
});


test("dynamic: one Page and three videos may publish across two days",()=>{
  const one={
    pageId:"17777770001",seriesId:"custom_series",
    episodes:Array.from({length:3},(_,i)=>({
      number:i+4,driveFileId:"custom_drive_"+(i+4),rightsApproved:true
    }))
  };
  const posts=buildCampaignSchedule({
    pages:[one],startDate:date,days:2,dailyLimit:2,windowStart:"09:00",windowEnd:"17:00"
  });
  assert.equal(posts.length,3);
  assert.deepEqual(posts.map(x=>x.episodeNumber),[4,5,6]);
  assert.deepEqual(posts.map(x=>x.localTime),["09:00","17:00","09:00"]);
});

test("dynamic: each Page-to-series assignment can override posting pace",()=>{
  const assignments=[
    {...pages[0],episodes:pages[0].episodes.slice(0,3),days:1,dailyLimit:3},
    {...pages[1],episodes:pages[1].episodes.slice(0,7),days:4,dailyLimit:2}
  ];
  const posts=buildCampaignSchedule({pages:assignments,startDate:date,days:7,dailyLimit:12});
  assert.equal(posts.length,10);
  assert.equal(posts.filter(p=>p.pageId===assignments[0].pageId).length,3);
  assert.equal(new Set(posts.filter(p=>p.pageId===assignments[1].pageId).map(x=>x.localDate)).size,4);
});

test("dynamic: a Page can schedule different movies without duplicate Drive videos",()=>{
  const first={...pages[0],episodes:pages[0].episodes.slice(0,2),days:1,dailyLimit:2};
  const second={...pages[1],pageId:pages[0].pageId,episodes:pages[1].episodes.slice(0,2),days:1,dailyLimit:2};
  const posts=buildCampaignSchedule({pages:[first,second],startDate:date,days:1,dailyLimit:2});
  assert.equal(posts.length,4);
  assert.equal(new Set(posts.map(x=>x.seriesId)).size,2);
  const duplicate={...second,episodes:first.episodes};
  assert.throws(()=>buildCampaignSchedule({pages:[first,duplicate],startDate:date,days:1,dailyLimit:2}),/lặp lại/);
});

test("dynamic: configured pace must accommodate exact selected episodes",()=>{
  const selected={...pages[0],episodes:pages[0].episodes.slice(0,9)};
  assert.throws(()=>buildCampaignSchedule({pages:[selected],startDate:date,days:2,dailyLimit:4}),/Không xếp đủ/);
  assert.equal(buildCampaignSchedule({pages:[selected],startDate:date,days:3,dailyLimit:4}).length,9);
});
