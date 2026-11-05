import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const reels=readFileSync(new URL("../public/reels.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/reels-dashboard.css",import.meta.url),"utf8");
const legacy=readFileSync(new URL("../public/reels.html",import.meta.url),"utf8");

test("Anpi Drama keeps original movie tabs and embedded Reels dashboard",()=>{
  assert.match(html,/<title>Anpi Drama Studio<\/title>/);
  assert.match(html,/<b>ANPI<\/b> DRAMA/);
  assert.match(html,/data-tab="reels"/);
  assert.match(html,/id="reels" class="hidden"/);
  assert.match(html,/id="rdOverview"/);
  assert.match(html,/id="rdCalendar"/);
  assert.match(html,/id="rdCampaignsView"/);
  assert.doesNotMatch(html,/href="\/reels\.html"/);
  assert.match(app,/refreshReelsStudio\(\)/);
});
test("all HTML IDs remain unique, legacy URL redirects into native tab",()=>{
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length);
  assert.match(app,/if \(location\.hash === "#reels"\)/);
  assert.match(reels,/function initReelsStudio\(/);
  assert.match(reels,/export async function refreshReelsStudio\(/);
  assert.match(legacy,/#reels/);
});
test("page-scoped overview, calendar and detailed Meta popups exist",()=>{
  for(const id of ["rdPage","rdTodayCount","rdTodayPublished","rdPending","rdFailed","rdWeek","rdCalendarItems","rdCampaignList","rdJobDialog","rdConnectDialog","rdComposer"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(reels,/pageId=/);
  assert.match(reels,/api\("\/jobs\/update"/);
  assert.match(reels,/api\("\/jobs\/cancel"/);
  assert.match(reels,/api\("\/jobs\/reconcile"/);
  assert.match(css,/rd-dialog/);
  assert.match(css,/rd-metrics/);
});
test("section 3 contains only four visible AI scheduling fields",()=>{
  const wizard=html.split('id="rdStepAi"')[1].split('id="rdStepReview"')[0];
  for(const id of ["planProvider","pageSelect","startDate","captionSource"]){
    assert.match(wizard,new RegExp('id="'+id+'"'));
  }
  for(const id of ["startTime","perDay","spacing","aiTitle","campaign","museInstructions"]){
    assert.doesNotMatch(wizard,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/id="museJsonFile"/);
  assert.match(html,/id="musePrompt"/);
  assert.match(html,/id="museReply"/);
  assert.match(reels,/prepareBatch\(true\)/);
  assert.match(reels,/function planReview\(/);
});
test("71+ episode preview is paginated and editable in popup",()=>{
  for(const id of ["musePreview","rdDraftPagination","rdPrevDraft","rdNextDraft","rdCaptionDialog","rdDraftCaption","rdDraftTime","reviewSummary","reviewHint"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(reels,/const per=12/);
  assert.match(reels,/function editDraft\(/);
  assert.match(reels,/function saveDraft\(/);
  assert.match(reels,/api\("\/muse\/parse"/);
  assert.match(reels,/api\("\/campaigns\/create"/);
  assert.match(reels,/if\(!confirm\(/);
});
