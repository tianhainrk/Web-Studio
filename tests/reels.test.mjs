import test from "node:test";
import assert from "node:assert/strict";
import {encryptToken,decryptToken,oauthState,verifyOauthState,scheduleEpisodes,episodeNo,validId,clientConfig,isOAuthCallbackRequest} from "../src/reels-core.mjs";
import {randomBytes} from "node:crypto";
const key=randomBytes(32);
test("AES-256-GCM encrypts and decrypts without exposing plaintext",()=>{
  const cipher=encryptToken("secret-token",key);
  assert.match(cipher,/^v1\./);assert.ok(!cipher.includes("secret-token"));
  assert.equal(decryptToken(cipher,key),"secret-token");
  assert.throws(()=>decryptToken(cipher+"!",key));
  assert.throws(()=>decryptToken(cipher,randomBytes(32)));
});
test("OAuth state is provider and origin bound",()=>{
  const secret="a".repeat(64),state=oauthState("google","https://sample.vercel.app",secret);
  assert.equal(verifyOauthState(state,"google","https://sample.vercel.app",secret),true);
  assert.equal(verifyOauthState(state,"meta","https://sample.vercel.app",secret),false);
  assert.equal(verifyOauthState(state,"google","https://other.vercel.app",secret),false);
  assert.equal(verifyOauthState(state.slice(0,-1)+"!", "google","https://sample.vercel.app",secret),false);
});
test("Episode naming validates exact numbered MP4 only",()=>{
  assert.equal(episodeNo("EP001.mp4"),1);
  assert.equal(episodeNo("EP0001.MP4"),1);
  assert.equal(episodeNo("movie.json"),null);
  assert.equal(episodeNo("EP0.mp4"),null);
  assert.equal(episodeNo("EP99999.mp4"),null);
  assert.equal(validId("../foo"),false);
});
test("Schedule uses Vietnam UTC+7, distributes videos and keeps order",()=>{
  const result=scheduleEpisodes({startDate:"2026-12-10",time:"19:00",perDay:2,spacingMinutes:60,count:5});
  assert.deepEqual(result,[
    "2026-12-10T12:00:00.000Z",
    "2026-12-10T13:00:00.000Z",
    "2026-12-11T12:00:00.000Z",
    "2026-12-11T13:00:00.000Z",
    "2026-12-12T12:00:00.000Z"
  ]);
});
test("Schedule rejects invalid values and day overflow",()=>{
  assert.throws(()=>scheduleEpisodes({startDate:"2026-02-30",time:"10:00",perDay:1,spacingMinutes:10,count:1}));
  assert.throws(()=>scheduleEpisodes({startDate:"2026-12-10",time:"23:50",perDay:2,spacingMinutes:30,count:2}));
  assert.throws(()=>scheduleEpisodes({startDate:"2026-12-10",time:"14:00",perDay:0,spacingMinutes:60,count:2}));
});
test("Configuration exposes only booleans, not secrets",()=>{
  const cfg=clientConfig();
  assert.equal(typeof cfg.supabase,"boolean");
  assert.equal(typeof cfg.meta,"boolean");
  assert.ok(!JSON.stringify(cfg).includes("access_token"));
});

test("OAuth callback cross-site exception is restricted to provider GET callbacks",()=>{
  assert.equal(isOAuthCallbackRequest("GET","/reels/oauth/google/callback"),true);
  assert.equal(isOAuthCallbackRequest("GET","/reels/oauth/meta/callback"),true);
  for(const [method,path] of [
    ["POST","/reels/oauth/google/callback"],
    ["GET","/reels/oauth/google/start"],
    ["GET","/reels/oauth/other/callback"],
    ["GET","/reels/pages"],
    ["GET","/reels/oauth/google/callback/anything"],
    ["GET","/reels/oauth/google/callback/../pages"]
  ])assert.equal(isOAuthCallbackRequest(method,path),false,method+" "+path);
});
