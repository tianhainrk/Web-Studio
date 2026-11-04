import test from "node:test";import assert from "node:assert/strict";
import {decodeCatalog,decodePlaylist,PB,numericID} from "../src/provider.mjs";
test("catalog identifies valid movie and cursor",()=>{const v=decodeCatalog({status_code:0,collections:[{collection_id_str:"7676620083434656784",title:"Phim mẫu",num_videos:2}],has_more:true,cursor:""});assert.equal(v.movies.length,1);assert.equal(v.blockedByEmptyCursor,true)});
test("safe decimal identity",()=>{assert.equal(numericID("7676620083434656784"),"7676620083434656784");assert.throws(()=>numericID("900719925474099312345"))});
test("playlist validates complete episodes",()=>{const p=decodePlaylist({status_code:0,episode_list:[{video_id_str:"7676620734394862865",num:1,seq_id:1,is_limited_free:true},{video_id_str:"7676620627842731265",num:2,seq_id:2,is_limited_free:true}]},{id:"7676620083434656784",episodeCount:2});assert.equal(p.episodes.length,2);assert.equal(p.episodes[0].locked,false)});
test("playlist rejects missing episodes",()=>assert.throws(()=>decodePlaylist({status_code:0,episode_list:[{video_id_str:"7676620734394862865",num:1,seq_id:1}]},{id:"7676620083434656784",episodeCount:2})));
test("protobuf detects malformed buffer",()=>assert.throws(()=>new PB(new Uint8Array([0x0a,0xff]))));
