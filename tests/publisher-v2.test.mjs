import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {seal,unseal} from "../src/reels/publisher-storage.mjs";
import {captionPrompt,generateCaption} from "../src/reels/publisher-ai.mjs";
import {oauthStart,validateOAuthState} from "../src/reels/publisher-oauth.mjs";

const originalEnv={...process.env};
process.env.PUBLISHER_ENCRYPTION_KEY=randomBytes(32).toString("base64");
process.env.SESSION_SECRET="test-session-secret-more-than-32-characters";
process.env.STUDIO_PUBLIC_URL="https://example.com";
process.env.META_APP_ID="123456789";
process.env.META_APP_SECRET="fake-secret-not-a-real-key";
process.env.GOOGLE_CLIENT_ID="fake.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET="fake-secret";
test.after(()=>{for(const k of [
  "PUBLISHER_ENCRYPTION_KEY","SESSION_SECRET","STUDIO_PUBLIC_URL",
  "META_APP_ID","META_APP_SECRET","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GEMINI_API_KEY","MUSE_API_KEY"
]){
 if(originalEnv[k]===undefined)delete process.env[k];else process.env[k]=originalEnv[k];
}});

test("AES-GCM encrypted credentials decrypt with exact key and reject changes",()=>{
  const payload={access_token:"never-log-this",refresh_token:"another-private-secret"};
  const encrypted=seal(payload);
  assert.ok(!encrypted.includes(payload.access_token));
  assert.deepEqual(unseal(encrypted),payload);
  assert.throws(()=>unseal(encrypted.slice(0,-4)+"ABCD"));
});

test("OAuth URLs contain state bound to authenticated cookie and safe callback",()=>{
  const cookie="pws=abc123";
  const first=new URL(oauthStart("meta",cookie));
  assert.equal(first.hostname,"www.facebook.com");
  assert.ok(first.searchParams.get("redirect_uri").includes("/api/publisher/oauth/meta/callback"));
  assert.doesNotThrow(()=>validateOAuthState(first.searchParams.get("state"),"meta",cookie));
  assert.throws(()=>validateOAuthState(first.searchParams.get("state"),"meta","pws=other"));
  const second=new URL(oauthStart("google",cookie));
  assert.equal(second.hostname,"accounts.google.com");
  assert.equal(second.searchParams.get("access_type"),"offline");
  assert.throws(()=>validateOAuthState(second.searchParams.get("state"),"meta",cookie));
});

test("AI prompt does not invent episode plot from missing metadata",()=>{
  const prompt=captionPrompt({movieTitle:"Phim mẫu",episodeNumber:19});
  assert.match(prompt,/không bịa/i);
  assert.match(prompt,/19/);
  assert.throws(()=>captionPrompt({episodeNumber:0}));
});

test("Gemini and Muse adapters parse valid JSON without exposing secrets",async()=>{
  const originalFetch=globalThis.fetch;
  process.env.GEMINI_API_KEY="TEST_GEMINI_KEY";
  process.env.MUSE_API_KEY="TEST_MUSE_KEY";
  const seen=[];
  globalThis.fetch=async(url,options)=>{
    seen.push({url:String(url),headers:options.headers});
    const text=JSON.stringify({title:"Tập 2",caption:"Xem tập thứ hai của phim mẫu",hashtags:["#PhimNgan","#Tap02"]});
    if(String(url).includes("generativelanguage"))
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}),{status:200,
        headers:{"content-type":"application/json"}});
    return new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status:200,
      headers:{"content-type":"application/json"}});
  };
  try{
    const input={movieTitle:"Phim mẫu",episodeNumber:2};
    assert.equal((await generateCaption("gemini",input)).hashtags.length,2);
    assert.equal((await generateCaption("muse",input)).caption,"Xem tập thứ hai của phim mẫu");
    assert.equal(seen.length,2);
    assert.equal(seen[0].headers["x-goog-api-key"],"TEST_GEMINI_KEY");
    assert.equal(seen[1].headers.Authorization,"Bearer TEST_MUSE_KEY");
  }finally{globalThis.fetch=originalFetch;}
});
