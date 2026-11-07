import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../public/multiplatform.js",import.meta.url),"utf8");
const style=readFileSync(new URL("../public/multiplatform.css",import.meta.url),"utf8");
test("YouTube Studio client references only rendered or dynamically created controls",()=>{
 const used=new Set([...source.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]));
 const defined=new Set([...source.matchAll(/id="([^"]+)"/g)].map(x=>x[1])
   .concat([...source.matchAll(/\.id="([^"]+)"/g)].map(x=>x[1])));
 const external=new Set(["mpRoot"]);
 assert.deepEqual([...used].filter(id=>!defined.has(id)&&!external.has(id)),[]);
});
test("Muse wizard includes channel, movie, export, JSON import, review and approval",()=>{
 for(const id of ["mpChannelFilter","mpWizardChannel","mpWizardSeries","mpMusePrepare",
    "mpMuseCopy","mpMusePrompt","mpMuseJsonFile","mpMuseReply","mpMuseImport",
    "mpAiDrafts","mpAiRights","mpAiConsent","mpAiApprove","mpWeek","mpCampaignList"]){
   assert.ok(source.includes('id="'+id+'"')||source.includes('.id="'+id+'"'),"Missing "+id);
 }
 for(const label of ["setupStudioLayout(root)","importYoutubeMuse()","prepareYoutubeMuse()",
   "setWizardStep(3)","/muse/youtube/parse","/muse/youtube/prepare"]){
   assert.ok(source.includes(label),"Missing "+label);
 }
 assert.ok(style.includes(".mp-campaign-dialog"));
 assert.ok(style.includes(".mp-week"));
});
