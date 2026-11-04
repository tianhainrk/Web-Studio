import {discoverLibrary} from "../src/library.mjs";
for(const tz of [["Etc/UTC","0"],["Asia/Ho_Chi_Minh","25200"]]){
 process.env.PINE_TZ_NAME=tz[0];
 process.env.PINE_TZ_OFFSET=tz[1];
 try{
  const hot=await discoverLibrary({feed:"hot",count:10});
  console.log("PROFILE "+tz.join(" / ")+" "+hot.movies.length+" records");
  hot.movies.slice(0,6).forEach((m,i)=>console.log((i+1)+". "+m.title+" | "+m.id+" | "+m.viewCount));
 }catch(e){console.log("PROFILE_ERROR "+tz.join("/")+" "+e.code+" "+e.message)}
}
