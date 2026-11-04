import {
  driveConnected,ensureDownloaderImportFolder,uploadDownloaderLocalMP4,
  uploadDownloaderRemoteMP4,saveDownloaderImportMetadata
} from "./drive-transfer.js";

const $=id=>document.getElementById(id);
const model={series:null,rows:[],files:new Map(),selected:new Set(),running:false,stop:false,folder:null};
function log(msg){const now=new Date().toLocaleTimeString("vi-VN");$("log").textContent+="\n["+now+"] "+msg;$("log").scrollTop=$("log").scrollHeight;}
function show(text){$("authInfo").textContent=text;}
function safeId(value){
 const s=String(value??"").trim();
 if(!/^[a-zA-Z0-9_-]{3,90}$/.test(s))throw Error("Series ID chỉ nhận chữ/số, dấu - và _ (3–90 ký tự)");
 return s;
}
function normalize(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("JSON phải là object");
 const meta=input.data?.series&&typeof input.data.series==="object"?input.data.series:input.series||input;
 const episodes=meta.episodes||input.episodes||meta.data?.episodes;
 if(!Array.isArray(episodes)||!episodes.length||episodes.length>5000)throw Error("episodes phải là mảng 1–5000 tập");
 const inferred=String(meta.platform||input.platform||$("platform").value).toLowerCase();
 const platform=inferred.replace(/[^a-z0-9_-]/g,"");
 if(!$("platform").querySelector('option[value="'+platform+'"]'))throw Error("Nền tảng chưa được hỗ trợ");
 const rawId=String(meta.series_id||meta.seriesId||meta.id||$("seriesId").value).trim();
 const id=safeId(rawId.includes(":")?rawId.split(":").pop():rawId);
 const title=String(meta.name||meta.title||$("seriesTitle").value||"Phim "+id).trim().slice(0,120);
 const numbers=new Set();
 const rows=episodes.map((ep,i)=>{
   if(!ep||typeof ep!=="object")throw Error("Tập "+(i+1)+" không phải object");
   const number=Number(ep.num??ep.number??(ep.chapterIndex!==undefined?Number(ep.chapterIndex)+1:i+1));
   if(!Number.isInteger(number)||number<1||number>5000||numbers.has(number))throw Error("Số tập thiếu, bị trùng hoặc quá 5000: "+number);
   numbers.add(number);
   const title=String(ep.title||ep.chapterName||"Tập "+number).slice(0,120);
   const value=ep.direct_url??ep.directUrl??ep.videoUrl??null;
   const url=typeof value==="string"?value.trim():"";
   const locked=ep.locked===true||ep.locked===1||ep.locked==="true"||ep.isCharge===1&&ep.isPay!==1;
   const sourceLocked=ep.source_locked===true||ep.source_status==="web_restricted"||locked;
   return {number,title,url,locked,sourceLocked,sourceStatus:String(ep.source_status||"")};
 }).sort((a,b)=>a.number-b.number);
 return {platform,id,title,episodeCount:rows.length,episodes:rows};
}
function selectFile(file){
 if(!/\.mp4$/i.test(file.name))return null;
 const m=/^(?:EP|E|TAP|TAP-?)0*(\d+)(?:\D.*)?\.mp4$/i.exec(file.name);
 if(!m)return null;
 const n=Number(m[1]);
 if(!Number.isInteger(n)||n<1||n>5000)return null;
 return n;
}
function hasMP4Url(row){
 if(!row.url||row.locked)return false;
 try{
   const u=new URL(row.url);
   return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&!u.hash&&!u.pathname.toLowerCase().endsWith(".m3u8");
 }catch{return false}
}
function render(){
 const box=$("episodes");box.replaceChildren();
 const rows=model.rows;
 $("counts").textContent=rows.length+" tập · "+model.selected.size+" đã chọn · "+model.files.size+" MP4 local";
 if(!rows.length){box.textContent="Chưa có danh sách.";return}
 const frag=document.createDocumentFragment();
 for(const row of rows){
   const item=document.createElement("div");item.className="ep";
   const check=document.createElement("input");check.type="checkbox";check.checked=model.selected.has(row.number);
   check.disabled=model.running||(row.locked&&!model.files.has(row.number));check.setAttribute("aria-label","Chọn tập "+row.number);
   check.addEventListener("change",()=>{if(check.checked)model.selected.add(row.number);else model.selected.delete(row.number);render()});
   const num=document.createElement("b");num.textContent="Tập "+row.number;
   const title=document.createElement("span");title.textContent=row.title;
   const state=document.createElement("span");state.className="state";
   if(model.files.has(row.number)){state.textContent=(row.locked?"Nguồn web hạn chế · ":"")+"Có MP4 từ thiết bị · có thể lưu lên Drive khi có quyền";state.classList.add("ready")}
   else if(row.locked){state.textContent="Nguồn web hạn chế · chưa có MP4. Có thể thêm MP4 hợp lệ từ thiết bị";state.classList.add("locked")}
   else if(hasMP4Url(row)){state.textContent="Có URL · sẽ kiểm tra HTTPS/CORS, MP4 và byte-range";state.classList.add("ready")}
   else if(row.url){state.textContent="Không phải URL MP4 công khai hợp lệ · cần tệp MP4"}
   else{state.textContent="Chưa có video · cần tệp MP4"}
   item.append(check,num,title,state);frag.appendChild(item);
 }
 box.append(frag);
 $("upload").disabled=model.running||!model.rows.length||!driveConnected();
 $("all").disabled=model.running;$("none").disabled=model.running;$("localSelect").disabled=model.running;
 $("parse").disabled=model.running;$("localFiles").disabled=model.running;
}
async function readManifest(){
 const raw=$("manifest").value.trim();
 if(!raw)throw Error("Chưa dán JSON hoặc chọn file JSON");
 const parsed=JSON.parse(raw);
 const series=normalize(parsed);
 model.series=series;model.rows=series.episodes;model.selected.clear();model.folder=null;
 $("platform").value=series.platform;$("seriesId").value=series.id;$("seriesTitle").value=series.title;
 for(const row of series.episodes)if(hasMP4Url(row))model.selected.add(row.number);
 render();log("Đọc "+series.episodeCount+" tập của "+series.platform+":"+series.id+". Đã chọn "+model.selected.size+" tập có URL, chưa có dữ liệu nào được tải.");
}

