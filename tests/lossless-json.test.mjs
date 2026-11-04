import test from "node:test";
import assert from "node:assert/strict";
import {parseLosslessJSON} from "../src/lossless-json.mjs";
import {decodeCatalog,decodePlaylist,numericID} from "../src/provider.mjs";
test("preserves unquoted 64-bit movie IDs",()=>{
 const data=parseLosslessJSON('{"status_code":0,"collections":[{"collection_id":7696570358987000001,"title":"Phim","num_videos":40}],"has_more":false}');
 const catalog=decodeCatalog(data);
 assert.equal(catalog.movies[0].id,"7696570358987000001");
 assert.equal(typeof catalog.movies[0].id,"string");
});
test("preserves 64-bit episode IDs in panel",()=>{
 const data=parseLosslessJSON('{"status_code":0,"episode_list":[{"video_id":7676620734394862865,"num":1,"seq_id":1,"is_limited_free":true}]}');
 const result=decodePlaylist(data,{id:"7676620083434656784",episodeCount:1});
 assert.equal(result.episodes[0].id,"7676620734394862865");
});
test("does not rewrite numbers in strings or ordinary numeric fields",()=>{
 const original='{"title":"id: 7676620734394862865","count":12,"decimal":1.25,"expo":1e20,"negative":-9999999999999999}';
 const data=parseLosslessJSON(original);
 assert.equal(data.title,"id: 7676620734394862865");
 assert.equal(data.count,12);assert.equal(data.decimal,1.25);assert.equal(data.expo,1e20);
 assert.equal(data.negative,"-9999999999999999");
});
test("rejects corrupt JSON",()=>assert.throws(()=>parseLosslessJSON('{"id":123')));
test("numericID rejects an unsafe JS number rather than allowing rounded value",()=>assert.throws(()=>numericID(7676620734394862865)));
