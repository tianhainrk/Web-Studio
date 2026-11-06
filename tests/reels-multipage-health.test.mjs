import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pageQueueDiagnostics} from "../src/reels-diagnostics.mjs";
const now=Date.parse("2026-11-06T09:00:00+07:00");
const pages=[{page_id:"101",name:"Page A",active:true},{page_id:"202",name:"Page B",active:true},{page_id:"303",name:"Page C",active:false}];
const campaigns=[{id:"a",page_id:"101",status:"active"},{id:"b",page_id:"202",status:"active"},{id:"c",page_id:"303",status:"active"}];
const job=(page,campaign,episode,status,minutes,error)=>({
  id:String(page)+"-"+episode,page_id:String(page),campaign_id:campaign,status,
  scheduled_at:new Date(now+minutes*60000).toISOString(),
  updated_at:new Date(now-60*60000).toISOString(),error
});
test("reports independent backlog and errors for every Page, not just selected Page",()=>{
  const data=pageQueueDiagnostics(pages,campaigns,[
    job(101,"a",1,"published",-100),
    job(101,"a",2,"queued",-5),
    job(101,"a",3,"queued",120),
    job(202,"b",1,"failed",-50,"Meta token denied"),
    job(202,"b",2,"queued",-1),
    job(303,"c",1,"queued",-10)
  ],{now});
  assert.equal(data.length,3);
  assert.equal(data[0].due,1);
  assert.equal(data[0].totals.published,1);
  assert.equal(data[0].totals.queued,2);
  assert.equal(data[1].due,1);
  assert.equal(data[1].totals.failed,1);
  assert.equal(data[1].lastError,"Meta token denied");
  assert.equal(data[2].due,0);
  assert.equal(data[2].blocked,1);
  assert.match(data[2].reason,/đang tắt/);
});
test("paused campaigns do not appear in eligible due count",()=>{
  const data=pageQueueDiagnostics([{page_id:"9",name:"Paused",active:true}],
    [{id:"campaign9",page_id:"9",status:"paused"}],
    [job(9,"campaign9",1,"queued",-70)],{now});
  assert.equal(data[0].due,0);
  assert.equal(data[0].blocked,1);
  assert.match(data[0].reason,/tạm dừng|Không có chiến dịch/);
});
test("stale uploading is flagged, but not silently retried",()=>{
  const data=pageQueueDiagnostics([pages[0]],[campaigns[0]],[job(101,"a",1,"uploading",-100)],{now});
  assert.equal(data[0].staleUploading,1);
  assert.match(data[0].reason,/upload quá lâu/);
});
test("fair per-Page queue migration retains lock-safe atomic claim",()=>{
  const sql=readFileSync(new URL("../supabase/reels-multipage-fair-queue.sql",import.meta.url),"utf8");
  assert.match(sql,/create or replace function public\.claim_reel_jobs\(p_limit integer default 1\)/i);
  assert.match(sql,/row_number\(\) over \(partition by j\.page_id/i);
  assert.match(sql,/page_position/);
  assert.match(sql,/last_processed nulls first/);
  assert.match(sql,/for update of j skip locked/i);
  assert.match(sql,/grant execute .*to service_role/i);
});
test("UI and authenticated API expose Page health without returning page tokens",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../public/reels.js",import.meta.url),"utf8");
  const api=readFileSync(new URL("../src/reels-api.mjs",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../scripts/reels-worker.mjs",import.meta.url),"utf8");
  assert.match(html,/id="rdHealth"/);
  assert.match(html,/id="rdQueueHealth"/);
  assert.match(ui,/async function refreshDiagnostics\(\)/);
  assert.match(ui,/\/pages\/diagnostics/);
  assert.match(ui,/\/pages\/check-meta/);
  assert.match(api,/path==="\/pages\/diagnostics"/);
  assert.match(api,/path==="\/pages\/check-meta"/);
  assert.match(api,/select=page_id,name,active/);
  assert.doesNotMatch(api,/path==="\/pages\/diagnostics"[^]*?select=token_enc/);
  assert.match(worker,/console\.log\("reel claimed",job\.id,"page",job\.page_id/);
});
