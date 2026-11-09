// Trigger the existing GitHub Actions worker without exposing credentials to the browser.
// This is optional: an authenticated UI retry still queues the job when no
// dispatch token has been configured.
export async function dispatchReelsWorker(){
  const token=process.env.GITHUB_REELS_WORKFLOW_TOKEN||"";
  if(!token)return {dispatched:false,reason:"missing_token"};
  const repo=process.env.GITHUB_REELS_REPOSITORY||"tianhainrk/Web-Studio";
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error("GITHUB_REELS_REPOSITORY không hợp lệ");
  const url="https://api.github.com/repos/"+repo+"/actions/workflows/reels-worker.yml/dispatches";
  const response=await fetch(url,{method:"POST",headers:{
    "Authorization":"Bearer "+token,
    "Accept":"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28",
    "Content-Type":"application/json",
    "User-Agent":"AnpiDrama-Reels-Worker"
  },body:JSON.stringify({ref:"main"}),redirect:"error",signal:AbortSignal.timeout(12000)});
  if(response.status!==204)throw Error("GitHub Actions từ chối kích hoạt worker (HTTP "+response.status+")");
  return {dispatched:true};
}
