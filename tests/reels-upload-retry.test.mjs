import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reelUploadHeaders,safeToRetryFailedUpload} from "../src/reels-upload.mjs";
import {dispatchReelsWorker} from "../src/reels-dispatch.mjs";

test("Meta rupload receives exact binary length instead of chunked body",()=>{
  const h=reelUploadHeaders("page_test_token",12_345_678);
  assert.equal(h["Authorization"],"OAuth page_test_token");
  assert.equal(h["Content-Length"],"12345678");
  assert.equal(h["X-Entity-Length"],"12345678");
  assert.equal(h.file_size,"12345678");
  assert.equal(h.offset,"0");
  assert.equal(h["Content-Type"],"application/octet-stream");
  assert.throws(()=>reelUploadHeaders("tok",0));
  assert.throws(()=>reelUploadHeaders("tok",512*1024*1024+1));
});
test("Only known pre-publish Meta upload 400 failures can be safely retried",()=>{
  assert.equal(safeToRetryFailedUpload({status:"failed",error:'Meta upload HTTP 400: Invalid Header format'}),true);
  assert.equal(safeToRetryFailedUpload({status:"published",error:'Meta upload HTTP 400:'}),false);
  assert.equal(safeToRetryFailedUpload({status:"failed",error:'Meta chưa xác nhận hoàn thành đăng video'}),false);
  assert.equal(safeToRetryFailedUpload({status:"failed",error:'Meta upload HTTP 500: unexpected result'}),false);
});
test("GitHub dispatch is optional; missing token never leaks credentials",async()=>{
  const old=process.env.GITHUB_REELS_WORKFLOW_TOKEN;
  delete process.env.GITHUB_REELS_WORKFLOW_TOKEN;
  try{assert.deepEqual(await dispatchReelsWorker(),{dispatched:false,reason:"missing_token"});}
  finally{if(old===undefined)delete process.env.GITHUB_REELS_WORKFLOW_TOKEN;else process.env.GITHUB_REELS_WORKFLOW_TOKEN=old;}
});
test("Worker, authenticated retry and timed cron dispatch stay wired",()=>{
  const worker=readFileSync(new URL("../scripts/reels-worker.mjs",import.meta.url),"utf8");
  const api=readFileSync(new URL("../src/reels-api.mjs",import.meta.url),"utf8");
  const root=readFileSync(new URL("../api/index.mjs",import.meta.url),"utf8");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const js=readFileSync(new URL("../public/reels.js",import.meta.url),"utf8");
  const sql=readFileSync(new URL("../supabase/reels-worker-cron.sql",import.meta.url),"utf8");
  assert.match(worker,/headers:reelUploadHeaders\(token,size\)/);
  assert.match(worker,/reels worker jobs/);
  assert.match(worker,/REELS_BATCH_LIMIT/);
  assert.match(api,/path==="\/jobs\/retry"/);
  assert.match(api,/safeToRetryFailedUpload\(original\)/);
  assert.match(root,/p==="\/reels\/cron"/);
  assert.match(root,/REELS_CRON_SECRET/);
  assert.match(root,/status=eq.queued/);
  assert.match(sql,/vault.decrypted_secrets/);
  assert.match(sql,/\*\/2 \* \* \* \*/);
  assert.match(html,/id="rdJobRetry"/);
  assert.match(js,/async function retryFailedJob/);
  assert.match(js,/api\("\/jobs\/retry"/);
});
