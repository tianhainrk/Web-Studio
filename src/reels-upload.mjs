// Meta's rupload endpoint does not accept a chunked transfer without a
// declared entity length. Node fetch() defaults to chunked transfer for a
// ReadableStream unless Content-Length is explicitly set.
export function reelUploadHeaders(token,size){
  if(typeof token!=="string"||!token.trim())throw Error("Thiếu token Fanpage");
  if(!Number.isSafeInteger(size)||size<1||size>512*1024*1024)throw Error("Kích thước MP4 không hợp lệ");
  return {
    "Authorization":"OAuth "+token,
    "offset":"0",
    "file_size":String(size),
    "Content-Type":"application/octet-stream",
    "Content-Length":String(size),
    "X-Entity-Length":String(size)
  };
}
// Retrying an unknown publish outcome can duplicate a Reel.
// These errors happen before the finish/publish phase.
export function safeToRetryFailedUpload(job){
  return job?.status==="failed"&&
    /^Meta upload HTTP 400:/.test(String(job.error||""));
}
