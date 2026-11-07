import test from "node:test";
import assert from "node:assert/strict";
import {validateYouTubeMuseManifest,youtubeMusePrompt,parseYoutubeMuseReply} from "../src/multiplatform-muse.mjs";

const now=Date.parse("2026-11-07T03:00:00Z");
const base={folderId:"PineDramaFolder_123",seriesTitle:"Ôi Không! Sếp Là Chồng Tôi",
 accountName:"Kênh Shorts của tôi",instructions:"Hấp dẫn nhưng không spoil",items:[
 {episode:1,fileId:"DriveIdAAA111",filename:"EP001.mp4",scheduledAt:"2026-11-09T02:00:00.000Z"},
 {episode:2,fileId:"DriveIdAAA222",filename:"EP002.mp4",scheduledAt:"2026-11-09T04:00:00.000Z"},
 {episode:3,fileId:"DriveIdAAA333",filename:"EP003.mp4",scheduledAt:"2026-11-10T02:00:00.000Z"}
]};
const example={items:[
{episode:1,title:"Tập 1: Bước ngoặt #Shorts",description:"Tiếp tục khám phá phần mở đầu của bộ phim #Shorts",scheduledAt:"2026-11-09T03:00:00.000Z"},
{episode:3,title:"Tập 3: Bất ngờ kế tiếp #Shorts",description:"Xem diễn biến mới trong tập 3. #Shorts",scheduledAt:"2026-11-10T02:00:00.000Z"}],
 skipped:[{episode:2,reason:"Không thể đọc tệp video"}],cleanup:{status:"pending"}};
test("Muse requires exact video manifest, ordered EP filenames and scheduled ISO slots",()=>{
 const manifest=validateYouTubeMuseManifest(base,{now});
 assert.equal(manifest.items.length,3);
 assert.throws(()=>validateYouTubeMuseManifest({...base,items:[base.items[1],base.items[0]]},{now}),/tập/i);
 assert.throws(()=>validateYouTubeMuseManifest({...base,items:[{...base.items[0],filename:"EP099.mp4"}]},{now}),/EPxxx/);
 assert.throws(()=>validateYouTubeMuseManifest({...base,items:[{...base.items[0],scheduledAt:"2026-11-09T00:00:00Z"}]},{now}),/07:00/);
 assert.throws(()=>validateYouTubeMuseManifest({...base,items:new Array(41).fill(base.items[0])},{now}),/1–40/);
});
test("Muse instruction binds exact Drive folder, file IDs and clean JSON format",()=>{
 const prompt=youtubeMusePrompt(validateYouTubeMuseManifest(base,{now}));
 assert.match(prompt,/https:\/\/drive.google.com\/drive\/folders\/PineDramaFolder_123/);
 assert.match(prompt,/DriveIdAAA111/);
 assert.match(prompt,/title/);assert.match(prompt,/description/);
 assert.match(prompt,/KHÔNG đăng video/);
 assert.match(prompt,/TUYỆT ĐỐI không sửa hoặc xóa tệp Google Drive gốc/);
});
test("Import Muse JSON supports partial batches and skipped without inventing metadata",()=>{
 const man=validateYouTubeMuseManifest(base,{now});
 const parsed=parseYoutubeMuseReply(JSON.stringify(example),man,{now});
 assert.equal(parsed.plan.length,2);
 assert.deepEqual(parsed.plan.map(x=>x.episode),[1,3]);
 assert.equal(parsed.plan[0].fileId,base.items[0].fileId);
 assert.equal(parsed.skipped[0].episode,2);
 const fenced="\x60\x60\x60json\n"+JSON.stringify(example)+"\n\x60\x60\x60";
 assert.equal(parseYoutubeMuseReply(fenced,man,{now}).received,2);
});
test("Muse cannot add episodes, duplicate files, or move VN calendar dates",()=>{
 const m=validateYouTubeMuseManifest(base,{now});
 const altered=structuredClone(example);altered.items[0].episode=9;
 assert.throws(()=>parseYoutubeMuseReply(JSON.stringify(altered),m,{now}),/ngoài danh sách/);
 altered.items[0].episode=3;
 assert.throws(()=>parseYoutubeMuseReply(JSON.stringify(altered),m,{now}),/trùng/);
 const changed=structuredClone(example);changed.items[0].scheduledAt="2026-11-10T03:00:00Z";
 assert.throws(()=>parseYoutubeMuseReply(JSON.stringify(changed),m,{now}),/đúng ngày/);
 const badTitle=structuredClone(example);badTitle.items[0].title="A".repeat(101);
 assert.throws(()=>parseYoutubeMuseReply(JSON.stringify(badTitle),m,{now}),/100/);
 const skippedConflict=structuredClone(example);skippedConflict.skipped=[{episode:1,reason:"broken"}];
 assert.throws(()=>parseYoutubeMuseReply(JSON.stringify(skippedConflict),m,{now}),/skipped/);
});
