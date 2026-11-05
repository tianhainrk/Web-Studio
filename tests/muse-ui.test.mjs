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
  assert.doesNotMatch(html,/id="rdCalendar"/);
  assert.doesNotMatch(html,/data-rd-view="calendar"/);
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
test("page-scoped overview, inline day detail and detailed Meta popups exist",()=>{
  for(const id of ["rdPage","rdTodayCount","rdTodayPublished","rdPending","rdFailed","rdWeek","rdDayDetail","rdDayTitle","rdCalendarItems","rdPrevWeek","rdNextWeek","rdThisWeek","rdWeekRange","rdCloseDay","rdCampaignList","rdJobDialog","rdConnectDialog","rdComposer"]){
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

test("selected days open their schedules inline, with accessible day cards and week paging",()=>{
  assert.match(html,/id="rdOverview"/);
  assert.match(html,/id="rdDayDetail" class="rd-day-detail hidden"/);
  assert.match(html,/id="rdWeek" class="rd-week"/);
  assert.match(html,/id="rdWeekRange"/);
  assert.doesNotMatch(html,/>Lịch đăng<\/button>/);
  assert.doesNotMatch(html,/id="rdOpenCalendar"/);
  assert.doesNotMatch(html,/id="rdCalendarDate"/);
  assert.match(reels,/function selectDay\(date,/);
  assert.match(reels,/function shiftWeek\(delta\)/);
  assert.match(reels,/card\.setAttribute\("aria-pressed"/);
  assert.match(reels,/card\.setAttribute\("aria-controls","rdDayDetail"\)/);
  assert.match(reels,/card\.onclick=\(\)=>selectDay\(target\)/);
  assert.match(reels,/rdDayDetail"\)\.classList\.toggle\("hidden",!hasSelection\)/);
  assert.match(reels,/rdUpcomingSection"\)\.classList\.toggle\("hidden",hasSelection\)/);
  assert.match(reels,/selectDay\(vnDate\(target\)\)/);
  assert.doesNotMatch(reels,/setView\("calendar"\)/);
});
test("responsive desktop/tablet/mobile CSS adapts automatically without user-agent sniffing",()=>{
  assert.match(css,/@media\(min-width:1400px\)/);
  assert.match(css,/@media\(max-width:1024px\)/);
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/@media\(max-width:380px\)/);
  assert.match(css,/scroll-snap-type:x mandatory/);
  assert.match(css,/grid-auto-flow:column/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/100dvh/);
  assert.match(css,/rd-day\.selected/);
  assert.match(html,/rd-week-hint/);
  assert.doesNotMatch(reels,/navigator\.userAgent/);
});