$("pythonInspect").addEventListener("click",async()=>{
  if(model.running)return;
  const target=$("autoTarget").value.trim();
  if(!target){$("autoStatus").textContent="Vui lòng nhập Book ID hoặc link phim.";return}
  const button=$("pythonInspect");
  button.disabled=true;
  $("autoStatus").textContent="Đang chạy DramaDownloader Python trên máy chủ; có thể cần kết nối nhiều nguồn…";
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),65000);
  try{
    const response=await fetch("/api/dramadownloader-python",{
      method:"POST",
      credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({target}),
      cache:"no-store",
      signal:controller.signal
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(payload.error||"Python bridge HTTP "+response.status);
    if(!payload?.series||!Array.isArray(payload.series.episodes)||!payload.series.episodes.length)
      throw Error("DramaDownloader không trả danh sách tập hợp lệ");
    $("manifest").value=JSON.stringify(payload.series,null,2);
    await readManifest();
    const ready=model.rows.filter(row=>hasMP4Url(row)).length;
    $("autoStatus").textContent="DramaDownloader Python: "+model.rows.length+
      " tập · "+ready+" tập có URL HTTPS.";
    log("Python đã lấy danh sách "+model.rows.length+" tập; "+ready+" URL khả dụng.");
    $("episodes").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    $("autoStatus").textContent="Không thể lấy bằng Python: "+String(e.message||e);
    log("DramaDownloader Python: "+String(e.message||e));
  }finally{
    clearTimeout(timer);
    button.disabled=false;
  }
});

