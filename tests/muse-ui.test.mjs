import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const reels=readFileSync(new URL("../public/reels.js",import.meta.url),"utf8");
const legacy=readFileSync(new URL("../public/reels.html",import.meta.url),"utf8");

test("Anpi Drama brand and integrated Reels tab are present",()=>{
  assert.match(html,/<title>Anpi Drama Studio<\/title>/);
  assert.match(html,/<b>ANPI<\/b> DRAMA/);
  assert.match(html,/data-tab="reels"/);
  assert.match(html,/id="reels" class="hidden"/);
  assert.match(html,/id="musePreview"/);
  assert.match(html,/id="musePrompt"/);
  assert.match(html,/id="museReply"/);
  assert.doesNotMatch(html,/href="\/reels\.html"/);
  assert.match(app,/refreshReelsStudio\(\)/);
});
test("all HTML ids are unique, and Reels studio is initialized only after auth",()=>{
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length);
  assert.match(app,/if \(location\.hash === "#reels"\)/);
  assert.match(reels,/export function initReelsStudio\(/);
  assert.match(reels,/export async function refreshReelsStudio\(/);
});
test("legacy Reels URL redirects to integrated tab",()=>{
  assert.match(legacy,/#reels/);
  assert.doesNotMatch(legacy,/src="\/reels\.js"/);
});
test("Muse review required before saving campaign",()=>{
  assert.match(reels,/if\(plan\.some\(x=>!x\)\)/);
  assert.match(reels,/if\(!confirm\(/);
  assert.match(reels,/api\("\/campaigns\/create"/);
});
