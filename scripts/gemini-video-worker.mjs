import {runVideoBatchWorker} from "../src/gemini-video.mjs";

runVideoBatchWorker().catch(err=>{
  console.error("Gemini video worker fatal:",err.message);
  process.exitCode=1;
});
