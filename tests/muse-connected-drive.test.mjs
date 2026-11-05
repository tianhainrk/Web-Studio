import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {museDrivePrompt,validateMuseReply,planSpecification} from "../src/muse-planner.mjs";

const folder="1museExampleFolder12345";
const selected=Array.from({length:80},(_,i)=>({
  episode:i+1,
  filename:"EP"+String(i+1).padStart(3,"0")+".mp4",
  fileId:"museVideoFile_"+String(i+1).padStart(3,"0"),
  scheduledAt:new Date(Date.parse("2026-12-01T12:00:00.000Z")+i*86400000).toISOString()
}));
test("single connected-Drive instruction includes exact folder and all 80 episodes",()=>{
  const prompt=museDrivePrompt("Phim A",folder,selected,"Không spoil, kể đúng các cảnh trong video");
  assert.match(prompt,new RegExp("https://drive.google.com/drive/folders/"+folder));
  assert.match(prompt,/80 video/);
  assert.match(prompt,/EP001\.mp4/);
  assert.match(prompt,/EP080\.mp4/);
  assert.match(prompt,/Không spoil/);
  assert.match(prompt,/anpi-reels-plan\.json/);
  assert.match(prompt,/BẢN SAO VIDEO/);
  assert.match(prompt,/TUYỆT ĐỐI KHÔNG xóa/);
  assert.match(prompt,/cleanup\.status/);
  assert.match(prompt,/KHÔNG tự đoán caption/);
  assert.doesNotMatch(prompt,/ya29\.|Bearer [A-Za-z0-9_-]+|GEMINI_API_KEY|MUSE2API_API_KEY/);
});
test("video evidence is returned to UI without changing approved timestamps",()=>{
  const batch=selected.slice(0,2);
  const items=batch.map(x=>({episode:x.episode,scheduledAt:x.scheduledAt,caption:"Caption dựa trên video",summary:"Tóm tắt tập đã xem",evidence:"00:10: nhân vật mở cửa"}));
  const parsed=validateMuseReply(JSON.stringify({items,cleanup:{status:"completed",deletedTempFiles:2}}),batch);
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].summary,"Tóm tắt tập đã xem");
  assert.equal(parsed[0].evidence,"00:10: nhân vật mở cửa");
  assert.equal(parsed[1].scheduledAt,batch[1].scheduledAt);
});
test("master prompt rejects non Drive folder ids and duplicate episodes",()=>{
  assert.throws(()=>museDrivePrompt("Phim","not/id",selected,""));
  assert.throws(()=>museDrivePrompt("Phim",folder,[selected[0],selected[0]],""));
});
test("Muse is default, JSON file import and safe Gemini cancellation are present",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const client=readFileSync(new URL("../public/reels.js",import.meta.url),"utf8");
  const api=readFileSync(new URL("../src/reels-api.mjs",import.meta.url),"utf8");
  const workflow=readFileSync(new URL("../.github/workflows/gemini-video-worker.yml",import.meta.url),"utf8");
  assert.match(html,/value="muse" selected/);
  assert.match(html,/value="connected_drive" selected/);
  assert.match(html,/id="museJsonFile"/);
  assert.match(html,/id="videoCancel"/);
  assert.match(client,/prepareBatch\(true\)/);
  assert.match(client,/museReadDrive:/);
  assert.match(client,/async function cancelVideoBatch/);
  assert.match(api,/\/ai\/video\/cancel/);
  assert.match(api,/request\.aiSchedule===true/);
  assert.doesNotMatch(workflow,/cron:/);
  assert.match(workflow,/ENABLE_GEMINI_VIDEO_WORKER/);
});
