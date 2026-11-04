import {initPublisherAdmin} from "./fanpage-publisher-admin.js";
import {driveConnected,listManagedSeriesOnDrive} from "./drive-transfer.js";

const $=id=>document.getElementById(id);
const KEY="pws_fanpage_campaign_draft_v2";
const state={assignments:[],films:[],preview:null,nextId:1,loading:false};
function el(tag,text="",cls=""){
  const n=document.createElement(tag);
  if(text)n.textContent=text;
  if(cls)n.className=cls;
  return n;
}
function status(text,error=false){
  $("fpStatus").textContent=text;
  $("fpStatus").style.color=error?"#ff9ea4":"#bda7f0";
}
function clearPreview(){
  state.preview=null;
  $("fpExport").disabled=true;
  $("fpCreateCampaign").disabled=true;
  $("fpSummary").textContent="";
  $("fpPreviewList").replaceChildren();
}
function field(parent,label,control,minWidth="120px"){
  const item=el("label");
  item.style.cssText="display:flex;flex-direction:column;gap:5px;flex:1;min-width:"+minWidth;
  item.append(document.createTextNode(label),control);
  parent.append(item);
}
function input(row,key,placeholder,type="text"){
  const e=el("input");
  e.type=type;e.placeholder=placeholder;e.value=row[key]||"";e.style.width="100%";
  if(type==="number"){e.min="1";e.max="5000";}
  e.oninput=()=>{row[key]=e.value;clearPreview();};
  return e;
}
function renderAssignments(){
  const container=$("fpAssignments");container.replaceChildren();
  if(!state.assignments.length){
    container.append(el("p","Chưa có phân công. Nhấn + Thêm Fanpage / bộ phim.","muted"));return;
  }
  for(const [index,row] of state.assignments.entries()){
    const card=el("div","","panel");
    card.style.cssText="background:#141728;padding:13px;border:1px solid #373850;border-radius:12px";
    const head=el("div","","row");
    head.style.cssText="justify-content:space-between;align-items:center;margin-bottom:10px";
    head.append(el("strong","Phân công #"+(index+1)));
    const remove=el("button","Xóa phân công","detail-secondary");remove.type="button";
    remove.onclick=()=>{state.assignments=state.assignments.filter(x=>x.id!==row.id);clearPreview();renderAssignments();};
    head.append(remove);card.append(head);
    const first=el("div","","row");
    first.style.cssText="flex-wrap:wrap;gap:10px;align-items:end";
    const pageInput=input(row,"pageId","Page ID");pageInput.setAttribute("list","fpKnownPages");
    field(first,"Page ID (chọn từ Meta hoặc nhập tạm)",pageInput,"180px");
    const select=el("select");select.style.width="100%";
    select.append(new Option("Chọn phim từ Google Drive",""));
    for(const f of state.films)
      select.append(new Option((f.title||f.id)+" · "+(f.uploadedFiles?.length||0)+" MP4 · "+f.id,String(f.id)));
    select.value=row.seriesId||"";
    select.onchange=()=>{row.seriesId=select.value;row.from="";row.to="";clearPreview();renderAssignments();};
    field(first,"Bộ phim",select,"240px");
    card.append(first);
    const film=state.films.find(f=>String(f.id)===row.seriesId);
    if(film){
      const numbers=(film.uploadedFiles||[]).map(f=>Number(f.episode)).filter(Number.isInteger).sort((a,b)=>a-b);
      card.append(el("p",numbers.length+" MP4 đã lưu"+(numbers.length?" · Tập "+numbers[0]+"–"+numbers.at(-1):"")+". Để trống khoảng tập sẽ chọn tất cả.","muted"));
    }
    const second=el("div","","row");second.style.cssText="flex-wrap:wrap;gap:10px;align-items:end";
    field(second,"Từ tập",input(row,"from","Tất cả","number"),"100px");
    field(second,"Đến tập",input(row,"to","Tất cả","number"),"100px");
    field(second,"Tập/ngày riêng",input(row,"dailyLimit","Mặc định","number"),"125px");
    field(second,"Số ngày riêng",input(row,"days","Mặc định","number"),"125px");
    card.append(second);
    const rights=el("label","","row");rights.style.cssText="margin-top:13px;align-items:center;gap:9px";
    const check=el("input");check.type="checkbox";check.checked=row.rightsApproved===true;
    check.onchange=()=>{row.rightsApproved=check.checked;clearPreview();};
    rights.append(check,el("span","Tôi xác nhận có quyền đăng lại các video đã chọn trên Fanpage này"));
    card.append(rights);container.append(card);
  }
}
function addAssignment(data={}){
  if(state.assignments.length>=50){status("Giới hạn 50 phân công một lần tạo bản nháp.",true);return;}
  state.assignments.push({id:state.nextId++,pageId:"",seriesId:"",from:"",to:"",
    dailyLimit:"",days:"",rightsApproved:false,...data});
  clearPreview();renderAssignments();
}
function collect(){
  if(!state.films.length)throw Error("Hãy nhấn Đọc phim từ Drive trước");
  if(!state.assignments.length)throw Error("Hãy thêm ít nhất một phân công");
  const pages=state.assignments.map((item,index)=>{
    const film=state.films.find(f=>String(f.id)===item.seriesId);
    if(!film)throw Error("Phân công #"+(index+1)+" chưa chọn phim hợp lệ");
    const from=item.from===""?1:Number(item.from),to=item.to===""?5000:Number(item.to);
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>5000)
      throw Error("Khoảng tập của phân công #"+(index+1)+" không hợp lệ");
    const episodes=(film.uploadedFiles||[]).filter(f=>{
      const n=Number(f.episode);
      return n>=from&&n<=to&&Number(f.size)>0;
    }).map(f=>({number:Number(f.episode),driveFileId:String(f.id),rightsApproved:item.rightsApproved===true}));
    if(!episodes.length)throw Error("Phân công #"+(index+1)+" chưa có MP4 trong khoảng tập");
    const out={pageId:item.pageId,seriesId:String(film.id),
      movieTitle:String(film.title||film.id),genres:String(film.genres||""),episodes};
    if(item.days!=="")out.days=Number(item.days);
    if(item.dailyLimit!=="")out.dailyLimit=Number(item.dailyLimit);
    return out;
  });
  return {
    campaignName:$("fpCampaignName").value.trim().slice(0,120),
    aiProvider:$("fpAI").value,captionTone:$("fpTone").value,
    startDate:$("fpStartDate").value,
    days:Number($("fpDays").value),dailyLimit:Number($("fpDailyLimit").value),
    windowStart:$("fpWindowStart").value,windowEnd:$("fpWindowEnd").value,
    staggerMinutes:Number($("fpStagger").value),
    timezone:"Asia/Ho_Chi_Minh",pages
  };
}
async function loadDrive(){
  if(state.loading)return;
  if(!driveConnected()){status("Hãy kết nối Google Drive trước.",true);return;}
  state.loading=true;$("fpLoadDrive").disabled=true;
  $("fpDriveStatus").textContent="Đang đọc thư viện Drive…";
  try{
    state.films=await listManagedSeriesOnDrive(progress=>{
      $("fpDriveStatus").textContent="Đang quét "+progress.current+"/"+progress.total+": "+progress.folderName;
    });
    const files=state.films.reduce((n,f)=>n+(f.uploadedFiles?.length||0),0);
    $("fpDriveStatus").textContent="Đã đọc "+state.films.length+" phim và "+files+" MP4.";
    clearPreview();renderAssignments();
  }catch(err){$("fpDriveStatus").textContent="Lỗi Drive: "+String(err.message||err);}
  finally{state.loading=false;$("fpLoadDrive").disabled=false;}
}
function renderPreview(data){
  $("fpSummary").textContent=data.total+" video · "+data.assignments.length+
    " phân công · "+data.rightsPending+" chưa xác nhận quyền đăng.";
  const container=$("fpPreviewList");container.replaceChildren();
  for(const item of data.items.slice(0,100)){
    const row=el("div","","row");
    row.style.cssText="justify-content:space-between;gap:10px;padding:8px 4px;border-bottom:1px solid #272a40;flex-wrap:wrap";
    row.append(
      el("span",item.localDate+" "+item.localTime),
      el("span",item.pageId+" · "+item.seriesId+" · Tập "+item.episodeNumber),
      el("span",item.rightsApproved?"Bản nháp":"Chờ xác nhận quyền","muted"));
    container.append(row);
  }
  if(data.items.length>100)
    container.append(el("p","Đang hiện 100/"+data.items.length+" mục. Xuất JSON để xem toàn bộ.","muted"));
}
async function preview(){
  $("fpPreview").disabled=true;clearPreview();status("Đang tạo lịch…");
  try{
    const config=collect();
    const res=await fetch("/api/reels/preview",{method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(config)});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(data.error||"HTTP "+res.status);
    state.preview={config,result:data};
    $("fpExport").disabled=false;
    $("fpCreateCampaign").disabled=false;
    renderPreview(data);
    status("Đã tạo "+data.total+" bản nháp. Chưa đăng hoặc lên lịch Facebook.");
  }catch(err){status("Lỗi: "+String(err.message||err),true);}
  finally{$("fpPreview").disabled=false;}
}
const localIds={
  fpCampaignName:"campaignName",fpAI:"aiProvider",fpTone:"captionTone",fpStartDate:"startDate",
  fpDays:"days",fpDailyLimit:"dailyLimit",fpWindowStart:"windowStart",
  fpWindowEnd:"windowEnd",fpStagger:"staggerMinutes"
};
function saveLocal(){
  const config={assignments:state.assignments.map(({id,...data})=>data)};
  for(const [element,key] of Object.entries(localIds))config[key]=$(element).value;
  localStorage.setItem(KEY,JSON.stringify(config));
  status("Đã lưu cấu hình (không chứa token) trên trình duyệt này.");
}
function restoreLocal(){
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw)throw Error("Chưa lưu cấu hình nào");
    const config=JSON.parse(raw);
    if(!Array.isArray(config.assignments)||config.assignments.length>50)throw Error("Danh sách phân công lỗi");
    for(const [element,key] of Object.entries(localIds))
      if(config[key]!=null)$(element).value=String(config[key]);
    state.nextId=1;state.assignments=[];
    for(const row of config.assignments)addAssignment({
      pageId:String(row.pageId||""),seriesId:String(row.seriesId||""),
      from:String(row.from||""),to:String(row.to||""),
      dailyLimit:String(row.dailyLimit||""),days:String(row.days||""),
      rightsApproved:row.rightsApproved===true
    });
    if(!state.assignments.length)addAssignment();
    clearPreview();renderAssignments();
    status("Đã nạp cấu hình. Nhấn Đọc phim từ Drive rồi tạo lịch.");
  }catch(err){status("Không thể nạp: "+String(err.message||err),true);}
}
function exportDraft(){
  if(!state.preview)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(state.preview,null,2)],{type:"application/json"}));
  const anchor=el("a");anchor.href=url;anchor.download="fanpage-campaign-preview.json";
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function initFanpagePublisher(){
  $("fpStartDate").value=new Intl.DateTimeFormat("sv-SE",{
    timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(new Date());
  $("fpLoadDrive").onclick=loadDrive;
  $("fpAddAssignment").onclick=()=>addAssignment();
  $("fpPreview").onclick=preview;
  $("fpExport").onclick=exportDraft;
  $("fpSaveLocal").onclick=saveLocal;
  $("fpRestoreLocal").onclick=restoreLocal;
  for(const element of Object.keys(localIds))$(element).addEventListener("change",clearPreview);
  addAssignment();
  initPublisherAdmin({getDraft:()=>state.preview?.config||null});
}