$("manifestFile").addEventListener("change",async event=>{
 const file=event.target.files?.[0];if(!file)return;
 if(file.size>1024*1024){log("Lỗi: JSON vượt 1 MiB.");return}
 try{$("manifest").value=await file.text();await readManifest()}catch(e){log("Lỗi đọc JSON: "+e.message)}
});
$("parse").addEventListener("click",()=>{readManifest().catch(e=>log("Lỗi JSON: "+e.message))});
$("clear").addEventListener("click",()=>{
 if(model.running)return;
 $("manifest").value="";$("manifestFile").value="";
 model.series=null;model.rows=[];model.selected.clear();model.files.clear();model.folder=null;
 render();log("Đã xóa danh sách và file được chọn.");
});
$("all").addEventListener("click",()=>{for(const row of model.rows)if(hasMP4Url(row))model.selected.add(row.number);render()});
$("localSelect").addEventListener("click",()=>{for(const row of model.rows)if(model.files.has(row.number))model.selected.add(row.number);render()});
$("none").addEventListener("click",()=>{model.selected.clear();render()});
async function validateMP4File(file){
 if(!file||file.size<12)throw Error("File quá nhỏ để là MP4");
 const first=new Uint8Array(await file.slice(0,32).arrayBuffer());
 if(first.length<12)throw Error("File trống");
 const signature=String.fromCharCode(...first.slice(4,8));
 if(signature!=="ftyp")throw Error("Không phải MP4 hợp lệ (thiếu ftyp); trình tải nguồn có thể đã lưu HTML/M3U8 thành .mp4");
 const type=String.fromCharCode(...first.slice(8,12));
 if(!/^[\x20-\x7e]{4}$/.test(type))throw Error("Header MP4 không hợp lệ");
 return true;
}
$("localFiles").addEventListener("change",async event=>{
 model.files.clear();let rejected=0;
 for(const file of event.target.files||[]){
  const number=selectFile(file);
  if(number===null||!file.size||!["","video/mp4","application/octet-stream"].includes(file.type)){rejected++;continue}
  try{await validateMP4File(file);model.files.set(number,file)}
  catch(err){rejected++;log("Bỏ qua "+file.name+": "+err.message)}
 }
 $("filesInfo").textContent=model.files.size+" MP4 có header hợp lệ đã nhận theo tên EP###.mp4"+
   (rejected?" · "+rejected+" file bị loại":"")+
   " · Kiểm tra header không xác nhận file có thể giải mã và phát hoàn chỉnh.";
 render();
});
$("stop").addEventListener("click",()=>{model.stop=true;log("Đã yêu cầu dừng sau tập hiện tại.")});
$("upload").addEventListener("click",async()=>{
 if(model.running||!model.series)return;
 if(!driveConnected()){log("Google Drive chưa kết nối. Quay lại Studio để kết nối.");return}
 const rows=model.rows.filter(row=>model.selected.has(row.number));
 if(!rows.length){log("Chưa chọn tập nào.");return}
 if(rows.some(row=>row.locked&&!model.files.has(row.number))){log("Tập bị hạn chế trên web chưa có MP4 cục bộ; hãy bổ sung file đã được phép sử dụng.");return}
 if(!confirm("Bạn xác nhận có quyền lưu trữ các video đã chọn trên Google Drive của mình?"))return;
 model.running=true;model.stop=false;
 $("stop").disabled=false;render();$("upload").disabled=true;
 $("progress").textContent="Đang chuẩn bị Drive…";
 const successful=[];
 try{
  model.folder=await ensureDownloaderImportFolder(model.series);
  log("Đã mở thư mục PineDrama-Library/DramaDownloader/"+model.series.platform+"/"+model.series.id);
  for(let i=0;i<rows.length;i++){
   if(model.stop){log("Dừng theo yêu cầu.");break}
   const row=rows[i],file=model.files.get(row.number),url=hasMP4Url(row)?row.url:"";
   $("progress").textContent=(i+1)+"/"+rows.length+" · Tập "+row.number;
   if(!file&&!url){log("Tập "+row.number+": không có MP4 hợp lệ, bỏ qua.");continue}
   try{
    let result;
    const cb=pct=>{$("progress").textContent=(i+1)+"/"+rows.length+" · Tập "+row.number+" · "+pct+"%"};
    if(file){await validateMP4File(file);result=await uploadDownloaderLocalMP4(model.folder,row.number,file,cb)}
    else result=await uploadDownloaderRemoteMP4(model.folder,row.number,url,cb);
    successful.push(row.number);
    log("Tập "+row.number+": "+(result.skipped?"đã có trên Drive (bỏ qua)":"đã tải lên Drive")+" · "+result.size+" bytes");
   }catch(e){log("Tập "+row.number+": "+e.message+" · Thử đính kèm MP4 cục bộ nếu URL bị CORS từ chối.")}
  }
  await saveDownloaderImportMetadata(model.folder,model.series,successful);
  $("progress").textContent="Đã xử lý "+rows.length+" tập · "+successful.length+" thành công/có sẵn";
  log("Đã ghi manifest.json (không chứa token hoặc link video). Thư mục: https://drive.google.com/drive/folders/"+model.folder);
 }catch(e){log("Lỗi tải lên Drive: "+e.message);$("progress").textContent="Lỗi"}
 finally{model.running=false;$("stop").disabled=true;render()}
});
(async()=>{
 try{
  const res=await fetch("/api/me",{credentials:"same-origin"});
  const data=await res.json();
  if(!res.ok||!data.authenticated){show("Bạn cần đăng nhập Studio ở trang chủ trước khi sử dụng trình nhập.");$("upload").disabled=true;return}
  show(driveConnected()?"Studio đã đăng nhập · Google Drive đã kết nối.":"Studio đã đăng nhập · Google Drive chưa kết nối. Quay lại trang chủ, chọn tab Google Drive và đăng nhập.");
  render();
 }catch(e){show("Không xác minh được phiên Studio: "+e.message)}
})();
