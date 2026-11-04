// Strict, bounded transfer of a complete MP4 GET response into Drive-sized chunks.
// A video CDN is not required to support HTTP Range for this code path.
export const MAX_REMOTE_MP4_BYTES = 512 * 1024 * 1024;

function assertMP4Prefix(bytes) {
  if(bytes.length < 12 || String.fromCharCode(...bytes.subarray(4,8)) !== "ftyp")
    throw Error("Nguồn không trả MP4 thực sự (thiếu ftyp); từ chối tải HTML/HLS giả MP4");
}

export async function pumpMP4Stream(body,total,chunkSize,onPart,onProgress=()=>{}) {
  if(!body || typeof body.getReader!=="function")
    throw Error("Trình duyệt không hỗ trợ đọc video dạng stream");
  if(!Number.isSafeInteger(total)||total<12||total>MAX_REMOTE_MP4_BYTES)
    throw Error("Kích thước MP4 phải từ 12 byte đến 512 MiB");
  if(!Number.isSafeInteger(chunkSize)||chunkSize<12||chunkSize>8*1024*1024)
    throw Error("Kích thước chunk không hợp lệ");
  if(typeof onPart!=="function")throw Error("Thiếu callback tải khối video");

  const reader=body.getReader();
  let downloaded=0,uploaded=0,buffer=new Uint8Array(Math.min(chunkSize,total)),filled=0;
  const prefix=new Uint8Array(12);
  let prefixCount=0,completed=false;
  try {
    while(true) {
      const {value,done}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw Error("Stream không trả dữ liệu nhị phân");
      if(value.length===0)continue;
      if(downloaded+value.length>total)
        throw Error("Nguồn trả nhiều dữ liệu hơn Content-Length; đã chặn ghi file lỗi");
      if(prefixCount<12){
        const n=Math.min(12-prefixCount,value.length);
        prefix.set(value.subarray(0,n),prefixCount);
        prefixCount+=n;
        if(prefixCount===12)assertMP4Prefix(prefix);
      }
      let offset=0;
      while(offset<value.length){
        const take=Math.min(buffer.length-filled,value.length-offset);
        buffer.set(value.subarray(offset,offset+take),filled);
        offset+=take;filled+=take;downloaded+=take;
        if(filled===buffer.length){
          const start=uploaded,end=start+filled-1;
          await onPart(buffer,start,end,total);
          uploaded+=filled;
          filled=0;
          if(uploaded<total)buffer=new Uint8Array(Math.min(chunkSize,total-uploaded));
          onProgress(Math.round(uploaded/total*100));
        }
      }
    }
    if(prefixCount<12||downloaded!==total||uploaded!==total||filled!==0)
      throw Error("Nguồn gửi thiếu dữ liệu ("+downloaded+"/"+total+" byte); không hoàn tất upload");
    completed=true;
    return {size:uploaded,parts:Math.ceil(uploaded/chunkSize)};
  }finally{
    if(!completed)await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
