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
  if(res.status===401){location.href="/";throw Error("Cần đăng nhập PineDrama Studio");}
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
  for(const item of series){const o=el("option",item.name);o.value=item.id;sel.append(o);}
  show("Đã tải "+series.length+" thư mục phim từ Drive.");
}
function episodeUI(){
  const root=$("episodes");root.replaceChildren();
  for(const ep of episodes){
    const active=selection.has(ep.episode);
    root.append(btn("EP"+String(ep.episode).padStart(3,"0"),()=>{if(active)selection.delete(ep.episode);else selection.set(ep.episode,ep);episodeUI();},"ep"+(active?" selected":"")));
  }
  $("selection").textContent="Đã chọn "+selection.size+" / "+episodes.length+" tập.";
}
async function refreshEpisodes(){
  const folder=$("series").value;if(!folder)return show("Chọn một thư mục phim",true);
  const data=await api("/drive/episodes?folder="+encodeURIComponent(folder));
  episodes=data.episodes||[];selection.clear();episodeUI();
  const current=series.find(x=>x.id===folder);
  if(current)$("aiTitle").value=current.name;
  show("Tìm thấy "+episodes.length+" tập trong thư mục.");
}
async function createCampaign(){
  const data={
    name:$("campaign").value,pageId:$("pageSelect").value,folderId:$("series").value,
    episodes:[...selection.keys()].sort((a,b)=>a-b),
    startDate:$("startDate").value,time:$("startTime").value,
    perDay:Number($("perDay").value),spacingMinutes:Number($("spacing").value),
    caption:$("caption").value
  };
  if(!data.pageId||!data.folderId||!data.episodes.length)return show("Cần chọn Fanpage, phim và ít nhất một tập",true);
  const summary=data.episodes.length+" tập sẽ được đăng theo lịch của bạn. Tạo chiến dịch?";
  if(!confirm(summary))return;
  const result=await api("/campaigns/create",data);
  show("Đã tạo chiến dịch "+result.count+" tập. Worker sẽ xử lý khi đến lịch.");
  await refreshReports();
}
async function genCaption(){
  const ep=[...selection.keys()].sort((a,b)=>a-b)[0]||1;
  const data=await api("/caption",{provider:$("aiProvider").value,title:$("aiTitle").value,episode:ep});
  $("caption").value=data.caption;show("Đã tạo caption, bạn có thể chỉnh sửa trước khi lập lịch.");
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
}
function todayVietnam(){const p=new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return v.year+"-"+v.month+"-"+v.day;}
$("startDate").value=todayVietnam();
$("google").onclick=()=>connect("google");
$("meta").onclick=()=>connect("meta");
$("loadSeries").onclick=()=>handle(refreshSeries());
$("loadEpisodes").onclick=()=>handle(refreshEpisodes());
$("selectAll").onclick=()=>{selection.clear();for(const ep of episodes)selection.set(ep.episode,ep);episodeUI();};
$("clearAll").onclick=()=>{selection.clear();episodeUI();};
$("create").onclick=()=>handle(createCampaign());
$("genCaption").onclick=()=>handle(genCaption());
$("refresh").onclick=()=>handle(refreshAll());
if(new URLSearchParams(location.search).get("connected"))show("OAuth hoàn tất. Đang làm mới kết nối.");
handle(refreshAll());
