import test from "node:test";
import assert from "node:assert/strict";
import {catalogPlan, summarizeCategories,categoryRequestBody,FEEDS,enrichCatalog,common} from "../src/library.mjs";
const id="7676620083434656784";
test("supports the verified library feeds",()=>assert.deepEqual(FEEDS,["home","hot","ranking","new","categories"]));
test("home starts with native init_fetch fields",()=>{
 const result=catalogPlan({feed:"home",count:14});
 assert.equal(result.params.scene,"1");
 assert.equal(result.params.drama_request_type,"init_fetch");
 assert.equal(result.params.collection_count_in_session,"0");
 assert.equal(result.params.drama_current_collections,"");
});
test("home continuation uses real loaded IDs, never invents cursor",()=>{
 const result=catalogPlan({feed:"home",loaded:[id],total:14,count:14});
 assert.equal(result.params.drama_request_type,"load_more");
 assert.equal(result.params.drama_current_collections,id);
 assert.equal(result.params.collection_count_in_session,"14");
 assert.equal(result.params.cursor,"");
});
test("ranking and new releases keep native scenes and server cursor",()=>{
 for(const [feed,scene] of [["hot","6"],["ranking","7"],["new","8"]]){
  const p=catalogPlan({feed,cursor:"1:16:12"});
  assert.equal(p.params.scene,scene);
  assert.equal(p.params.cursor,"1:16:12");
  assert.equal(p.params.count,feed==="new"?"12":"10");
 }
});
test("invalid duplicate or invented loaded IDs are rejected",()=>{
 assert.throws(()=>catalogPlan({feed:"home",loaded:[id,id],total:2}));
 assert.throws(()=>catalogPlan({feed:"home",loaded:["1:16"],total:1}));
 assert.throws(()=>catalogPlan({feed:"hot",cursor:"x".repeat(513)}));
});
const filters={category_filter_lists:[
 {category_filters:[{name:"Tất cả",name_en:"all_settings",filter_type:1,category_id:"0"},{name:"Kỳ ảo",filter_type:2,category_id:"7628991192537158672"}]},
 {category_filters:[{name:"Tất cả",name_en:"all_characters",filter_type:1,category_id:"0"}]},
 {category_filters:[{name:"Tất cả",name_en:"all_stories",filter_type:1,category_id:"0"}]},
 {category_filters:[{name:"Tất cả",name_en:"all_releases",filter_type:1,category_id:"0"},{name:"7 ngày",filter_type:3,recent_days:7}]}
]};
test("category metadata maps the original 4 groups and preserves raw selected objects",()=>{
 const groups=summarizeCategories(filters);
 assert.equal(groups.length,4);
 const initial=categoryRequestBody(groups,{},"");
 assert.deepEqual(initial.body.category_filters,[]);
 const selected=categoryRequestBody(groups,{background:"7628991192537158672",release:"days:7"},"1:14");
 assert.equal(selected.body.cursor,"1:14");
 assert.equal(selected.body.category_filters.length,4);
 assert.equal(selected.body.category_filters[0].category_id,"7628991192537158672");
 assert.equal(selected.body.category_filters[3].recent_days,7);
});
test("unrecognized categories and release windows are rejected",()=>{
 const groups=summarizeCategories(filters);
 assert.throws(()=>categoryRequestBody(groups,{release:"days:2"}));
 assert.throws(()=>categoryRequestBody(groups,{unexpected:"1"}));
});

test("native ranking request honors count 10 versus 12",()=>{
 const a=catalogPlan({feed:"hot",count:10});
 const b=catalogPlan({feed:"hot",count:12});
 assert.equal(a.params.count,"10");
 assert.equal(b.params.count,"12");
 assert.throws(()=>catalogPlan({feed:"hot",count:50}));
});

test("API metadata keeps watched and ranking heat as separate metrics",()=>{
 const data={status_code:0,collections:[{collection_id_str:"7676268004619441173",title:"Sống Lại Gả Cho Chồng Kiếp Trước",num_videos:30,num_watched:8653894,heat_score:310400502}],has_more:false,drama_rankings_update_tsp:1793592000};
 const result=enrichCatalog(data);
 assert.equal(result.movies[0].viewCount,8653894);
 assert.equal(result.movies[0].heatScore,310400502);
 assert.equal(result.rankingUpdatedAt,1793592000);
});

test("Vietnam rankings include the experimentally verified carrier_region selector",()=>{
 assert.equal(common().carrier_region,"VN");
 assert.equal(common().region,"VN");
 assert.equal(common().sys_region,"VN");
});

test("new works uses native scene 8 count 12 and advances actual server cursors",()=>{
 const first=catalogPlan({feed:"new"});
 assert.equal(first.path,"mini_drama_center/v1/");
 assert.deepEqual(
   {scene:first.params.scene,category_id:first.params.category_id,cursor:first.params.cursor,count:first.params.count,carrier_region:common().carrier_region},
   {scene:"8",category_id:"0",cursor:"",count:"12",carrier_region:"VN"}
 );
 assert.ok(!("recent_days" in first.params));
 assert.ok(!("drama_request_type" in first.params));
 const next=catalogPlan({feed:"new",cursor:"1:24"});
 assert.equal(next.params.cursor,"1:24");
 assert.throws(()=>catalogPlan({feed:"new",count:10}));
});
