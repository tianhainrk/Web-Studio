const $=id=>document.getElementById(id);
const zone="Asia/Ho_Chi_Minh";
const VN_OFFSET=7*3600000;
let initialized=false,pages=[],series=[],episodes=[],jobs=[],attentionJobs=[],campaigns=[],activePage="",view="overview";
let attentionCheckedAt="",attentionPartial=false;
let analyticsEnabled=false;
let pageDiagnostics=[];
let selectedDay="",weekOffset=0;
const selection=new Map(),drafts=new Map();
let draftFingerprint="",currentBatch=null,generating=false,episodeLoadSequence=0;
let draftPage=0,draftDay="all",draftDaysOpen=false,editingEpisode=null,editingJob=null;
let oldVideoBatch=null;
const pad=n=>String(n).padStart(2,"0");
const epLabel=n=>"EP"+String(n).padStart(3,"0");
function el(tag,text="",className=""){const x=document.createElement(tag);x.textContent=text??"";if(className)x.className=className;return x;}
function button(label,onClick,className="rd-quiet"){const b=el("button",label,className);b.type="button";b.onclick=onClick;return b;}
function show(message,bad=false){$("notice").textContent=message||"";$("notice").className="rd-notice "+(bad?"error":"ok");}
async function api(path,body){
  const res=await fetch("/api/reels"+path,{credentials:"same-origin",...(body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  const data=await res.json().catch(()=>({}));
  if(res.status===401)throw Error("Phiên Anpi Drama hết hạn. Vui lòng đăng nhập website lại.");
  if(!res.ok)throw Error(data.error||"API HTTP "+res.status);
  return data;
}
async function handle(fn){try{return await (typeof fn==="function"?fn():fn);}catch(e){show(e.message||String(e),true);return null;}}
const vnTime=iso=>new Date(iso).toLocaleTimeString("vi-VN",{timeZone:zone,hour:"2-digit",minute:"2-digit",hour12:false});
const vnDate=iso=>new Date(Date.parse(iso)+VN_OFFSET).toISOString().slice(0,10);
const vnDateText=iso=>new Date(iso).toLocaleDateString("vi-VN",{timeZone:zone,day:"2-digit",month:"2-digit"});
const vnLong=iso=>new Date(iso).toLocaleString("vi-VN",{timeZone:zone,day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
const todayVN=()=>vnDate(new Date().toISOString());
function localInput(iso){return new Date(Date.parse(iso)+VN_OFFSET).toISOString().slice(0,16);}
function fromVNInput(value){
  const d=new Date(String(value)+":00+07:00");
  if(!Number.isFinite(d.getTime()))throw Error("Giờ Việt Nam không hợp lệ");
  return d.toISOString();
}
function startTomorrow(){
  const t=Date.parse(todayVN()+"T00:00:00+07:00")+86400000;
  return vnDate(new Date(t).toISOString());
}
function openDialog(id){$(id).showModal();}
function closeDialog(id){$(id).close();}
function setView(next){
  view=next==="campaigns"?"campaigns":next==="analytics"&&analyticsEnabled?"analytics":"overview";
  for(const n of ["overview","campaigns","analytics"]){
    const id=n==="overview"?"rdOverview":n==="campaigns"?"rdCampaignsView":"rdAnalyticsView";
    $(id).classList.toggle("hidden",n!==view);
    const b=document.querySelector('#reels [data-rd-view="'+n+'"]');
    if(b)b.classList.toggle("active",n===view);
  }
  $("reels").classList.toggle("rd-analytics-active",view==="analytics");
  if(view==="analytics"){
    const frame=$("rdAnalyticsFrame");
    if(!frame.getAttribute("src"))frame.setAttribute("src",frame.dataset.src);
  }
  renderDashboard();
}
function selectDay(date,{scroll=true}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  selectedDay=date;
  const from=Date.parse(todayVN()+"T00:00:00+07:00");
  const to=Date.parse(date+"T00:00:00+07:00");
  weekOffset=Math.floor((to-from)/(7*86400000));
  setView("overview");
  if(scroll)$("rdDayDetail").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function shiftWeek(delta){
  weekOffset=Math.max(-53,Math.min(53,weekOffset+delta));
  selectedDay="";
  renderDashboard();
}
function wizard(step){
  const key=["rdStepPick","rdStepAi","rdStepReview"];
  const nav=["rdWizardOne","rdWizardTwo","rdWizardThree"];
  key.forEach((id,i)=>$(id).classList.toggle("hidden",i!==step));
  nav.forEach((id,i)=>$(id).classList.toggle("active",i===step));
  if(step===1)renderBalanceHint();
  if(step===2)renderDrafts();
}
function selectedNums(){return [...selection.keys()].sort((a,b)=>a-b);}
function setActivePage(id){
  activePage=id||"";
  $("rdPage").value=activePage;
  $("pageSelect").value=pages.some(p=>p.page_id===activePage&&p.active)?activePage:"";
  renderDashboard();
}
async function connect(provider){
  const config=await api("/config");
  if(!config[provider])throw Error("Chưa cấu hình OAuth "+provider+" trên Vercel");
  location.href="/api/reels/oauth/"+provider+"/start";
}
function renderDiagnostics(){
  const root=$("rdQueueHealth");if(!root)return;
  root.replaceChildren();
  if(!pageDiagnostics.length){
    root.append(el("div","Chưa có dữ liệu. Nhấn Kiểm tra để tải trạng thái của từng Page.","rd-empty"));return;
  }
  for(const health of pageDiagnostics){
    const card=el("div","","rd-health-card");
    const header=el("div","","rd-health-top");
    header.append(el("strong",health.name));
    const check=button("Kiểm tra quyền Meta",()=>handle(async()=>{
      const result=await api("/pages/check-meta",{pageId:health.pageId});
      show(result.ok?"Meta xác nhận có thể truy cập "+health.name+".":"Page "+health.name+": "+result.error+(result.detail?" ("+result.detail+")":""),!result.ok);
    }));
    header.append(check);card.append(header);
    card.append(el("p",health.reason,"rd-health-note"));
    const stats=el("div","","rd-health-stats");
    for(const [key,value] of [["Chiến dịch",health.campaigns],["Đến hạn",health.due],["Chờ giờ",health.totals.queued-health.due-health.blocked],["Đang xử lý",health.totals.uploading+health.totals.processing],["Đã đăng",health.totals.published],["Lỗi",health.totals.failed]]){
      const stat=el("span",key+": "+Math.max(0,value));stats.append(stat);
    }
    card.append(stats);
    if(health.lastError)card.append(el("p","Lỗi gần nhất: "+health.lastError,"rd-health-error"));
    if(health.staleUploading)card.append(el("p",health.staleUploading+" bài kẹt ở trạng thái upload quá 35 phút; không tự đăng lại nếu chưa biết Meta đã nhận video hay chưa.","rd-health-error"));
    if(health.partial)card.append(el("p","Dữ liệu giới hạn 3.000 bài; thống kê có thể chưa đầy đủ.","rd-health-note"));
    root.append(card);
  }
}
async function refreshDiagnostics(){
  const response=await api("/pages/diagnostics");
  pageDiagnostics=response.pages||[];
  renderDiagnostics();
  renderDashboard();
}
function pagesUI(){
  const original=activePage;
  const rd=$("rdPage"),sel=$("pageSelect"),root=$("pages");
  rd.replaceChildren();sel.replaceChildren();
  const blank=el("option","Chọn Fanpage");blank.value="";rd.append(blank);
  const blank2=el("option","Chọn Fanpage");blank2.value="";sel.append(blank2);
  root.replaceChildren();
  for(const p of pages){
    const option=el("option",p.name+(p.active?"":" · Tạm tắt"));option.value=p.page_id;rd.append(option);
    if(p.active){const o=el("option",p.name);o.value=p.page_id;sel.append(o);}
    const row=el("div","","page"),info=el("div",p.name+" · "+p.page_id);
    const actions=el("div","","rd-actions");
    actions.append(button(p.active?"Tạm tắt":"Kích hoạt",()=>handle(async()=>{
      await api("/pages/active",{pageId:p.page_id,active:!p.active});
      await refreshPages();await refreshReports();await refreshDiagnostics();
    })));
    actions.append(button("Ngắt kết nối",()=>handle(async()=>{
      if(!confirm("Ngắt kết nối Page này? Các lịch chưa hoàn thành phải được hủy trước."))return;
      await api("/pages/delete",{pageId:p.page_id});
      await refreshPages();await refreshReports();
    }),"rd-danger"));
    row.append(info,actions);root.append(row);
  }
  if(!pages.length)root.append(el("div","Chưa có Fanpage. Hãy kết nối Meta trước khi lập chiến dịch.","rd-empty"));
  const chosen=pages.some(p=>p.page_id===original)?original:(pages.find(p=>p.active)||pages[0])?.page_id||"";
  activePage=chosen;rd.value=chosen;
  sel.value=pages.some(p=>p.page_id===chosen&&p.active)?chosen:"";
}
async function refreshPages(){const data=await api("/pages");pages=data.pages||[];pagesUI();renderDashboard();}
async function refreshSeries(){
  const data=await api("/drive/series");series=data.series||[];
  const sel=$("series"),current=sel.value;sel.replaceChildren();
  const first=el("option","Chọn phim");first.value="";sel.append(first);
  for(const s of series){const name=s.title||s.name;const option=el("option",name);option.value=s.id;sel.append(option);}
  if(series.some(s=>s.id===current))sel.value=current;
}
function episodeUI(){
  const root=$("episodes");root.replaceChildren();
  for(const e of episodes){
    const active=selection.has(e.episode);
    root.append(button(epLabel(e.episode),()=>{
      if(active)selection.delete(e.episode);else selection.set(e.episode,e);
      resetPlan();episodeUI();
    },"rd-quiet"+(active?" selected":"")));
  }
  $("selection").textContent="Đã chọn "+selection.size+" / "+episodes.length+" tập";
}
async function refreshEpisodes(){
  const folder=$("series").value,sequence=++episodeLoadSequence;
  selection.clear();episodes=[];resetPlan();episodeUI();
  if(!folder)return;
  $("selection").textContent="Đang tải tập từ Drive...";
  const data=await api("/drive/episodes?folder="+encodeURIComponent(folder));
  if(sequence!==episodeLoadSequence||folder!==$("series").value)return;
  episodes=[...new Map((data.episodes||[]).map(e=>[e.episode,e])).values()].sort((a,b)=>a.episode-b.episode);
  const item=series.find(s=>s.id===folder);
  $("aiTitle").value=item?.title||item?.name||"Phim";
  $("campaign").value=("Reels · "+$("aiTitle").value).slice(0,100);
  $("episodeTo").value=episodes.length?episodes[episodes.length-1].episode:10;
  episodeUI();
}
function balancedCounts(n){
  if(!Number.isInteger(n)||n<1||n>300)return [];
  const days=Math.max(1,Math.floor(n/10)),base=Math.floor(n/days),extra=n%days;
  return Array.from({length:days},(_,i)=>base+(i<extra?1:0));
}
function getInputs(offset=0,limit=8){
  return {
    name:$("campaign").value.trim(),pageId:$("pageSelect").value,pageName:pages.find(p=>p.page_id===$("pageSelect").value)?.name||"",
    folderId:$("series").value,title:$("aiTitle").value.trim(),episodes:selectedNums(),
    startDate:$("startDate").value,time:"07:15",perDay:10,spacingMinutes:60,
    instructions:"Viết caption theo diễn biến có thật, ngắn, tự nhiên, không spoil. Dùng tối đa 3 hashtag.",
    offset,limit,aiSchedule:true,museReadDrive:$("planProvider").value==="muse"&&$("captionSource").value==="connected_drive"
  };
}
function signature(){
  const x=getInputs(0,1);delete x.offset;delete x.limit;delete x.name;
  x.provider=$("planProvider").value;x.source=$("captionSource").value;
  return JSON.stringify(x);
}
function resetPlan(){
  drafts.clear();currentBatch=null;draftFingerprint="";draftPage=0;draftDay="all";
  $("musePrompt").value="";$("museReply").value="";
  $("museProgress").textContent="Chưa nhập kết quả AI.";
  renderDrafts();
}
function checkFreshness(){
  const sig=signature();
  if(draftFingerprint&&draftFingerprint!==sig)resetPlan();
  if(!draftFingerprint)draftFingerprint=sig;
}
function renderBalanceHint(){
  const nums=selectedNums(),counts=balancedCounts(nums.length);
  const node=$("rdAiBalance");
  if(!nums.length){node.textContent="Hãy chọn ít nhất một tập.";return;}
  node.textContent="Dự kiến: "+nums.length+" tập trong "+counts.length+" ngày · "+counts.join(" / ")+" tập/ngày. Giờ đăng do AI đề xuất theo Page; khoảng 07:00–23:00 (VN).";
  const isMuse=$("planProvider").value==="muse";
  $("musePrepare").classList.toggle("hidden",!isMuse);
  $("museGenerate").classList.toggle("hidden",isMuse);
  if(!isMuse&&$("captionSource").value==="connected_drive")$("captionSource").value="metadata";
}
function vnMinute(iso){const d=new Date(Date.parse(iso)+VN_OFFSET);return d.getUTCHours()*60+d.getUTCMinutes();}
function planReview(){
  const nums=selectedNums(),missing=nums.filter(n=>!drafts.has(n));
  const invalid=nums.filter(n=>{
    const x=drafts.get(n);
    return x&&(!String(x.caption||"").trim()||x.caption.length>2200||!Number.isFinite(Date.parse(x.scheduledAt)));
  });
  let ordered=true,validDates=true;
  let previous=-Infinity,dayIndex=0;
  const counts=balancedCounts(nums.length),start=Date.parse($("startDate").value+"T00:00:00+07:00");
  for(let i=0;i<nums.length;i++){
    while(i>=counts.slice(0,dayIndex+1).reduce((a,b)=>a+b,0))dayIndex++;
    const item=drafts.get(nums[i]);if(!item)continue;
    const t=Date.parse(item.scheduledAt);
    if(t-previous<15*60000)ordered=false;previous=t;
    const expected=vnDate(new Date(start+dayIndex*86400000).toISOString());
    if(vnDate(item.scheduledAt)!==expected||vnMinute(item.scheduledAt)<420||vnMinute(item.scheduledAt)>1380||t<=Date.now()+60000)validDates=false;
  }
  return {nums,missing,invalid,ordered,validDates,ready:nums.length>0&&!missing.length&&!invalid.length&&ordered&&validDates&&draftFingerprint===signature()};
}
function renderDrafts(){
  if(!$("musePreview"))return;
  const data=planReview(),root=$("musePreview"),counts=balancedCounts(data.nums.length);
  $("create").disabled=generating||!data.ready;
  $("reviewHint").textContent=data.missing.length?"Thiếu "+data.missing.length+" tập":data.invalid.length?"Caption chưa hợp lệ":
    !data.ordered?"Trùng hoặc sát giờ":!data.validDates?"Lịch chưa đúng ngày/giờ":"Sẵn sàng duyệt";
  $("museDraftCount").textContent=(data.nums.length-data.missing.length)+"/"+data.nums.length+" tập có caption";
  const stats=$("reviewSummary");stats.replaceChildren();
  for(const [value,label] of [[data.nums.length,"Đã chọn"],[data.nums.length-data.missing.length,"Có caption"],[data.missing.length,"Chưa xong"]]){
    const card=el("div","","anpi-review-metric");card.append(el("strong",String(value)),el("small",label));stats.append(card);
  }
  const days=$("rdDraftDays");days.replaceChildren();days.classList.toggle("hidden",!draftDaysOpen);
  if(draftDaysOpen){
    const all=button("Tất cả",()=>{draftDay="all";draftPage=0;renderDrafts();},"rd-quiet"+(draftDay==="all"?" active":""));days.append(all);
    for(const d of [...new Set([...drafts.values()].map(x=>vnDate(x.scheduledAt)))].sort()){
      const daily=button(d.split("-").reverse().slice(0,2).join("/")+" · "+[...drafts.values()].filter(x=>vnDate(x.scheduledAt)===d).length,
        ()=>{draftDay=d;draftPage=0;renderDrafts();},"rd-quiet"+(draftDay===d?" active":""));
      days.append(daily);
    }
  }
  const subset=data.nums.filter(n=>draftDay==="all"||drafts.has(n)&&vnDate(drafts.get(n).scheduledAt)===draftDay);
  const per=12,maxPage=Math.max(0,Math.ceil(subset.length/per)-1);
  draftPage=Math.min(draftPage,maxPage);
  const current=subset.slice(draftPage*per,(draftPage+1)*per);
  const table=el("table"),head=el("thead"),hr=el("tr");
  for(const col of ["Tập","Giờ VN","Caption","Trạng thái",""]){hr.append(el("th",col));}head.append(hr);table.append(head);
  const body=el("tbody");
  for(const n of current){
    const item=drafts.get(n),tr=el("tr");
    tr.append(el("td",epLabel(n)));
    tr.append(el("td",item?vnDateText(item.scheduledAt)+" · "+vnTime(item.scheduledAt):"—"));
    tr.append(el("td",item?.caption||"Chưa có caption","rd-truncate"));
    tr.append(el("td",item?"Đã có":"Chưa tạo"));
    const cell=el("td");
    cell.append(button(item?"Sửa":"Chờ AI",()=>{if(item)editDraft(n);},"rd-quiet"));
    tr.append(cell);body.append(tr);
  }
  table.append(body);root.replaceChildren(table);
  if(!subset.length)root.replaceChildren(el("div","Chưa có bản nháp trong ngày này.","rd-empty"));
  $("rdDraftPagination").textContent=subset.length?"Trang "+(draftPage+1)+"/"+(maxPage+1)+" · "+subset.length+" tập":"0 tập";
  $("rdPrevDraft").disabled=draftPage===0;$("rdNextDraft").disabled=draftPage>=maxPage;
}
function editDraft(n){
  const item=drafts.get(n);if(!item)return;
  editingEpisode=n;$("rdCaptionTitle").textContent=epLabel(n)+" · Chỉnh bản nháp";
  $("rdDraftTime").value=localInput(item.scheduledAt);$("rdDraftCaption").value=item.caption;
  $("rdDraftChar").textContent=item.caption.length+"/2200 ký tự";
  openDialog("rdCaptionDialog");
}
function saveDraft(){
  const item=drafts.get(editingEpisode);if(!item)return;
  const caption=$("rdDraftCaption").value.trim();
  if(!caption||caption.length>2200)throw Error("Caption không hợp lệ");
  item.caption=caption;item.scheduledAt=fromVNInput($("rdDraftTime").value);
  closeDialog("rdCaptionDialog");renderDrafts();
}
async function prepareBatch(all=true){
  if(!selection.size)throw Error("Hãy chọn ít nhất một tập.");
  if(!$("pageSelect").value)throw Error("Hãy chọn Fanpage.");
  checkFreshness();
  const data=await api("/muse/prepare",getInputs(0,all?selection.size:8));
  currentBatch={entries:data.entries};
  $("musePrompt").value=data.prompt;$("museProgress").textContent="Đã tạo một lệnh cho "+data.entries.length+" tập. Gửi vào Muse có Drive đã kết nối và nhập file JSON trả về.";
  wizard(2);
  $("rdMuseImport").classList.remove("hidden");
  $("rdJsonPanel").classList.remove("hidden");
  return data;
}
async function copyMuse(){
  if(!$("musePrompt").value)await prepareBatch(true);
  try{await navigator.clipboard.writeText($("musePrompt").value);show("Đã sao chép lệnh Muse.");}
  catch{$("rdPromptPanel").classList.remove("hidden");$("musePrompt").select();show("Hãy sao chép nội dung được chọn.");}
}
function mergeDraftPlan(plan){
  for(const item of plan)drafts.set(Number(item.episode),{...item});
  renderDrafts();
}
async function manualParse(){
  const raw=$("museReply").value.trim();if(!raw)throw Error("Chưa nhập JSON Muse");
  checkFreshness();
  let parsed;try{parsed=JSON.parse(raw);}catch{throw Error("File JSON không hợp lệ");}
  const items=Array.isArray(parsed)?parsed:parsed?.items;
  if(!Array.isArray(items)||!items.length)throw Error("JSON cần có items chứa các tập đã xử lý");
  const nums=new Set(selectedNums());
  if(items.some(x=>!nums.has(Number(x.episode))))throw Error("JSON có tập không nằm trong các tập đã chọn");
  const result=await api("/muse/parse",{...getInputs(0,selectedNums().length),reply:raw});
  mergeDraftPlan(result.plan);
  $("museProgress").textContent="Đã nhập "+result.plan.length+" tập. "+(result.adjusted?"Đã tự cân bằng "+result.adjusted+" mốc giờ chưa phù hợp. ":"")+
    (parsed.cleanup?.status?"Muse báo dọn workspace: "+parsed.cleanup.status+" (chưa được xác minh).":"");
  $("museReply").value="";
  if(!selectedNums().some(n=>!drafts.has(n)))show("Đã có caption cho toàn bộ "+selectedNums().length+" tập. Hãy kiểm tra lịch và duyệt.");
}
async function autoGenerate(){
  if(generating)return;
  checkFreshness();
  const nums=selectedNums();let offset=nums.findIndex(n=>!drafts.has(n));
  if(offset<0)return show("Đã đủ caption.");
  generating=true;renderDrafts();wizard(2);
  try{
    while(offset>=0){
      $("museProgress").textContent="Gemini metadata: đang tạo "+(drafts.size)+"/"+nums.length+" tập…";
      const result=await api("/ai/generate",{...getInputs(offset,8),provider:"gemini"});
      if(signature()!==draftFingerprint)throw Error("Bạn đã đổi lựa chọn trong lúc tạo caption");
      mergeDraftPlan(result.plan);offset=nums.findIndex(n=>!drafts.has(n));
    }
    show("Gemini đã tạo xong caption từ metadata; kiểm tra trước khi duyệt.");
  }finally{generating=false;renderDrafts();}
}
async function createCampaign(){
  checkFreshness();
  const state=planReview();
  if(!state.ready)throw Error("Chưa thể duyệt: "+$("reviewHint").textContent);
  const input=getInputs(0,selectedNums().length);
  if(!confirm("Lưu "+state.nums.length+" tập lên lịch cho "+input.pageName+"? Chỉ lưu lịch, không đăng ngay."))return;
  const plan=state.nums.map(n=>drafts.get(n));
  const data=await api("/campaigns/create",{...input,plan});
  show("Đã lưu chiến dịch "+data.count+" tập. Lịch sẽ được worker Meta thực hiện theo thời gian.");
  resetPlan();closeDialog("rdComposer");await refreshReports();setView("campaigns");
}
function pageJobs(){return jobs.filter(j=>j.page_id===activePage);}
function entryStatus(status){
  if(status==="published")return "Đã đăng";
  if(status==="queued")return "Chờ đăng";
  if(status==="failed")return "Lỗi";
  if(status==="cancelled")return "Đã hủy";
   if(status==="needs_review")return "Cần đối soát";
  if(status==="uploading"||status==="processing")return "Đang xử lý";
  return status||"—";
}
function jobEntry(j,{global=false}={}){
  const row=el("div","","rd-entry"+(global?" rd-attention-entry":""));
  row.append(el("div",vnDateText(j.scheduled_at)+" · "+vnTime(j.scheduled_at),"rd-entry-date"));
  const main=el("div","","rd-entry-main");
  const page=pages.find(p=>p.page_id===j.page_id);
  const expired=j.status==="queued"&&Date.parse(j.scheduled_at)<Date.now()-5*60000;
  main.append(el("strong",epLabel(j.episode)+" · "+j.filename));
  if(global)main.append(el("small","Fanpage: "+(page?.name||"ID "+j.page_id),"rd-attention-page"));
  const caption=el("small",j.caption||"Chưa có caption");
  if(global)caption.classList.add("rd-attention-caption");
  main.append(caption);
  if(global&&j.error)main.append(el("small","Lỗi: "+j.error,"rd-attention-error"));
  if(global&&j.meta_video_id)main.append(el("small","Meta Video ID: "+j.meta_video_id,"rd-attention-meta"));
  row.append(main);
  row.append(el("span",expired?"Quá giờ":entryStatus(j.status),"rd-entry-status "+(expired?"failed":j.status)));
  row.append(button(global?"Chi tiết / Xử lý":"Chi tiết",()=>editJob(j.id)));
  return row;
}
function renderAttention(){
  const root=$("rdAttentionItems");
  if(!root)return;
  root.replaceChildren();
  $("rdAttentionCount").textContent=String(attentionJobs.length);
  $("rdFailed").textContent=String(attentionJobs.length);
  const updated=attentionCheckedAt?" · cập nhật "+vnLong(attentionCheckedAt):"";
  $("rdAttentionInfo").textContent=attentionJobs.length?
    "Có "+attentionJobs.length+" bài cần theo dõi trên toàn bộ Fanpage"+updated+
      (attentionPartial?" · Danh sách đã chạm giới hạn 200 bài mỗi nhóm.":""):
    "Không có bài lỗi, đang xử lý hoặc quá hạn"+updated+".";
  if(!attentionJobs.length){root.append(el("div","Không có bài cần xử lý. Bài đã được Meta xác nhận đăng thành công không xuất hiện ở đây.","rd-empty"));return;}
  for(const job of attentionJobs)root.append(jobEntry(job,{global:true}));
}
async function refreshAttention(){
  const result=await api("/jobs/attention");
  attentionJobs=result.jobs||[];
  attentionCheckedAt=result.checkedAt||"";
  attentionPartial=!!result.partial;
  renderAttention();
}
function listJobs(root,items,empty){
  root.replaceChildren();
  if(!items.length){root.append(el("div",empty,"rd-empty"));return;}
  for(const item of items)root.append(jobEntry(item));
}
function renderDashboard(){
  const all=pageJobs(),day=todayVN(),now=Date.now();
  const today=all.filter(j=>vnDate(j.scheduled_at)===day);
  $("rdTodayCount").textContent=String(today.length);
  $("rdTodayPublished").textContent=String(today.filter(j=>j.status==="published").length);
  $("rdPending").textContent=String(all.filter(j=>j.status==="queued").length);
  $("rdFailed").textContent=String(attentionJobs.length);
  const page=pages.find(p=>p.page_id===activePage);
  const health=pageDiagnostics.find(x=>x.pageId===activePage);
  $("rdPageState").textContent=!page?"Chọn Fanpage để xem lịch":
    !page.active?"Page đang tạm tắt":
    health?.due?health.due+" bài quá hạn cần xử lý":
    health?.totals.failed?health.totals.failed+" bài lỗi cần kiểm tra":"Đã kết nối";
  const base=Date.parse(day+"T00:00:00+07:00")+weekOffset*7*86400000;
  const week=$("rdWeek");week.replaceChildren();
  const first=vnDate(new Date(base).toISOString()),last=vnDate(new Date(base+6*86400000).toISOString());
  $("rdWeekRange").textContent=first.slice(5).split("-").reverse().join("/")+" – "+last.slice(5).split("-").reverse().join("/");
  for(let d=0;d<7;d++){
    const timestamp=base+d*86400000;
    const target=vnDate(new Date(timestamp).toISOString());
    const total=all.filter(j=>vnDate(j.scheduled_at)===target).length;
    const card=el("button","","rd-day"+(target===day?" today":"")+(target===selectedDay?" selected":""));
    card.type="button";
    card.setAttribute("aria-pressed",String(target===selectedDay));
    card.setAttribute("aria-controls","rdDayDetail");
    card.setAttribute("aria-label",new Date(timestamp).toLocaleDateString("vi-VN",{timeZone:zone,weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"})+" · "+total+" bài đăng");
    card.append(el("span",new Date(timestamp).toLocaleDateString("vi-VN",{timeZone:zone,weekday:"short",day:"2-digit",month:"2-digit"})),el("strong",String(total)),el("span","bài đăng"));
    card.onclick=()=>selectDay(target);
    week.append(card);
  }
  $("rdPrevWeek").disabled=weekOffset<=-53;
  $("rdNextWeek").disabled=weekOffset>=53;
  const hasSelection=!!selectedDay;
  $("rdDayDetail").classList.toggle("hidden",!hasSelection);
  $("rdUpcomingSection").classList.toggle("hidden",hasSelection);
  listJobs($("rdUpcoming"),all.filter(j=>Date.parse(j.scheduled_at)>=now&&j.status!=="cancelled").slice(0,12),"Chưa có bài đăng sắp tới trên Fanpage này.");
  if(hasSelection){
    const timestamp=Date.parse(selectedDay+"T00:00:00+07:00");
    $("rdDayTitle").textContent="Lịch đăng · "+new Date(timestamp).toLocaleDateString("vi-VN",{timeZone:zone,weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"});
    const daily=all.filter(j=>vnDate(j.scheduled_at)===selectedDay).sort((a,b)=>Date.parse(a.scheduled_at)-Date.parse(b.scheduled_at));
    $("rdDaySubtitle").textContent=page?"Fanpage: "+page.name+" · Giờ Việt Nam":"Chọn Fanpage để xem lịch";
    const summary=$("rdCalendarSummary");summary.replaceChildren();
    for(const [label,value] of [["Tổng bài",daily.length],["Đã đăng",daily.filter(j=>j.status==="published").length],["Chờ đăng",daily.filter(j=>j.status==="queued").length],["Lỗi",daily.filter(j=>j.status==="failed").length]])
      summary.append(el("span",label+": "+value));
    listJobs($("rdCalendarItems"),daily,"Không có bài đăng trong ngày được chọn.");
  }
  const list=$("rdCampaignList");list.replaceChildren();
  const matching=campaigns.filter(x=>x.page_id===activePage);
  if(!matching.length)list.append(el("div","Fanpage này chưa có chiến dịch. Nhấn + Chiến dịch để tạo mới.","rd-empty"));
  for(const c of matching){
    const count=all.filter(j=>j.campaign_id===c.id).length;
    const done=all.filter(j=>j.campaign_id===c.id&&j.status==="published").length;
    const row=el("div","","rd-entry"),main=el("div","","rd-entry-main");
    main.append(el("strong",c.name),el("small",vnLong(c.start_at)+" · "+done+"/"+count+" bài đã đăng"));
    row.append(main,el("span",c.status,"rd-entry-status"),button("Xem lịch",()=>{
      const target=all.find(j=>j.campaign_id===c.id)?.scheduled_at||c.start_at;
      selectDay(vnDate(target));
    }));
    list.append(row);
  }
}
async function refreshReports(){
  if(!activePage){jobs=[];campaigns=[];renderDashboard();return;}
  const id=encodeURIComponent(activePage);
  const a=await api("/campaigns?pageId="+id);
  campaigns=a.campaigns||[];
  const result=[];let offset=0;
  for(let i=0;i<15;i++){
    const part=await api("/jobs?pageId="+id+"&limit=1000&offset="+offset);
    result.push(...(part.jobs||[]));
    if(!part.hasMore||!part.jobs?.length)break;
    offset+=part.jobs.length;
  }
  jobs=result;renderDashboard();
}
async function refreshAll(){
  const config=await api("/config");
  analyticsEnabled=!!config.analyticsEnabled;
  const nav=document.querySelector('#reels [data-rd-view="analytics"]');
  nav.classList.toggle("hidden",!analyticsEnabled);
  if(!analyticsEnabled&&view==="analytics")setView("overview");
  $("statusPanel").replaceChildren();
  for(const [key,value] of Object.entries(config))if(typeof value==="boolean")$("statusPanel").append(el("span",key+": "+(value?"✓":"chưa cấu hình"),"rd-summary-chip"));
  await refreshPages();await Promise.all([refreshReports(),refreshAttention(),refreshDiagnostics(),refreshSeries().catch(e=>show("Không thể tải thư mục Drive: "+e.message,true))]);
}
function editJob(id){
  const job=jobs.find(j=>j.id===id)||attentionJobs.find(j=>j.id===id);if(!job)return;
  editingJob=id;$("rdJobTitle").textContent=epLabel(job.episode)+" · Lịch đăng";
  $("rdJobMeta").textContent=job.filename+" · "+(pages.find(p=>p.page_id===job.page_id)?.name||job.page_id)+" · "+vnLong(job.scheduled_at);
  $("rdJobTime").value=localInput(job.scheduled_at);$("rdJobCaption").value=job.caption||"";
  $("rdJobStatus").textContent=entryStatus(job.status)+(job.error?" · "+job.error:"")+(job.meta_video_id?" · Meta Video ID: "+job.meta_video_id:"");
  const editable=job.status==="queued";
  $("rdJobTime").disabled=!editable;$("rdJobCaption").disabled=!editable;
  $("rdJobSave").classList.toggle("hidden",!editable);$("rdJobCancel").classList.toggle("hidden",!editable);
  $("rdJobReconcile").classList.toggle("hidden",!job.meta_video_id);
  const safeRetry=job.status==="failed"&&/^Meta upload HTTP 400:/.test(String(job.error||""));
  $("rdJobRetry").classList.toggle("hidden",!safeRetry);
  $("rdJobHint").textContent=safeRetry?"Lỗi đã xảy ra trước bước phát hành. Có thể thử lại theo kiểm tra an toàn của máy chủ.":
    job.meta_video_id&&job.status!=="published"?"Đã có Meta Video ID. Nhấn Đối soát Meta để kiểm tra trạng thái phát hành; không đăng lại khi chưa xác nhận.":
    job.status==="published"?"Meta đã xác nhận phát hành. Không nên đăng lại để tránh trùng video.":
    job.status==="queued"&&Date.parse(job.scheduled_at)<Date.now()-5*60000?"Bài đã quá giờ nhưng còn trong hàng đợi. Kiểm tra cấu hình worker và trạng thái Fanpage, hoặc sửa giờ đăng; không tạo thêm một bài giống hệt.":
    job.status==="failed"?"Chưa đủ bằng chứng để thử đăng lại tự động. Cần kiểm tra nhật ký và kết quả Meta trước.":
    "Hệ thống tự xử lý theo lịch; cập nhật trang để xem trạng thái mới.";
  openDialog("rdJobDialog");
}
async function saveJob(){
  const caption=$("rdJobCaption").value.trim();
  await api("/jobs/update",{id:editingJob,caption,scheduledAt:fromVNInput($("rdJobTime").value)});
  closeDialog("rdJobDialog");await Promise.all([refreshReports(),refreshAttention()]);show("Đã cập nhật bài đăng.");
}
async function cancelJob(){
  if(!confirm("Hủy lịch bài đăng này?"))return;
  await api("/jobs/cancel",{id:editingJob});closeDialog("rdJobDialog");await Promise.all([refreshReports(),refreshAttention()]);
}
async function retryFailedJob(){
  if(!editingJob)throw Error("Chưa chọn bài đăng cần thử lại");
  if(!confirm("Thử đăng lại bài này sau khi sửa lỗi upload Meta? Hệ thống chỉ cho phép tự thử lại khi lần trước bị từ chối trước bước phát hành."))return;
  const result=await api("/jobs/retry",{id:editingJob});
  closeDialog("rdJobDialog");
  await Promise.all([refreshReports(),refreshAttention()]);
  show(result.note||"Đã đưa bài đăng về hàng đợi.");
}
async function reconcileJob(){
  const result=await api("/jobs/reconcile",{id:editingJob});
  closeDialog("rdJobDialog");await Promise.all([refreshReports(),refreshAttention()]);show("Đã đối soát Meta: "+entryStatus(result.status));
}
async function loadAudit(){
  const res=await api("/audit"),root=$("audit");root.replaceChildren();
  for(const e of (res.events||[]).slice(0,60)){
    root.append(el("div",vnLong(e.created_at)+" · "+e.action+" · "+JSON.stringify(e.details||{}),"rd-entry"));
  }
  if(!res.events?.length)root.append(el("div","Chưa có thao tác."));
}
async function restoreVideoBatch(){
  const folder=$("series").value;if(!folder)throw Error("Chọn thư mục phim ở bước tạo chiến dịch trước");
  const latest=await api("/ai/video/latest?folder="+encodeURIComponent(folder));
  if(!latest.batch?.id)throw Error("Chưa có hàng đợi Gemini cũ");
  oldVideoBatch=latest.batch.id;
  const data=await api("/ai/video/status?batch="+encodeURIComponent(oldVideoBatch));
  show("Hàng đợi Gemini cũ: "+data.items.filter(x=>x.status==="ready").length+"/"+data.batch.total+" hoàn thành. Có thể hủy để không chạy thêm.");
  $("videoCancel").classList.toggle("hidden",data.batch.status==="cancelled");
}
async function cancelVideoBatch(){
  if(!oldVideoBatch)throw Error("Chưa chọn hàng đợi Gemini cũ");
  if(!confirm("Hủy hàng đợi Gemini cũ? Không xóa file trên Drive."))return;
  await api("/ai/video/cancel",{batchId:oldVideoBatch});$("videoCancel").classList.add("hidden");show("Đã hủy hàng đợi Gemini cũ.");
}
function showAnalyticsReelDetail(data){
  const r=data?.reel;if(!r||!r.id)return;
  const title=r.episode?"EP"+String(r.episode).padStart(3,"0"):"Facebook Reel";
  $("rdAnalyticsTitle").textContent=title+" · Phân tích";
  $("rdAnalyticsDesc").textContent=String(data.page||"Fanpage")+
    " · Lịch dự kiến: "+(r.publishedAt?vnLong(r.publishedAt):"—")+
    " · Đồng bộ: "+(r.sampledAt?vnLong(r.sampledAt):"Chưa có dữ liệu")+
    " · "+(data.history?.length||0)+" snapshot";
  const root=$("rdAnalyticsStats");root.replaceChildren();
  for(const [key,label] of [["views","Lượt xem"],["likes","Lượt thích"],["comments","Bình luận"],["shares","Chia sẻ"]]){
    const card=el("div","","rd-analytics-modal-stat");
    card.append(el("small",label),el("b",typeof r[key]==="number"?new Intl.NumberFormat("vi-VN").format(r[key]):"—"));
    if(r[key]===null&&r.availability?.[key])card.append(el("small",String(r.availability[key])));
    root.append(card);
  }
  if(typeof r.permalink==="string"&&/^https:\/\/(www\.|m\.)?facebook\.com\//.test(r.permalink)){
    const link=el("a","Mở trên Facebook ↗");link.href=r.permalink;
    link.target="_blank";link.rel="noopener noreferrer";root.append(link);
  }
  if(!$("rdAnalyticsDialog").open)$("rdAnalyticsDialog").showModal();
}
function initReelsStudio(){
  if(initialized)return;initialized=true;
  $("startDate").value=startTomorrow();
  $("rdPage").onchange=()=>handle(async()=>{activePage=$("rdPage").value;$("pageSelect").value=activePage;selectedDay="";weekOffset=0;await refreshReports();});
  $("reelsRefresh").onclick=()=>handle(refreshAll);
  $("rdAttentionRefresh").onclick=()=>handle(async()=>{await Promise.all([refreshAttention(),refreshReports(),refreshDiagnostics()]);show("Đã cập nhật danh sách cần kiểm tra.");});
  $("rdConnect").onclick=()=>openDialog("rdConnectDialog");
  $("rdAnalyticsClose").onclick=()=>closeDialog("rdAnalyticsDialog");
  $("rdHealth").onclick=()=>{openDialog("rdConnectDialog");handle(refreshDiagnostics);};
  $("rdRefreshHealth").onclick=()=>handle(refreshDiagnostics);
  $("rdNew").onclick=()=>{openDialog("rdComposer");wizard(0);if(!series.length)handle(refreshSeries);};
  $("rdPrevWeek").onclick=()=>shiftWeek(-1);
  $("rdNextWeek").onclick=()=>shiftWeek(1);
  $("rdThisWeek").onclick=()=>selectDay(todayVN());
  $("rdCloseDay").onclick=()=>{selectedDay="";renderDashboard();};
  for(const item of document.querySelectorAll('#reels [data-rd-view]'))item.onclick=()=>setView(item.dataset.rdView);
  window.addEventListener("message",event=>{
    const frame=$("rdAnalyticsFrame");
    if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
    if(event.data?.type==="anpi-reels-analytics-detail"){
      showAnalyticsReelDetail(event.data.detail);return;
    }
    if(event.data?.type!=="anpi-reels-analytics-height")return;
    const h=Number(event.data.height);
    if(Number.isFinite(h)&&h>=300&&h<=20000)frame.style.height=Math.ceil(h)+"px";
  });
  for(const item of document.querySelectorAll('#reels [data-rd-close]'))item.onclick=()=>closeDialog(item.dataset.rdClose);
  $("google").onclick=()=>handle(()=>connect("google"));
  $("meta").onclick=()=>handle(()=>connect("meta"));
  $("loadSeries").onclick=()=>handle(refreshSeries);
  $("series").onchange=()=>handle(refreshEpisodes);
  $("loadEpisodes").onclick=()=>handle(refreshEpisodes);
  $("selectAll").onclick=()=>{selection.clear();for(const ep of episodes)selection.set(ep.episode,ep);resetPlan();episodeUI();};
  $("clearAll").onclick=()=>{selection.clear();resetPlan();episodeUI();};
  $("selectRange").onclick=()=>{
    const from=Number($("episodeFrom").value),to=Number($("episodeTo").value);
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from)return show("Khoảng tập không hợp lệ",true);
    selection.clear();for(const e of episodes)if(e.episode>=from&&e.episode<=to)selection.set(e.episode,e);
    resetPlan();episodeUI();
  };
  $("rdToAi").onclick=()=>{
    if(!selection.size)return show("Cần chọn ít nhất một tập.",true);
    $("pageSelect").value=activePage&&pages.find(p=>p.page_id===activePage)?.active?activePage:"";
    wizard(1);
  };
  $("rdBackPick").onclick=()=>wizard(0);
  $("rdBackAi").onclick=()=>wizard(1);
  $("planProvider").onchange=()=>{if($("planProvider").value==="gemini")$("captionSource").value="metadata";else $("captionSource").value="connected_drive";resetPlan();renderBalanceHint();};
  $("captionSource").onchange=()=>{resetPlan();renderBalanceHint();};
  $("pageSelect").onchange=()=>{resetPlan();renderBalanceHint();};
  $("startDate").onchange=()=>{resetPlan();renderBalanceHint();};
  $("musePrepare").onclick=()=>handle(()=>prepareBatch(true));
  $("museGenerate").onclick=()=>handle(autoGenerate);
  $("museCopy").onclick=()=>handle(copyMuse);
  $("rdShowPrompt").onclick=()=>{$("rdPromptPanel").classList.toggle("hidden");};
  $("museJsonFile").onchange=()=>handle(async()=>{
    const file=$("museJsonFile").files?.[0];if(!file)return;
    if(file.size>250000)throw Error("File JSON quá 250 KB; hãy chia thành từng nhóm");
    $("museReply").value=await file.text();
    $("rdJsonPanel").classList.remove("hidden");
    await manualParse();
  });
  $("museParse").onclick=()=>handle(manualParse);
  $("museReset").onclick=()=>{if(confirm("Xóa bản nháp chưa lưu?"))resetPlan();};
  $("create").onclick=()=>handle(createCampaign);
  $("rdDaysToggle").onclick=()=>{draftDaysOpen=!draftDaysOpen;renderDrafts();};
  $("rdPrevDraft").onclick=()=>{draftPage=Math.max(0,draftPage-1);renderDrafts();};
  $("rdNextDraft").onclick=()=>{draftPage++;renderDrafts();};
  $("rdDraftSave").onclick=()=>handle(saveDraft);
  $("rdDraftCaption").oninput=()=>{$("rdDraftChar").textContent=$("rdDraftCaption").value.length+"/2200 ký tự";};
  $("rdJobSave").onclick=()=>handle(saveJob);
  $("rdJobCancel").onclick=()=>handle(cancelJob);
  $("rdJobReconcile").onclick=()=>handle(reconcileJob);
  $("rdJobRetry").onclick=()=>handle(retryFailedJob);
  $("loadAudit").onclick=()=>handle(loadAudit);
  $("resumeVideoBatch").onclick=()=>handle(restoreVideoBatch);
  $("videoCancel").onclick=()=>handle(cancelVideoBatch);
  $("videoRetry").onclick=()=>show("Worker Gemini cũ hiện đã tắt; Muse là chế độ chính.");
  episodeUI();renderDrafts();setView("overview");
  if(new URLSearchParams(location.search).get("connected"))show("Kết nối OAuth hoàn tất. Đang cập nhật Fanpage và Drive.");
}
export {initReelsStudio};
export async function refreshReelsStudio(){if(!initialized)initReelsStudio();await refreshAll();}
