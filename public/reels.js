const $=id=>document.getElementById(id);
const selection=new Map();
let pages=[],series=[],episodes=[],jobs=[];
const zone="Asia/Ho_Chi_Minh";
function show(message,bad=false){$("notice").textContent=message;$("notice").className=bad?"error":"ok";}
function el(tag,text,cls){const x=document.createElement(tag);x.textContent=text??"";if(cls)x.className=cls;return x;}
function btn(name,handler,cls="small"){const b=el("button",name,cls);b.type="button";b.onclick=handler;return b;}
async function api(path,body){
  const res=await fetch("/api/reels"+path,{credentials:"same-origin",...(body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  const data=await res.json().catch(()=>({}));
  if(res.status===401){throw Error("Phiên Anpi Drama đã hết hạn, hãy đăng nhập lại");}
  if(!res.ok)throw Error(data.error||"API HTTP "+res.status);
  return data;
}
async function handle(promise){
  try{return await promise;}catch(e){show(e.message||String(e),true);return null;}
}
async function connect(provider){
  const config=await handle(api("/config"));if(!config)return;
  if(!config[provider])return show("Chưa cấu hình OAuth "+provider+" trên Vercel",true);
  location.href="/api/reels/oauth/"+provider+"/start";
}
function pagesUI(){
  const root=$("pages");root.replaceChildren();
  const sel=$("pageSelect");sel.replaceChildren(el("option","Chọn Fanpage"));
  for(const page of pages){
    const row=el("div","","page"),info=el("div",page.name+" ("+page.page_id+")");
    const buttons=el("div","","row");
    buttons.append(btn(page.active?"Tắt":"Bật",()=>handle(api("/pages/active",{pageId:page.page_id,active:!page.active}).then(refreshPages))));
    buttons.append(btn("Xóa",async()=>{
      if(!confirm("Ngắt kết nối Fanpage này?"))return;
      await handle(api("/pages/delete",{pageId:page.page_id}).then(refreshPages));
    },"small danger"));
    row.append(info,buttons);root.append(row);
    if(page.active){const op=el("option",page.name);op.value=page.page_id;sel.append(op);}
  }
  if(!pages.length)root.textContent="Chưa có Fanpage. Hãy kết nối tài khoản Meta có quyền đăng nội dung.";
}
async function refreshPages(){const data=await api("/pages");pages=data.pages||[];pagesUI();}
async function refreshSeries(){
  const data=await api("/drive/series");series=data.series||[];
  const sel=$("series");sel.replaceChildren(el("option","Chọn phim"));
  for(const item of series){const title=item.title||item.name;const o=el("option",title===item.name?title:title+" ("+item.name+")");o.value=item.id;sel.append(o);}
  show("Đã tải "+series.length+" thư mục phim từ Drive.");
}
function episodeUI(){
  const root=$("episodes");root.replaceChildren();
  for(const ep of episodes){
    const active=selection.has(ep.episode);
    root.append(btn("EP"+String(ep.episode).padStart(3,"0"),()=>{if(active)selection.delete(ep.episode);else selection.set(ep.episode,ep);resetPlan();episodeUI();},"ep"+(active?" selected":"")));
  }
  $("selection").textContent="Đã chọn "+selection.size+" / "+episodes.length+" tập.";
}
let episodeLoadSequence=0;
async function refreshEpisodes(){
  const folder=$("series").value,sequence=++episodeLoadSequence;
  selection.clear();episodes=[];resetPlan();episodeUI();
  if(!folder)return show("Hãy chọn một phim từ danh sách.",true);
  $("selection").textContent="Đang tải danh sách tập từ Google Drive...";
  const data=await api("/drive/episodes?folder="+encodeURIComponent(folder));
  if($("series").value!==folder)return;
  if(sequence!==episodeLoadSequence||folder!==$("series").value)return;
  const original=data.episodes||[];episodes=[...new Map(original.map(ep=>[ep.episode,ep])).values()].sort((a,b)=>a.episode-b.episode);selection.clear();resetPlan();episodeUI();
  const current=series.find(x=>x.id===folder);
  if(current){$("aiTitle").value=current.title||current.name;if(!$("campaign").value.trim())$("campaign").value="Reels "+(current.title||current.name);}
  if(episodes.length)$("episodeTo").value=Math.min(episodes[episodes.length-1].episode,10);
  show("Đã tự tải "+episodes.length+" tập"+(original.length>episodes.length?" (ẩn "+(original.length-episodes.length)+" bản trùng).":"."));
  renderDrafts();
}

let initialized=false;
let draftFingerprint="";
const drafts=new Map();
let currentBatch=null;
function getInputs(offset=0,limit=8){
  return {
    name:$("campaign").value.trim(),pageId:$("pageSelect").value,folderId:$("series").value,
    title:$("aiTitle").value.trim(),
    episodes:[...selection.keys()].sort((a,b)=>a-b),
    startDate:$("startDate").value,time:$("startTime").value,
    perDay:Number($("perDay").value),spacingMinutes:Number($("spacing").value),
    instructions:$("museInstructions").value,offset,limit
  };
}
function signature(){
  const x=getInputs();delete x.offset;delete x.limit;delete x.name;delete x.pageId;
  return JSON.stringify(x);
}
function resetPlan(){
  drafts.clear();draftFingerprint="";currentBatch=null;
  videoStatuses.clear();videoBatchId=null;
  if(videoRefreshTimer){clearInterval(videoRefreshTimer);videoRefreshTimer=null;}
  const p=$("musePrompt"),r=$("museReply");if(p)p.value="";if(r)r.value="";
  renderDrafts();
}
function checkFreshness(){
  const s=signature();
  if(draftFingerprint&&draftFingerprint!==s)resetPlan();
  if(!draftFingerprint)draftFingerprint=s;
}
function pendingOffset(){
  const selected=[...selection.keys()].sort((a,b)=>a-b);
  return selected.findIndex(n=>!drafts.has(n));
}
function vLocal(iso){return new Date(Date.parse(iso)+7*3600000).toISOString().slice(0,16);}
function toUTC(value){
  const d=new Date(value+":00+07:00");
  if(!Number.isFinite(d.getTime()))throw Error("Giờ Việt Nam không hợp lệ");
  return d.toISOString();
}
function planReview(){
  const nums=[...selection.keys()].sort((a,b)=>a-b);
  const missing=nums.filter(n=>!drafts.has(n));
  const invalid=nums.filter(n=>drafts.has(n)&&(!String(drafts.get(n).caption||"").trim()||String(drafts.get(n).caption).length>2200||!Number.isFinite(Date.parse(drafts.get(n).scheduledAt))));
  const dates=nums.map(n=>drafts.get(n)?.scheduledAt).filter(Boolean);
  const ordered=dates.every((d,i)=>i===0||Date.parse(d)>Date.parse(dates[i-1]));
  return {nums,missing,invalid,ordered,ready:nums.length>0&&!missing.length&&!invalid.length&&ordered&&!(draftFingerprint&&draftFingerprint!==signature())};
}
let videoBatchId=null,videoRefreshTimer=null;
const videoStatuses=new Map();
function renderDrafts(){
  const root=$("musePreview"),info=$("museDraftCount"),save=$("create");
  if(!root||!info||!save)return;
  const scrolledY=root.scrollTop,scrolledX=root.scrollLeft;
  const state=planReview();
  save.disabled=generating||!state.ready;
  info.textContent="Đã có "+(state.nums.length-state.missing.length)+"/"+state.nums.length+" caption."
    +(state.missing.length?" Còn "+state.missing.length+" tập chưa xong.":"");
  const hint=$("reviewHint");
  if(hint)hint.textContent=state.missing.length?"Thiếu "+state.missing.length+" tập: "+
    state.missing.slice(0,8).map(n=>"EP"+n).join(", ")+(state.missing.length>8?"...":""):
    state.invalid.length?"Caption hoặc ngày giờ chưa hợp lệ tại EP"+state.invalid.join(", EP"):
    !state.ordered?"Lịch chưa tăng dần theo thứ tự tập":
    state.ready?"Đã đủ, có thể duyệt và lưu chiến dịch":"Chưa thể duyệt chiến dịch";
  const summary=$("reviewSummary");
  if(summary){
    summary.replaceChildren();
    for(const [value,label] of [[state.nums.length,"Tập đã chọn"],[state.nums.length-state.missing.length,"Có caption"],[state.missing.length,"Chưa xong"]]){
      const card=el("div","","anpi-review-metric");card.append(el("strong",String(value)),el("small",label));summary.append(card);
    }
  }
  const table=el("table","","anpi-sheet");
  const head=el("thead");const header=el("tr");
  for(const [label,cls] of [["Tập","ep-col"],["Video","file-col"],["Giờ đăng (VN)","time-col"],["Nội dung trong video","source-col"],["Caption — sửa trực tiếp","caption-col"],["Trạng thái","state-col"]]){
    header.append(el("th",label,cls));
  }
  head.append(header);table.append(head);
  const body=el("tbody");
  for(const n of state.nums){
    const item=drafts.get(n),episode=selection.get(n),row=el("tr");
    row.append(el("td","EP"+String(n).padStart(3,"0"),"ep-col"));
    row.append(el("td",episode?.name||"EP"+String(n).padStart(3,"0")+".mp4","file-col"));
    const timeCell=el("td","","time-col");
    if(item){
      const input=el("input");input.type="datetime-local";input.value=vLocal(item.scheduledAt);
      input.onchange=()=>{
        try{
          item.scheduledAt=toUTC(input.value);renderDrafts();
        }catch(error){show(error.message,true);}
      };timeCell.append(input);
    }else timeCell.append(el("span","—","muted"));
    row.append(timeCell);
    row.append(el("td",item?.summary?item.summary+(item.evidence?" · "+item.evidence:""):"Chưa có mô tả nội dung video","source-col"));
    const cap=el("td","","caption-col");
    if(item){
      const area=el("textarea");area.maxLength=2200;area.rows=2;area.value=item.caption;
      area.setAttribute("aria-label","Caption tập "+n);
      area.oninput=()=>{
        item.caption=area.value;
        const latest=planReview();save.disabled=generating||!latest.ready;
        if(hint)hint.textContent=latest.ready?"Đã đủ, có thể duyệt và lưu chiến dịch":"Kiểm tra caption, thời gian và số tập";
      };cap.append(area);
    }else cap.append(el("span","Chưa có caption — nhập JSON Muse","muted"));
    row.append(cap);
    const status=videoStatuses.get(n)||{};
    const label=status.status==="failed"?"Lỗi":status.status==="running"?"Đang đọc MP4":
      status.status==="queued"?"Chờ xử lý":item?"Đã có caption":"Chưa tạo";
    const cell=el("td","","state-col");
    cell.append(el("span",label,"ep-state "+(status.status==="failed"?"failed":item?"ready":"")));
    if(status.status==="failed"&&status.error)cell.append(el("div",status.error,"muted"));
    row.append(cell);body.append(row);
  }
  table.append(body);root.replaceChildren(table);
  root.scrollTop=scrolledY;root.scrollLeft=scrolledX;
}
async function prepareBatch(all=false){
  if(!selection.size||!$("series").value)return show("Bạn cần chọn phim và tập từ Drive trước.",true);
  checkFreshness();
  const offset=all?0:pendingOffset();
  if(offset<0){renderDrafts();return show("Tất cả tập đã có bản nháp. Có thể xem trước và lưu chiến dịch.");}
  const manualOptions=getInputs(offset);
  manualOptions.limit=all?selection.size:Math.min(30,manualOptions.episodes.length-offset);
  manualOptions.museReadDrive=$("planProvider").value==="muse"&&$("museMode").value==="manual"&&$("captionSource").value==="connected_drive";
  const data=await api("/muse/prepare",manualOptions);
  currentBatch={offset,entries:data.entries};
  $("musePrompt").value=data.prompt;
  $("museProgress").textContent="Đã tạo MỘT lệnh cho "+data.entries.length+" tập trong đúng thư mục Drive. Sao chép sang Muse đã kết nối, tải file kết quả JSON về rồi nhập vào bảng.";
  return data;
}
function mergeDraftPlan(plan,entries=currentBatch?.entries){
  if(!Array.isArray(entries)||!Array.isArray(plan)||plan.length!==entries.length)throw Error("AI trả số tập không đúng với dữ liệu Drive");
  for(let i=0;i<plan.length;i++){
    const n=Number(plan[i].episode);
    if(n!==Number(entries[i].episode)||!selection.has(n))throw Error("AI trả tập ngoài danh sách đã chọn: "+n);
  }
  if(!draftFingerprint)draftFingerprint=signature();
  for(const item of plan)drafts.set(Number(item.episode),{...item});
  $("museReply").value="";currentBatch=null;renderDrafts();
  const next=pendingOffset();
  $("museProgress").textContent=next<0?"Đã có đủ "+selection.size+"/"+selection.size+" tập. Kiểm tra và duyệt.":"Đã hoàn thành "+drafts.size+"/"+selection.size+" tập. Còn "+(selection.size-drafts.size)+" tập.";
}
let generating=false;
async function loadVideoBatch(batchId){
  const data=await api("/ai/video/status?batch="+encodeURIComponent(batchId));
  const expected=data.items.map(x=>Number(x.episode)).sort((a,b)=>a-b);
  const selected=getInputs().episodes;
  if(selected.length!==expected.length||selected.some((n,i)=>n!==expected[i]))
    throw Error("Batch Gemini có "+expected.length+" tập khác với lựa chọn hiện tại. Hãy chọn đúng các tập của chiến dịch đã tạo.");
  if(!draftFingerprint)draftFingerprint=signature();
  videoStatuses.clear();
  for(const item of data.items){
    const number=Number(item.episode);
    videoStatuses.set(number,{status:item.status,error:item.error});
    if(item.status==="ready"&&item.caption&&!drafts.has(number)){
      drafts.set(number,{episode:number,scheduledAt:item.scheduled_at,caption:item.caption,summary:item.summary||""});
    }
  }
  renderDrafts();
  const completed=data.items.filter(x=>x.status==="ready").length;
  const failed=data.items.filter(x=>x.status==="failed").length;
  $("museProgress").textContent="Gemini đọc MP4: "+completed+"/"+data.batch.total+" tập hoàn thành"+
    (failed?", "+failed+" tập lỗi.":"")+
    ". Worker GitHub Actions xử lý từng video, không cần giữ trang mở.";
  $("videoRetry").classList.toggle("hidden",!failed);
  if(completed+failed===data.batch.total&&videoRefreshTimer){
    clearInterval(videoRefreshTimer);videoRefreshTimer=null;
  }
  return data;
}
async function startVideoBatch(){
  if(!selection.size)throw Error("Cần chọn ít nhất một tập từ Google Drive");
  checkFreshness();
  if(videoBatchId)throw Error("Đang theo dõi một lượt Gemini. Hãy khôi phục tiến trình thay vì tạo lượt trùng.");
  const input=getInputs(0,selection.size);
  if(!input.title)throw Error("Cần điền tên phim");
  if(!confirm("Gemini sẽ phân tích nội dung thực tế của "+input.episodes.length+" video MP4. Các video được truyền tới Gemini qua worker và có thể phát sinh phí API. Bạn có muốn bắt đầu không?"))return;
  generating=true;$("museGenerate").disabled=true;
  try{
    $("museProgress").textContent="Đang lưu hàng đợi phân tích MP4 cho "+selection.size+" tập...";
    const batch=await api("/ai/video/start",input);
    videoBatchId=batch.batchId;
    sessionStorage.setItem("anpi-video-batch:"+input.folderId,videoBatchId);
    await loadVideoBatch(videoBatchId);
    if(videoRefreshTimer)clearInterval(videoRefreshTimer);
    videoRefreshTimer=setInterval(()=>{if(videoBatchId)loadVideoBatch(videoBatchId).catch(e=>show(e.message,true));},30000);
    show("Đã xếp hàng đợi "+batch.total+" MP4. Cùng một prompt áp dụng cho mọi tập; kết quả được lưu trong Supabase.");
  }finally{generating=false;$("museGenerate").disabled=false;renderDrafts();}
}
async function restoreVideoBatch(){
  const folder=$("series").value;if(!folder)throw Error("Hãy chọn phim trước khi khôi phục");
  const latest=await api("/ai/video/latest?folder="+encodeURIComponent(folder));
  if(!latest.batch?.id)throw Error("Chưa có chiến dịch phân tích video nào trong thư mục phim này");
  videoBatchId=latest.batch.id;
  const data=await api("/ai/video/status?batch="+encodeURIComponent(videoBatchId));
  const nums=data.items.map(x=>Number(x.episode));
  const settings=data.batch.settings||{};
  if(settings.name)$("campaign").value=settings.name;
  if(settings.pageId){
    const found=[...$("pageSelect").options].find(x=>x.value===settings.pageId);
    if(found)$("pageSelect").value=settings.pageId;
  }
  if(data.batch.title)$("aiTitle").value=data.batch.title;
  if(data.batch.instructions!==undefined)$("museInstructions").value=data.batch.instructions;
  if(settings.startDate)$("startDate").value=settings.startDate;
  if(settings.time)$("startTime").value=settings.time;
  if(settings.perDay)$("perDay").value=settings.perDay;
  if(settings.spacingMinutes)$("spacing").value=settings.spacingMinutes;
  if(!episodes.length)throw Error("Chưa tải danh sách tập từ Google Drive");
  selection.clear();
  for(const n of nums){
    const file=episodes.find(x=>x.episode===n);
    if(!file)throw Error("Google Drive không còn tập EP"+n+" của chiến dịch");
    selection.set(n,file);
  }
  drafts.clear();videoStatuses.clear();draftFingerprint="";
  episodeUI();renderDrafts();
  await loadVideoBatch(videoBatchId);
  if(videoRefreshTimer)clearInterval(videoRefreshTimer);
  videoRefreshTimer=setInterval(()=>{if(videoBatchId)loadVideoBatch(videoBatchId).catch(e=>show(e.message,true));},30000);
  show("Đã khôi phục tiến trình Gemini của "+nums.length+" tập.");
}
async function retryVideoBatch(){
  if(!videoBatchId)throw Error("Hãy khôi phục tiến trình Gemini trước");
  const result=await api("/ai/video/retry",{batchId:videoBatchId});
  await loadVideoBatch(videoBatchId);
  if(!videoRefreshTimer)videoRefreshTimer=setInterval(()=>loadVideoBatch(videoBatchId).catch(e=>show(e.message,true)),30000);
  show("Đã xếp lại "+result.retry+" tập lỗi. Các tập đã hoàn thành được giữ nguyên.");
}
async function autoGenerate(){
  if(generating)return;
  if($("planProvider").value==="gemini"&&$("captionSource").value==="video")return startVideoBatch();
  checkFreshness();
  let offset=pendingOffset();
  if(offset<0){renderDrafts();return show("Đã đủ caption tất cả tập.");}
  const provider=$("planProvider").value;
  const fingerprint=draftFingerprint;
  generating=true;$("museGenerate").disabled=true;
  try{
    while(offset>=0){
      const nums=getInputs().episodes;
      $("museProgress").textContent=(provider==="gemini"?"Gemini":"Muse")+" đang tạo tập "+nums[offset]+" đến "+nums[Math.min(offset+7,nums.length-1)]+" ("+drafts.size+"/"+nums.length+")...";
      const data=await api("/ai/generate",{...getInputs(offset),provider});
      if(signature()!==fingerprint)throw Error("Thông tin phim hoặc lịch đã thay đổi trong lúc tạo caption");
      currentBatch={offset,entries:data.plan};
      mergeDraftPlan(data.plan);
      offset=pendingOffset();
    }
    show("Đã tạo đủ "+getInputs().episodes.length+" tập bằng "+(provider==="gemini"?"Gemini":"Muse")+". Hãy kiểm tra trước khi duyệt.");
  }catch(e){
    show(e.message+"; đã giữ "+drafts.size+"/"+getInputs().episodes.length+" caption. Nhấn tạo lại để xử lý các tập còn thiếu.",true);
  }finally{generating=false;$("museGenerate").disabled=false;renderDrafts();}
}
async function manualParse(){
  const raw=$("museReply").value.trim();
  if(!raw)throw Error("Hãy dán JSON hoặc chọn file JSON do Muse xuất");
  checkFreshness();
  const fence=String.fromCharCode(96).repeat(3);
  let cleaned=raw;
  if(cleaned.startsWith(fence))cleaned=cleaned.replace(new RegExp("^"+fence+"(?:json)?\\s*","i"),"").replace(new RegExp("\\s*"+fence+"$"),"").trim();
  let parsed;
  try{parsed=JSON.parse(cleaned);}catch{throw Error("JSON Muse không hợp lệ. Cần cấu trúc {items:[{episode,scheduledAt,caption,summary,evidence}]}");}
  const rows=Array.isArray(parsed)?parsed:parsed?.items;
  if(!Array.isArray(rows)||rows.length===0)throw Error("JSON phải có ít nhất một mục trong items");
  const numbers=new Set(getInputs().episodes);
  const seen=new Set();let previous=-Infinity;
  for(const row of rows){
    const number=Number(row?.episode);
    if(!numbers.has(number)||seen.has(number)||number<=previous)
      throw Error("JSON có tập ngoài lựa chọn, bị trùng hoặc không đúng thứ tự tăng dần");
    seen.add(number);previous=number;
  }
  const driveMode=$("planProvider").value==="muse"&&$("museMode").value==="manual"&&$("captionSource").value==="connected_drive";
  const data=await api("/muse/parse",{...getInputs(0,getInputs().episodes.length),museReadDrive:driveMode,reply:cleaned});
  currentBatch={offset:0,entries:data.entries};
  mergeDraftPlan(data.plan,data.entries);
  if(parsed.cleanup?.status)show("Đã nhập "+rows.length+" tập. Trạng thái dọn workspace Muse: "+parsed.cleanup.status+". Đây là thông tin Muse báo, chưa được Anpi Drama xác minh.");
  else show("Đã nhập "+rows.length+" tập. Hiện có "+drafts.size+"/"+numbers.size+" caption.");
}
async function createCampaign(){
  checkFreshness();
  const input=getInputs();
  const plan=input.episodes.map(n=>drafts.get(n));
  if(!input.pageId||!input.folderId||!input.episodes.length)return show("Cần chọn Fanpage, phim và ít nhất một tập.",true);
  const review=planReview();
  if(!review.ready)return show("Chưa thể duyệt: "+(review.missing.length?"thiếu "+review.missing.map(n=>"EP"+n).join(", "):"caption hoặc lịch đăng chưa hợp lệ"),true);
  if(!confirm("Duyệt "+plan.length+" tập để lưu lịch đăng trên Fanpage? AI chỉ lập bản nháp, worker xử lý khi đến lịch."))return;
  const data=await api("/campaigns/create",{...input,plan});
  show("Đã lưu chiến dịch "+data.count+" tập vào Supabase.");
  resetPlan();await refreshReports();
}
function campaignsUI(campaigns){
  const root=$("campaigns");root.replaceChildren();
  for(const c of campaigns){
    const row=el("div","","page");
    const date=new Date(c.start_at).toLocaleString("vi-VN",{timeZone:zone});
    row.append(el("div",c.name+" · "+date),el("span",c.status,"status"));root.append(row);
  }
  if(!campaigns.length)root.textContent="Chưa có chiến dịch.";
}
async function refreshReports(){
  const [a,b]=await Promise.all([api("/campaigns"),api("/jobs")]);
  campaignsUI(a.campaigns||[]);jobs=b.jobs||[];
  const root=$("jobs");root.replaceChildren();
  for(const j of jobs){
    const tr=document.createElement("tr");
    const cells=[
      "EP"+String(j.episode).padStart(3,"0")+" · "+j.filename,
      pages.find(p=>p.page_id===j.page_id)?.name||j.page_id,
      new Date(j.scheduled_at).toLocaleString("vi-VN",{timeZone:zone}),
      j.status+(j.error?" · "+j.error:""),
      j.meta_video_id||"—"
    ];
    for(const val of cells)tr.append(el("td",val));
    const action=el("td");
    if(j.status==="queued")action.append(btn("Hủy",()=>{if(confirm("Hủy lịch tập này?"))handle(api("/jobs/cancel",{id:j.id}).then(refreshReports));},"small danger"));
    if(j.meta_video_id)action.append(btn("Đối soát",()=>handle(api("/jobs/reconcile",{id:j.id}).then(refreshReports))));
    tr.append(action);root.append(tr);
  }
  if(!jobs.length){const row=el("tr");const cell=el("td","Chưa có lịch đăng");cell.colSpan=6;row.append(cell);root.append(row);}
}
async function refreshAll(){
  const cfg=await api("/config");
  $("statusPanel").replaceChildren();
  for(const [name,ok] of Object.entries(cfg)){if(typeof ok!=="boolean")continue;$("statusPanel").append(el("span",name+": "+(ok?"đã cấu hình":"chưa cấu hình"),"pill"));}
  await Promise.all([refreshPages(),refreshReports()]);
  if(!series.length)await refreshSeries().catch(e=>show("Chưa thể tải phim từ Drive: "+e.message,true));
  renderDrafts();
}
function todayVietnam(){const p=new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return v.year+"-"+v.month+"-"+v.day;}
export function initReelsStudio(){
  if(initialized)return;
  initialized=true;
  $("startDate").value=todayVietnam();
  $("google").onclick=()=>connect("google");
  $("meta").onclick=()=>connect("meta");
  $("loadSeries").onclick=()=>handle(refreshSeries());
  $("loadEpisodes").onclick=()=>handle(refreshEpisodes());
  $("series").onchange=()=>handle(refreshEpisodes());
  $("selectAll").onclick=()=>{selection.clear();for(const ep of episodes)selection.set(ep.episode,ep);resetPlan();episodeUI();};
  $("clearAll").onclick=()=>{selection.clear();resetPlan();episodeUI();};
  $("selectRange").onclick=()=>{
    const from=Number($("episodeFrom").value),to=Number($("episodeTo").value);
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from)return show("Khoảng tập không hợp lệ",true);
    selection.clear();for(const ep of episodes)if(ep.episode>=from&&ep.episode<=to)selection.set(ep.episode,ep);
    resetPlan();episodeUI();
  };
  $("loadAudit").onclick=()=>handle((async()=>{
    const {events}=await api("/audit");const root=$("audit");root.replaceChildren();
    for(const item of events||[]){const row=el("div",new Date(item.created_at).toLocaleString("vi-VN",{timeZone:zone})+" · "+item.action+" · "+JSON.stringify(item.details||{}),"page");root.append(row);}
    if(!events?.length)root.textContent="Chưa có nhật ký.";
  })());
  $("musePrepare").onclick=()=>handle(prepareBatch(true));
  $("museGenerate").onclick=()=>handle(autoGenerate());
  $("resumeVideoBatch").onclick=()=>handle(restoreVideoBatch());
  $("videoRetry").onclick=()=>handle(retryVideoBatch());
  $("museCopy").onclick=async()=>{
    if(!$("musePrompt").value)await handle(prepareBatch(true));
    if(!$("musePrompt").value)return;
    try{await navigator.clipboard.writeText($("musePrompt").value);show("Đã sao chép lệnh; gửi Muse và dán JSON trả về.");}
    catch{$("musePrompt").select();show("Hãy chọn rồi sao chép lệnh trong ô văn bản.");}
  };
  $("museParse").onclick=()=>handle(manualParse());
  $("museReset").onclick=()=>{if(confirm("Xóa tất cả bản nháp chưa lưu?"))resetPlan();};
  $("create").onclick=()=>handle(createCampaign());
  $("reelsRefresh").onclick=()=>handle(refreshAll());
  function updateProvider(){
    const muse=$("planProvider").value==="muse",automatic=muse&&$("museMode").value==="gateway";
    $("museManualFields").classList.toggle("hidden",!muse);
    $("museGenerate").classList.toggle("hidden",muse&&!automatic);
    $("museGenerate").textContent=muse?"Tạo kế hoạch bằng Muse":$("captionSource").value==="video"?"Phân tích MP4 và tạo caption cho toàn bộ tập":"Tạo caption từ metadata cho toàn bộ tập";
    $("musePrepare").classList.toggle("hidden",!muse||automatic);
    $("museCopy").classList.toggle("hidden",!muse||automatic);
    $("musePrompt").closest("label").classList.toggle("hidden",!muse||automatic);
    $("museReply").closest("label").classList.toggle("hidden",!muse||automatic);
    $("museParse").classList.toggle("hidden",!muse||automatic);
  }
  $("planProvider").onchange=()=>{if($("planProvider").value==="muse")$("captionSource").value="metadata";updateProvider();};
  $("museMode").onchange=updateProvider;
  $("captionSource").onchange=updateProvider;updateProvider();
  for(const id of ["startDate","startTime","perDay","spacing","aiTitle","museInstructions"]){
    $(id).addEventListener("change",()=>{if(draftFingerprint&&draftFingerprint!==signature())resetPlan();});
  }
  $("campaign").addEventListener("input",renderDrafts);
  $("pageSelect").addEventListener("change",renderDrafts);
  if(new URLSearchParams(location.search).get("connected"))show("OAuth hoàn tất. Đang làm mới kết nối.");
  renderDrafts();
}
export async function refreshReelsStudio(){
  if(!initialized)initReelsStudio();
  await refreshAll();
}
