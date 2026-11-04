import {discoverLibrary} from "../src/library.mjs";
// Native count is now passed directly through catalogPlan; diagnostic both supported values.
const checks=[["Top hot (native count=10)","hot",10],["Top hot (diagnostic count=12)","hot",12],["Latest ranking","ranking",10],["New works","new",12]];
for(const [name,feed,count] of checks){
 try{
   const data=await discoverLibrary({feed,count});
   console.log("\n=== "+name+" ===");
   console.log("has_more="+data.serverHasMore+" cursor="+JSON.stringify(data.nextCursor)+" records="+data.movies.length+" rankingUpdatedAt="+data.rankingUpdatedAt+" carrier_region="+(process.env.PINE_CARRIER_REGION||"VN"));
   for(let i=0;i<Math.min(data.movies.length,10);i++){
     const m=data.movies[i];
     console.log(String(i+1).padStart(2,"0")+". "+m.title+" | "+m.id+" | heat_score="+m.heatScore+" | num_watched="+m.viewCount);
   }
 }catch(e){console.log("DIAGNOSTIC_ERROR "+name+": "+e.code+" "+e.message)}
}