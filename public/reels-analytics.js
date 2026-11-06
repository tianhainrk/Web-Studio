// Exact demo DOM/CSS, live Meta data only. Never fabricate a metric or growth rate.
const $=id=>document.getElementById(id);
const fmt=n=>typeof n==="number"&&Number.isFinite(n)?new Intl.NumberFormat("vi-VN").format(Math.round(n)):"—";
const short=n=>typeof n!=="number"?"—":n>=1e6?(n/1e6).toFixed(2).replace(".",",")+"tr":n>=1000?(n/1000).toFixed(1).replace(".",",")+"k":fmt(n);
const state={page:"all",period:30,metric:"views",cursor:0,search:""};
let dashboard=null,connected=[],currentRows=[],hasMore=false,epoch=0;
function el(tag,text="",cls=""){const x=document.createElement(tag);x.textContent=text;if(cls)x.className=cls;return x;}
function line(parent,...children){parent.append(...children);return parent;}
function name(id){return connected.find(p=>p.pageId===id)?.name||id;}
function time(iso){return iso?new Date(iso).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",dateStyle:"short",timeStyle:"short"}):"—";}
function setStatus(s,bad=false){$("apiState").textContent="● "+s;$("apiState").style.color=bad?"#ffadbf":"";}
function note(title,text){const root=$("analyticsNotice");root.replaceChildren();root.append(el("b",title)," — "+text);}
function query(extra={}){return new URLSearchParams({pageId:state.page,period:String(state.period),...extra}).toString();}
async function api(path,data){
 const r=await fetch("/api/reels/analytics"+path,{credentials:"same-origin",cache:"no-store",...(data===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(j.error||"Meta Analytics API HTTP "+r.status);
 return j;
}
function resize(){
 if(parent===window)return;
 parent.postMessage({type:"anpi-reels-analytics-height",height:Math.ceil(document.documentElement.scrollHeight+10)},location.origin);
}
function pageFilter(){
 const root=document.querySelector(".seg");root.replaceChildren();
 for(const p of [{pageId:"all",name:"Tất cả Page"},...connected]){
   const b=el("button",p.name, (state.page===p.pageId?"active":""));
   b.type="button";b.dataset.page=p.pageId;b.setAttribute("aria-pressed",String(state.page===p.pageId));
   b.onclick=()=>{state.page=p.pageId;load();};root.append(b);
 }
}
function metricCard(key,label,value,coverage,i){
 const box=el("div","","metric"+(i===0?" primary-metric":"")),labelEl=el("div",label,"metric-label");
 const number=el("div",short(value),"metric-number"),bottom=el("div","","metric-bottom");
 bottom.append(el("span",value===null?"Chưa có dữ liệu":"Dữ liệu thật từ Meta",value===null?"":"growth")," · "+coverage);
 box.append(labelEl,number,bottom);return box;
}
function metrics(){
 const s=dashboard.summary,root=$("metrics");root.replaceChildren();
 for(const [i,key,label] of [["0","views","Lượt xem Reels"],["1","likes","Lượt thích"],["2","comments","Bình luận"],["3","shares","Chia sẻ"]]){
   const v=s.reelMetrics[key]||{value:null,known:0,total:0};
   root.append(metricCard(key,label,v.value,v.known+"/"+v.total+" Reel",Number(i)));
 }
 root.append(metricCard("followers","Theo dõi mới",s.followsNew,s.followsCoverage+" ngày có dữ liệu",4));
}
function svgNode(tag,attrs={},content=null){
 const x=document.createElementNS("http://www.w3.org/2000/svg",tag);
 for(const [k,v] of Object.entries(attrs))x.setAttribute(k,String(v));
 if(content!==null)x.textContent=content;return x;
}
function chart(result){
 const svg=$("trendSvg"),data=result?.data||[];svg.replaceChildren();
 $("trendTitle").textContent=({views:"Lượt xem",likes:"Lượt thích",shares:"Chia sẻ"})[state.metric]+" theo ngày";
 $("trendSubtitle").textContent=result?.description||"Chưa có dữ liệu";
 $("trendBadge").textContent=state.period+" ngày";
 const valid=data.filter(p=>typeof p.value==="number");
 if(!valid.length){svg.append(svgNode("text",{x:355,y:160,"text-anchor":"middle",fill:"#b8b2d0","font-size":15},"Chưa có dữ liệu thực tế theo ngày"));return;}
 const pad=54,W=640,H=245,top=25,max=Math.max(1,...valid.map(x=>x.value))*1.12;
 for(let i=0;i<5;i++){
   const y=top+i*H/4;
   svg.append(svgNode("line",{class:"svg-grid",x1:pad,x2:pad+W,y1:y,y2:y}));
   svg.append(svgNode("text",{class:"svg-axis",x:pad-8,y:y+4,"text-anchor":"end"},short(max*(1-i/4))));
 }
 let current=[];const segments=[];
 data.forEach((p,i)=>{
   if(typeof p.value!=="number"){if(current.length)segments.push(current);current=[];return;}
   current.push({x:pad+i*W/Math.max(1,data.length-1),y:top+H-p.value/max*H,date:p.date,v:p.value});
 });
 if(current.length)segments.push(current);
 for(const points of segments){
   const p=points.map((x,i)=>(i?"L":"M")+x.x.toFixed(2)+","+x.y.toFixed(2)).join(" ");
   const area=p+" L "+points.at(-1).x+","+(top+H)+" L "+points[0].x+","+(top+H)+" Z";
   svg.append(svgNode("path",{d:area,fill:"#af80f2","fill-opacity":".12"}));
   svg.append(svgNode("path",{d:p,class:"svg-trend"}));
   for(const v of points){const dot=svgNode("circle",{cx:v.x,cy:v.y,r:3.2,class:"svg-dot"});dot.append(svgNode("title",{},v.date+" · "+fmt(v.v)));svg.append(dot);}
 }
 for(const i of [...new Set([0,Math.floor((data.length-1)/4),Math.floor((data.length-1)/2),Math.floor(3*(data.length-1)/4),data.length-1])])
   if(data[i])svg.append(svgNode("text",{class:"svg-axis",x:pad+i*W/Math.max(1,data.length-1),y:298,"text-anchor":"middle"},data[i].date.slice(5).split("-").reverse().join("/")));
}
function heat(){
 const root=$("heatGrid");root.replaceChildren();
 const hours=[7,9,11,13,15,17,19,21],days=["T2","T3","T4","T5","T6","T7","CN"],slots=dashboard.bestTimes||[];
 const max=Math.max(1,...slots.map(x=>x.median24hViews||0));
 root.append(el("div"));
 hours.forEach(h=>root.append(el("div",h+"h","heat-label")));
 days.forEach((day,d)=>{
   root.append(el("div",day,"heat-label"));
   hours.forEach(h=>{
     const slot=slots.find(s=>s.weekday===d&&s.hour===Math.floor(h/2)*2);
     const val=slot?.median24hViews,real=typeof val==="number";
     const label=day+" "+h+"h · "+(real?"Trung vị "+fmt(val)+" lượt xem sau ~24h":"Chưa đủ mẫu");
     const b=el("button","","heat-cell");b.type="button";b.setAttribute("aria-label",label);b.title=label;
     b.style.background=real?"rgba(169,100,249,"+(0.2+0.8*val/max).toFixed(2)+")":"#292c40";
     b.onclick=()=>$("heatInfo").textContent=label+" · "+(slot?.count||0)+" video. Không bảo đảm tăng lượt xem.";
     root.append(b);
   });
 });
 $("heatInfo").textContent=dashboard.recommendations?.message||"Chưa đủ số liệu để đánh giá giờ đăng.";
}
function compare(){
 const ps=dashboard.pages||[],root=$("compareContent"),table=$("pageTable");root.replaceChildren();table.replaceChildren();
 const metric=state.metric,max=Math.max(1,...ps.map(p=>p.metrics?.[metric]?.value||0));
 ps.forEach((p,i)=>{
   const v=p.metrics?.[metric]?.value,row=el("div","","compare-row"),top=el("div","","compare-row-label");
   top.append(el("span",p.name),el("strong",short(v)));
   const bg=el("div","","compare-bg"),bar=el("span");bar.style.width=typeof v==="number"?v/max*100+"%":"0%";
   bg.append(bar);row.append(top,bg);root.append(row);
   const tr=el("tr");tr.append(el("td",p.name));
   for(const k of ["views","likes","comments","shares"])tr.append(el("td",short(p.metrics?.[k]?.value)));
   table.append(tr);
 });
 root.append(el("div","Thống kê tích lũy của Reels phát hành trong khoảng ngày đã chọn.","compare-legend"));
}
function reelButton(id,label="Chi tiết"){const b=el("button",label,"table-action");b.type="button";b.onclick=()=>detail(id);return b;}
function renderReels(items,replace=false){
 if(replace){$("reelRows").replaceChildren();$("mobileRows").replaceChildren();}
 for(const r of items){
   const title=r.episode?"EP"+String(r.episode).padStart(3,"0"):r.filename||"Reel";
   const row=el("tr"),td=el("td"),wrap=el("span","","ep-cell"),top=el("span");
   top.append(el("b",title),el("small",r.filename||"Video Facebook"));
   wrap.append(el("span","▶","reel-icon"),top);td.append(wrap);row.append(td,el("td",name(r.pageId)));
   for(const key of ["views","likes","comments","shares"])row.append(el("td",fmt(r[key]),"numeric"));
   row.append(el("td",r.sampledAt?"Đã đồng bộ":"Chờ đồng bộ","status"));
   const action=el("td");action.append(reelButton(r.id));row.append(action);$("reelRows").append(row);
   const article=el("article","","mobile-reel"),header=el("div","","m-title");
   header.append(el("strong","▶ "+title),el("span",r.sampledAt?"Có số liệu":"Chờ đồng bộ","status"));
   article.append(header,el("p",name(r.pageId),"m-sub"));
   const stats=el("div","","m-stats");
   for(const [key,label] of [["views","Xem"],["likes","Thích"],["comments","Cmt"],["shares","Chia sẻ"]]){
     const cell=el("div");cell.append(el("small",label),el("b",short(r[key])));stats.append(cell);
   }
   article.append(stats,reelButton(r.id,"Xem chi tiết"));$("mobileRows").append(article);
 }
}
async function more(reset=false){
 if(reset){state.cursor=0;currentRows=[];}
 const r=await api("/reels?"+query({limit:"12",cursor:String(state.cursor),search:state.search}));
 currentRows.push(...r.reels);state.cursor+=r.reels.length;renderReels(r.reels,reset);
 $("reelCount").textContent="Hiển thị "+currentRows.length+"/"+r.total+" Reel từ Meta"+(r.partial?" · Dữ liệu chưa đầy đủ":"");
 $("toggleMore").hidden=$("toggleMoreMobile").hidden=!r.hasMore;
 resize();
}
function topReels(){
 const root=$("topReels");root.replaceChildren();
 const list=[...(dashboard.reels||[])].filter(x=>typeof x.views==="number").sort((a,b)=>b.views-a.views).slice(0,5);
 list.forEach((r,i)=>{
   const li=el("li"),rank=el("span",String(i+1),"rank"+(i===0?" first":"")),info=el("span","","top-item");
   info.append(el("b",r.episode?"EP"+String(r.episode).padStart(3,"0"):r.filename||"Reel"),el("small",name(r.pageId)));
   li.append(rank,info,el("strong",short(r.views)));root.append(li);
 });
 if(!list.length)root.append(el("li","Chưa có Reel đủ dữ liệu."));
}
async function detail(id){
 const embedded=parent!==window;
 if(!embedded){$("modal").hidden=false;$("modalTitle").textContent="Đang tải Reel…";$("modalStats").replaceChildren();resize();}
 try{
   const data=await api("/reels/"+id+"?"+query()),r=data.reel;
   if(embedded){parent.postMessage({type:"anpi-reels-analytics-detail",detail:data},location.origin);return;}
   $("modalTitle").textContent=(r.episode?"EP"+String(r.episode).padStart(3,"0"):"Reel")+" · Phân tích";
   $("modalDesc").textContent=data.page+" · Lịch dự kiến "+time(r.publishedAt)+" · Đồng bộ "+time(r.sampledAt)+
     " · "+data.history.length+" snapshot";
   for(const [key,label] of [["views","Lượt xem"],["likes","Lượt thích"],["comments","Bình luận"],["shares","Chia sẻ"]]){
     const div=el("div","","modal-stat");div.append(el("small",label),el("b",fmt(r[key])));
     if(r[key]===null){
     const labels={missing_permission:"Thiếu quyền",unsupported:"Meta không hỗ trợ",no_data:"Chưa có số liệu",error:"Lỗi đồng bộ"};
     div.append(el("small",labels[r.availability?.[key]]||"Không khả dụng"));
   }
     $("modalStats").append(div);
   }
   if(r.permalink&&/^https:\/\/(www\.|m\.)?facebook\.com\//.test(r.permalink)){
     const a=el("a","Mở trên Facebook ↗","table-action");a.href=r.permalink;a.target="_blank";a.rel="noopener noreferrer";$("modalStats").append(a);
   }
 }catch(e){if(embedded)setStatus(e.message,true);else $("modalDesc").textContent=e.message;}
 resize();
}
async function trend(){
 const result=state.metric==="views"?dashboard.trend:await api("/trend?"+query({metric:state.metric}));
 chart(result);
}
async function load(){
 const seq=++epoch;setStatus("Đang tải dữ liệu…");
 try{
   const d=await api("/dashboard?"+query());if(seq!==epoch)return;
   dashboard=d;connected=d.connectedPages||[];
   const buttons=document.querySelector(".seg");buttons.replaceChildren();
   for(const p of [{pageId:"all",name:"Tất cả Page"},...connected]){
     const b=el("button",p.name,state.page===p.pageId?"active":"");b.type="button";b.dataset.page=p.pageId;
     b.onclick=()=>{state.page=p.pageId;load();};buttons.append(b);
   }
   metrics();heat();compare();topReels();await trend();await more(true);
   if(seq!==epoch)return;
   const last=(d.summary.lastSync||[]).map(x=>x.lastSyncedAt).filter(Boolean).sort().at(-1);
   $("lastSync").textContent=d.summary.from+" → "+d.summary.until+" · Đồng bộ cuối: "+time(last);
   const hasError=(d.summary.lastSync||[]).some(x=>x.status==="failed");
   setStatus(hasError?"Một Page đồng bộ lỗi":last?"Đã cập nhật":"Chưa có dữ liệu",hasError);
   const pageStates=(d.summary.lastSync||[]).flatMap(s=>Object.values(s.metricStatus?.page||{}));
   const needsPermission=pageStates.includes("missing_permission");
   const unsupported=pageStates.includes("unsupported");
   note(needsPermission?"THIẾU QUYỀN META":unsupported&&!d.summary.reelCount?"METRIC KHÔNG HỖ TRỢ":
      d.summary.reelCount?"LƯU Ý CÁCH TÍNH":"CHƯA CÓ DỮ LIỆU",
     needsPermission?"Một số Page chưa cấp read_insights. Hãy kết nối lại Meta rồi đồng bộ.":
     unsupported&&!d.summary.reelCount?"Meta không trả được một số metric trên Page này; không hiển thị số 0 giả.":
     d.summary.reelCount?"Reel views là số tích lũy hiện tại của bài đăng trong kỳ, không phải lượt xem phát sinh trong kỳ.":
     "Hãy cấp quyền read_insights và chạy đồng bộ Meta. Không hiển thị số mẫu.");
 }catch(e){
   if(seq!==epoch)return;
   dashboard=null;setStatus("Không thể tải Analytics",true);note("LỖI",e.message);
   ["metrics","reelRows","mobileRows","trendSvg","heatGrid","topReels"].forEach(id=>$(id).replaceChildren());
 }finally{resize();}
}
function info(){
 $("modal").hidden=false;$("modalTitle").textContent="Thông tin báo cáo";
 $("modalDesc").textContent="Lượt xem Page theo ngày khác lượt xem tích lũy của Reels. Chỉ số thiếu quyền hoặc chưa có dữ liệu hiển thị —, không phải số 0.";
 $("modalStats").replaceChildren();resize();
}
$("period").onchange=()=>{state.period=Number($("period").value);load();};
$("metricSelector").onchange=()=>{state.metric=$("metricSelector").value;if(dashboard){compare();trend().catch(e=>setStatus(e.message,true));}};
let searchDelay;
$("search").oninput=()=>{state.search=$("search").value.trim();clearTimeout(searchDelay);searchDelay=setTimeout(()=>more(true).catch(e=>setStatus(e.message,true)),300);};
$("toggleMore").onclick=$("toggleMoreMobile").onclick=()=>more().catch(e=>setStatus(e.message,true));
$("refresh").onclick=async()=>{
 $("refresh").disabled=true;
 try{const r=await api("/sync",{pageId:state.page});note("ĐÃ XẾP HÀNG ĐỢI",r.message);setStatus("Chờ worker đồng bộ");}
 catch(e){note("KHÔNG THỂ ĐỒNG BỘ",e.message);setStatus("Lỗi đồng bộ",true);}
 finally{$("refresh").disabled=false;resize();}
};
$("infoButton").onclick=info;
$("closeModal").onclick=()=>{$("modal").hidden=true;resize();};
$("modal").onclick=e=>{if(e.target===$("modal")){$("modal").hidden=true;resize();}};
document.addEventListener("keydown",e=>{if(e.key==="Escape"){$("modal").hidden=true;resize();}});
window.addEventListener("message",e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==="anpi-analytics-select-page"){
 const id=e.data.pageId;if(id==="all"||connected.some(p=>p.pageId===id)){state.page=id;load();}
}});
if(window.ResizeObserver)new ResizeObserver(resize).observe(document.body);
load();
