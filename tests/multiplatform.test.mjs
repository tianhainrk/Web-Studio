import test from "node:test";
import assert from "node:assert/strict";
import {cleanPostRequest,verifyMediaUrl,youtubeTitle,tiktokStatus,isTikTokApprovedPrivate} from "../src/multiplatform-core.mjs";
import {isOAuthCallbackRequest,oauthState,verifyOauthState} from "../src/reels-core.mjs";
const t=Date.parse("2026-11-07T00:00:00Z");
const request={provider:"youtube",accountId:"873cedde-f813-4847-850f-dc1d76c1b57b",
  folderId:"folder1234567",fileId:"file12345678",filename:"EP001.mp4",
  scheduledAt:"2026-11-07T12:00:00.000Z",rightsConfirmed:true,consentToPublish:true,
  title:"Chương đầu #Shorts",caption:"Nội dung ngắn",privacy:"public"};
test("YouTube queue requires explicit consent, rights, correct file and future time",()=>{
  const j=cleanPostRequest(request,{now:t});
  assert.equal(j.provider,"youtube");assert.equal(j.privacy,"public");
  assert.equal(j.scheduled_at,"2026-11-07T12:00:00.000Z");
  assert.equal(j.source_url,null);assert.ok(j.rights_confirmed_at);
  assert.throws(()=>cleanPostRequest({...request,rightsConfirmed:false},{now:t}),/quyền phân phối/);
  assert.throws(()=>cleanPostRequest({...request,consentToPublish:false},{now:t}),/đồng ý/);
  assert.throws(()=>cleanPostRequest({...request,filename:"clip.mp4"},{now:t}),/EPxxx/);
  assert.throws(()=>cleanPostRequest({...request,scheduledAt:"2026-11-06T12:00:00Z"},{now:t}),/giờ đăng/);
  assert.throws(()=>youtubeTitle("x".repeat(101)),/100/);
});
test("TikTok must use verified HTTPS host and private unless audited",()=>{
  const body={...request,provider:"tiktok",privacy:"SELF_ONLY",
    sourceUrl:"https://video.example.vn/shorts/ep001.mp4"};
  const j=cleanPostRequest(body,{now:t,verifiedHost:"video.example.vn"});
  assert.equal(j.source_url,body.sourceUrl);
  assert.throws(()=>cleanPostRequest({...body,privacy:"PUBLIC_TO_EVERYONE"},
    {now:t,verifiedHost:"video.example.vn"}),/audit/);
  assert.throws(()=>verifyMediaUrl("https://video.example.vn.evil.com/clip.mp4","video.example.vn"),/tên miền/);
  assert.throws(()=>verifyMediaUrl("http://video.example.vn/a.mp4","video.example.vn"),/HTTPS/);
  assert.throws(()=>verifyMediaUrl("https://user:pass@video.example.vn/clip.mp4","video.example.vn"),/HTTPS/);
  assert.ok(isTikTokApprovedPrivate("SELF_ONLY",{privacy_level_options:["SELF_ONLY"]}));
  assert.ok(!isTikTokApprovedPrivate("PUBLIC_TO_EVERYONE",{privacy_level_options:["SELF_ONLY"]}));
  assert.equal(tiktokStatus("PUBLISH_COMPLETE"),"published");
  assert.equal(tiktokStatus("FAILED"),"failed");
  assert.equal(tiktokStatus("PROCESSING_UPLOAD"),"processing");
});
test("Only exact OAuth callbacks bypass cross-site origin check",()=>{
  for(const provider of ["youtube","tiktok"]){
    const path="/reels/multi/oauth/"+provider+"/callback";
    assert.equal(isOAuthCallbackRequest("GET",path),true);
    assert.equal(isOAuthCallbackRequest("POST",path),false);
  }
  assert.equal(isOAuthCallbackRequest("GET","/reels/multi/oauth/tiktok/start"),false);
  assert.equal(isOAuthCallbackRequest("GET","/reels/multi/oauth/evil/callback"),false);
  const secret="a".repeat(64);
  const st=oauthState("youtube","https://anpinime-dramavideo.vercel.app",secret);
  assert.ok(verifyOauthState(st,"youtube","https://anpinime-dramavideo.vercel.app",secret));
  assert.ok(!verifyOauthState(st,"tiktok","https://anpinime-dramavideo.vercel.app",secret));
});
