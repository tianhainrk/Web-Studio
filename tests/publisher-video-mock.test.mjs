import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {seal} from "../src/reels/publisher-storage.mjs";
import {beginVideoUpload,transferOneChunk,finalizeVideoUpload,videoStatus} from "../src/reels/publisher-video.mjs";

test("mocked Drive -> Meta chunked upload -> future scheduled -> published",async()=>{
  const originalFetch=globalThis.fetch;
  const saved={};
  const old={};
  for(const k of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PUBLISHER_ENCRYPTION_KEY",
    "GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","META_GRAPH_VERSION"]){
    old[k]=process.env[k];
  }
  Object.assign(process.env,{
    SUPABASE_URL:"https://test-supabase.example",SUPABASE_SERVICE_ROLE_KEY:"fake-service-key",
    PUBLISHER_ENCRYPTION_KEY:randomBytes(32).toString("base64"),
    GOOGLE_CLIENT_ID:"fake-web.apps.googleusercontent.com",GOOGLE_CLIENT_SECRET:"test-secret",
    META_GRAPH_VERSION:"v24.0"
  });
  const future=new Date(Date.now()+2*60*60*1000).toISOString();
  const campaignId="22222222-2222-4222-8222-222222222222";
  const postId="11111111-1111-4111-8111-111111111111";
  const pageId="12345678912";
  const credentialRows=[
    {id:"google-drive",provider:"google-drive",ciphertext:seal({refresh_token:"test-refresh"})},
    {id:"meta-page-"+pageId,provider:"meta-page",ciphertext:seal({page_id:pageId,access_token:"test-page-token"})}
  ];
  const campaign={id:campaignId,status:"approved"};
  const post={
    id:postId,campaign_id:campaignId,page_id:pageId,drive_file_id:"drive_file_testing_00001",
    status:"approved",rights_approved:true,editorial_approved:true,caption:"Mô tả phim có quyền đăng",
    scheduled_at:future,file_size:null,start_offset:0,lock_token:null
  };
  const calls=[];
  const response=(value,code=200,headers={})=>new Response(JSON.stringify(value),{
    status:code,headers:{"Content-Type":"application/json",...headers}
  });
  function queryMatch(row,search){
    for(const [k,v] of search.entries()){
      if(["select","order","limit","on_conflict"].includes(k))continue;
      if(v.startsWith("eq.")&&String(row[k])!==v.slice(3))return false;
    }
    return true;
  }
  globalThis.fetch=async(raw,opts={})=>{
    const url=new URL(String(raw));
    const method=opts.method||"GET";
    calls.push({path:url.pathname,method});
    if(url.host==="test-supabase.example"&&url.pathname.startsWith("/rest/v1/")){
      const table=url.pathname.split("/").at(-1);
      let rows=table==="publisher_credentials"?credentialRows:
        table==="publisher_campaigns"?[campaign]:[post];
      if(method==="GET")return response(rows.filter(r=>queryMatch(r,url.searchParams)));
      if(method==="PATCH"){
        const selected=rows.filter(r=>queryMatch(r,url.searchParams));
        for(const row of selected)Object.assign(row,JSON.parse(opts.body));
        return response(selected);
      }
      throw Error("Unrecognized DB method "+method);
    }
    if(url.host==="oauth2.googleapis.com"&&url.pathname==="/token")
      return response({access_token:"drive-test-token"});
    if(url.host==="www.googleapis.com"){
      if(url.searchParams.get("alt")==="media"){
        const bytes=Buffer.alloc(1024,7);
        return new Response(bytes,{status:206,headers:{
          "Content-Type":"video/mp4","Content-Range":"bytes 0-1023/1024"
        }});
      }
      return response({id:post.drive_file_id,mimeType:"video/mp4",name:"EP001.mp4",size:"1024",trashed:false});
    }
    if(url.host==="graph-video.facebook.com"){
      if(opts.body instanceof FormData){
        assert.equal(opts.body.get("upload_phase"),"transfer");
        assert.equal(opts.body.get("start_offset"),"0");
        assert.equal(opts.body.get("video_file_chunk").size,1024);
        return response({start_offset:"1024",end_offset:"1024"});
      }
      const body=new URLSearchParams(opts.body);
      if(body.get("upload_phase")==="start"){
        assert.equal(body.get("file_size"),"1024");
        return response({upload_session_id:"session-123",video_id:"123123123",start_offset:"0",end_offset:"1024"});
      }
      if(body.get("upload_phase")==="finish"){
        assert.equal(body.get("published"),"false");
        assert.ok(Number(body.get("scheduled_publish_time"))>Date.now()/1000);
        return response({success:true});
      }
    }
    if(url.host==="graph.facebook.com"&&url.pathname.endsWith("/123123123"))
      return response({id:"123123123",published:true,status:{video_status:"ready"}});
    throw Error("Unexpected external request "+method+" "+url.origin+url.pathname);
  };
  try{
    const initialized=await beginVideoUpload(postId);
    assert.equal(initialized.status,"uploading");
    assert.equal(initialized.meta_video_id,"123123123");
    const chunk=await transferOneChunk(postId);
    assert.equal(chunk.done,true);
    assert.equal(chunk.offset,1024);
    const final=await finalizeVideoUpload(postId);
    assert.equal(final.status,"scheduled");
    const checked=await videoStatus(postId);
    assert.equal(checked.post.status,"published");
    assert.ok(calls.some(c=>c.path==="/drive/v3/files/"+post.drive_file_id));
    assert.ok(calls.some(c=>c.path==="/v24.0/"+pageId+"/videos"));
  }finally{
    globalThis.fetch=originalFetch;
    for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
