import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {videoCaptionPrompt,validateVideoCaption,geminiVideoRequest} from "../src/gemini-video.mjs";
import {scheduleEpisodes} from "../src/reels-core.mjs";

test("one user instruction drives 80 real-video caption requests and ordered schedules",()=>{
  const slots=scheduleEpisodes({startDate:"2026-12-01",time:"19:00",perDay:1,spacingMinutes:60,count:80});
  assert.equal(slots.length,80);
  assert.equal(slots[0],"2026-12-01T12:00:00.000Z");
  assert.equal(slots[79],"2027-02-18T12:00:00.000Z");
  const common="Viết cap sát hình ảnh và lời thoại, không spoil";
  for(let i=1;i<=80;i++){
    const prompt=videoCaptionPrompt({title:"Phim A",episode:i,total:80,instructions:common});
    assert.ok(prompt.includes(common));assert.ok(prompt.includes("VIDEO THỰC"));assert.ok(prompt.includes(String(i)+"/80"));
  }
});
test("Gemini video request includes uploaded file URI and instruction",()=>{
  const query=geminiVideoRequest("https://generativelanguage.googleapis.com/v1beta/files/abc","video/mp4","Caption real video");
  assert.equal(query.contents[0].parts[0].file_data.mime_type,"video/mp4");
  assert.equal(query.contents[0].parts[1].text,"Caption real video");
  assert.equal(query.generationConfig.responseMimeType,"application/json");
});
test("video caption must include text and grounded summary",()=>{
  assert.deepEqual(validateVideoCaption(JSON.stringify({caption:"Một bí mật sắp được bật mí #PhimNgan",summary:"Nhân vật nhìn thấy một chiếc hộp."})),{
    caption:"Một bí mật sắp được bật mí #PhimNgan",summary:"Nhân vật nhìn thấy một chiếc hộp."
  });
  assert.throws(()=>validateVideoCaption("{}"));
  assert.throws(()=>validateVideoCaption("not JSON"));
});
test("video analysis worker remains intentionally paused, while Muse controls captions and schedule",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const client=readFileSync(new URL("../public/reels.js",import.meta.url),"utf8");
  const api=readFileSync(new URL("../src/reels-api.mjs",import.meta.url),"utf8");
  const workflow=readFileSync(new URL("../.github/workflows/gemini-video-worker.yml",import.meta.url),"utf8");
  assert.match(html,/id="captionSource"/);
  assert.match(html,/option value="connected_drive" selected/);
  assert.match(html,/id="rdComposer"/);
  assert.match(client,/function renderDrafts/);
  assert.match(api,/from "\.\/muse-planner\.mjs";/);
  assert.match(api,/\/ai\/video\/cancel/);
  assert.doesNotMatch(workflow,/cron:/);
  assert.match(workflow,/ENABLE_GEMINI_VIDEO_WORKER/);
});
