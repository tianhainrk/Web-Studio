import {runAnalyticsWorker} from "../src/reels-analytics-worker.mjs";
if(process.env.REELS_ANALYTICS_ENABLED!=="true"){
  console.log("Analytics disabled. Set REELS_ANALYTICS_ENABLED=true in GitHub Actions Variables after applying SQL.");
}else{
  runAnalyticsWorker().catch(error=>{
    console.error("Analytics worker failed:",String(error.message||error).replace(/access_token=[^&\s]+/gi,"[REDACTED]").slice(0,220));
    process.exitCode=1;
  });
}
