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
function getInputs(offset=0){
  return {
    name:$("campaign").value.trim(),pageId:$("pageSelect").value,folderId:$("series").value,
    title:$("aiTitle").value.trim(),
    episodes:[...selection.keys()].sort((a,b)=>a-b),
    startDate:$("startDate").value,time:$("startTime").value,
    perDay:Number($("perDay").value),spacingMinutes:Number($("spacing").value),
    instructions:$("museInstructions").value,offset,limit:8
  };
}
function signature(){
  const x=getInputs();delete x.offset;delete x.limit;delete x.name;delete x.pageId;
  return JSON.stringify(x);
}
function resetPlan(){
  drafts.clear();draftFingerprint="";currentBatch=null;
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
function renderDrafts(){
  const root=$("musePreview"),info=$("museDraftCount"),save=$("create"),summary=$("reviewSummary"),hint=$("reviewHint");
  if(!root||!info||!save)return;
  root.replaceChildren();summary.replaceChildren();
  const nums=[...selection.keys()].sort((a,b)=>a-b),ready=nums.filter(n=>drafts.has(n)).length,missing=nums.length-ready;
  for(const [label,value] of [["Tổng tập",nums.length],["Đã có caption",ready],["Chưa xử lý",missing]]){
    const tile=el("div","","anpi-review-metric");tile.append(el("span",label),el("strong",String(value)));summary.append(tile);
  }
  info.textContent=nums.length?(ready+"/"+nums.length+" tập có bản nháp. "+(missing?"Còn "+missing+" tập chưa xử lý.":"Đã đủ các tập để duyệt.")):"Chọn các tập ở bước 2 để bắt đầu.";
  const fresh=!draftFingerprint||draftFingerprint===signature();
  const hasPage=!!$("pageSelect").value,hasName=$("campaign").value.trim().length>=3;
  save.disabled=!nums.length||!!missing||!fresh||!hasPage||!hasName;
  hint.textContent=missing?"Thiếu "+missing+" tập":!hasPage?"Chọn Fanpage":!hasName?"Đặt tên chiến dịch":!fresh?"Thông tin đã đổi, cần tạo lại bản nháp":"Đã đủ tập, sẵn sàng duyệt";
  for(const number of nums){
    const item=drafts.get(number),wrap=el("article","","anpi-plan-item"+(item?"":" missing"));
    const header=el("div","","anpi-plan-header"),file=selection.get(number);
    header.append(el("strong","Tập "+number,"anpi-ep-number"),el("span",item?"Đã chuẩn bị":"Chưa tạo","pill"));
    wrap.append(header,el("div",file?.name||("EP"+String(number).padStart(3,"0")+".mp4"),"muted"));
    if(item){
      const whenLabel=el("label","Ngày và giờ đăng (VN)","field"),when=el("input");
      when.type="datetime-local";when.value=vLocal(item.scheduledAt);
      when.onchange=()=>{try{item.scheduledAt=toUTC(when.value);show("Đã sửa giờ tập "+number);}catch(e){show(e.message,true);}};
      whenLabel.append(when);
      const captionLabel=el("label","Caption tập "+number,"field"),area=el("textarea"),counter=el("span",item.caption.length+"/2200 ký tự","muted");
      area.maxLength=2200;area.value=item.caption;area.oninput=()=>{item.caption=area.value;counter.textContent=area.value.length+"/2200 ký tự";};
      captionLabel.append(area);wrap.append(whenLabel,captionLabel,counter);
    }else wrap.append(el("p","AI sẽ tạo caption và lịch trong lượt tiếp theo.","muted"));
    root.append(wrap);
  }
}
async function prepareBatch(){
  if(!selection.size||!$("series").value)return show("Bạn cần chọn phim và tập từ Drive trước.",true);
  checkFreshness();
  const offset=pendingOffset();
  if(offset<0){renderDrafts();return show("Tất cả tập đã có bản nháp. Có thể xem trước và lưu chiến dịch.");}
  const data=await api("/muse/prepare",getInputs(offset));
  currentBatch={offset,entries:data.entries};
  $("musePrompt").value=data.prompt;
  $("museProgress").textContent="Đã tạo lệnh cho "+data.entries.length+" tập, bắt đầu từ EP"+data.entries[0].episode+".";
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
async function autoGenerate(){
  if(generating)return;
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
  if(!raw)throw Error("Hãy dán JSON từ Muse trước khi nhập");
  checkFreshness();
  const fence=String.fromCharCode(96).repeat(3);
  let cleaned=raw;
  if(cleaned.startsWith(fence))cleaned=cleaned.replace(new RegExp("^"+fence+"(?:json)?\\s*","i"),"").replace(new RegExp("\\s*"+fence+"$"),"").trim();
  let parsed;
  try{parsed=JSON.parse(cleaned);}catch{throw Error("Muse trả JSON không hợp lệ. Hãy yêu cầu chỉ trả danh sách items dạng JSON.");}
  const rows=Array.isArray(parsed)?parsed:parsed?.items;
  if(!Array.isArray(rows)||rows.length===0)throw Error("JSON cần có items là danh sách tập.");
  const selected=getInputs().episodes;
  const start=selected.indexOf(Number(rows[0].episode));
  if(start<0||start+rows.length>selected.length||rows.some((row,i)=>Number(row.episode)!==selected[start+i]))
    throw Error("JSON có tập không nằm trong lựa chọn hoặc không đúng thứ tự. Có thể nhập toàn bộ hoặc theo từng lô liên tiếp.");
  const data=await api("/muse/parse",{...getInputs(start,rows.length),reply:cleaned});
  currentBatch={offset:start,entries:data.plan};
  mergeDraftPlan(data.plan);
  show("Đã nhập "+rows.length+" tập. Hiện có "+drafts.size+"/"+selected.length+" caption.");
}
async function createCampaign(){
  checkFreshness();
  const input=getInputs();
  const plan=input.episodes.map(n=>drafts.get(n));
  if(!input.pageId||!input.folderId||!input.episodes.length)return show("Cần chọn Fanpage, phim và ít nhất một tập.",true);
  if(plan.some(x=>!x))return show("Muse chưa tạo đủ bản nháp cho toàn bộ tập.",true);
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
  $("musePrepare").onclick=()=>handle(prepareBatch());
  $("museGenerate").onclick=()=>handle(autoGenerate());
  $("museCopy").onclick=async()=>{
    if(!$("musePrompt").value)await handle(prepareBatch());
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
    $("museGenerate").textContent=muse?"Tạo kế hoạch bằng Muse":"Tạo caption và lịch cho tất cả tập bằng Gemini";
    $("musePrepare").classList.toggle("hidden",!muse||automatic);
    $("museCopy").classList.toggle("hidden",!muse||automatic);
    $("musePrompt").closest("label").classList.toggle("hidden",!muse||automatic);
    $("museReply").closest("label").classList.toggle("hidden",!muse||automatic);
    $("museParse").classList.toggle("hidden",!muse||automatic);
  }
  $("planProvider").onchange=updateProvider;
  $("museMode").onchange=updateProvider;updateProvider();
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
