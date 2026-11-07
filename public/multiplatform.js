let ready=false,accounts=[],series=[],episodes=[],jobs=[],attentionJobs=[],config={};
let aiDrafts=[],aiGenerating=false,editingYouTubeJob=null;
let studioView="overview",studioWeekOffset=0,studioSelectedDay="",campaignSlots=[],museContext=null,museContextSignature="",museSkipped=[];
let wizardStep=1,loadedFolderId="";
const $=id=>document.getElementById(id);
const mk=(tag,content="",cls="")=>{const x=document.createElement(tag);x.textContent=content;if(cls)x.className=cls;return x;};
function notify(msg,isError=false){const n=$("mpNotice");n.textContent=msg;n.classList.toggle("error",isError);}
async function api(path,data){
  const r=await fetch("/api/reels/multi"+path,{credentials:"same-origin",
    ...(data===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)})});
  const x=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(x.error||"API HTTP "+r.status);
  return x;
}
async function drive(path){const r=await fetch("/api/reels/drive"+path,{credentials:"same-origin"});
  const x=await r.json().catch(()=>({}));if(!r.ok)throw Error(x.error||"Drive HTTP "+r.status);return x;}
function renderAccounts(){
  const root=$("mpAccounts");
  const keep=new Set([...root.querySelectorAll("input:checked")].map(x=>x.value));
  const defaultYoutube=accounts.find(x=>x.provider==="youtube"&&x.active)?.id;
  root.replaceChildren();
  if(!accounts.length)root.append(mk("p","Chưa kết nối kênh YouTube hoặc TikTok.","mp-muted"));
  for(const a of accounts){
    const row=mk("label","","mp-account");
    const check=mk("input");check.type="checkbox";check.value=a.id;check.disabled=!a.active;
    check.checked=a.active&&(keep.has(a.id)||(!keep.size&&a.id===defaultYoutube));
    check.onchange=()=>{syncPlatformFields();};
    const name=mk("span",(a.provider==="youtube"?"YouTube Shorts · ":"TikTok · ")+a.display_name+
      (a.active?"":" (đã tắt)"));
    row.append(check,name);root.append(row);
  }
  syncPlatformFields();
}
function checkedAccounts(){
  const ids=new Set([...document.querySelectorAll("#mpAccounts input:checked")].map(x=>x.value));
  return accounts.filter(x=>ids.has(x.id));
}
function syncPlatformFields(){
  const targets=checkedAccounts(),tiktok=targets.some(x=>x.provider==="tiktok");
  $("mpTikFields").classList.toggle("hidden",!tiktok);
  const youtube=targets.some(x=>x.provider==="youtube");
  $("mpYtFields").classList.toggle("hidden",!youtube);
  $("mpTitle").required=youtube;
  if(tiktok&&!config.tiktokMediaReady)notify("TikTok sẽ upload trực tiếp MP4 từ Google Drive. Nếu dùng URL riêng, cần xác minh tên miền TikTok.");
}
function renderSeries(){
  const select=$("mpSeries"),previous=select.value;
  select.replaceChildren(new Option("Chọn phim trên Google Drive",""));
  for(const s of series)select.append(new Option(s.title||s.name,s.id));
  select.value=series.some(s=>s.id===previous)?previous:"";
  updateSeriesChoices();
}
function renderEpisodes(){
  const select=$("mpEpisode");select.replaceChildren(new Option("Chọn tập phim",""));
  for(const e of episodes)select.append(new Option(e.name+(e.size?" · "+(Number(e.size)/1024/1024).toFixed(1)+" MB":""),e.id));
}
function renderJobs(){
  const root=$("mpJobs");root.replaceChildren();
  if(!jobs.length){root.append(mk("p","Chưa có tác vụ đăng YouTube/TikTok.","mp-muted"));return;}
  const byId=new Map(accounts.map(a=>[a.id,a]));
  for(const j of jobs.slice(0,80)){
    const row=mk("article","","mp-job");
    const left=mk("div","","mp-job-main");
    const a=byId.get(j.account_id),provider=j.provider==="youtube"?"YouTube Shorts":"TikTok";
    left.append(mk("strong",provider+" · "+(a?.display_name||"Tài khoản")+" · "+j.filename));
    left.append(mk("small",new Date(j.scheduled_at).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})+
      " · "+j.privacy+" · "+j.status,"mp-muted"));
    if(j.error)left.append(mk("small",j.error,"mp-error"));
    if(j.remote_id){
      const aLink=document.createElement("a");
      if(j.provider==="youtube"&&/^[A-Za-z0-9_-]{8,30}$/.test(j.remote_id)){
        aLink.href="https://www.youtube.com/watch?v="+encodeURIComponent(j.remote_id);
        aLink.target="_blank";aLink.rel="noopener noreferrer";aLink.textContent="Mở video YouTube";
        left.append(aLink);
      }
    }
    row.append(left);
    if(j.provider==="youtube"){
      const detail=mk("button","Chi tiết / Xử lý","mp-secondary");
      detail.onclick=()=>openYoutubeJob(j);row.append(detail);
    }
    if(j.status==="queued"){
      const b=mk("button","Hủy lịch","mp-secondary");b.onclick=async()=>{
        if(!confirm("Hủy tác vụ này khi video chưa upload?"))return;
        try{await api("/jobs/cancel",{id:j.id});notify("Đã hủy tác vụ");await loadJobs();}
        catch(e){notify(e.message,true);}
      };row.append(b);
    }
    root.append(row);
  }
}
async function loadJobs(){
  const [data,attention]=await Promise.all([api("/jobs"),api("/jobs/attention")]);
  jobs=data.jobs||[];attentionJobs=attention.jobs||[];
  renderJobs();renderAttention();renderStudioDashboard();
}
async function loadAll(){
  const c=await api("/config");
  config=c;
  if(!c.enabled){$("mpCreate").disabled=true;$("mpAiGenerate").disabled=true;$("mpYoutubeConnect").disabled=true;
    $("mpTikTokConnect").disabled=true;notify("Bật MULTIPLATFORM_ENABLED=true trên Vercel sau khi áp dụng SQL.",true);return;}
  const [a,j,attention]=await Promise.all([api("/accounts"),api("/jobs"),api("/jobs/attention")]);
  config=c;accounts=a.accounts||[];jobs=j.jobs||[];attentionJobs=attention.jobs||[];
  $("mpConnected").textContent=accounts.length+" kênh đã liên kết";
  $("mpWorkerState").textContent=config.workerEnabled?"Cấu hình worker trên Vercel đã bật":"Cần bật GitHub Actions worker để tự đăng";
  $("mpYoutubeConnect").disabled=!c.youtube;
  $("mpTikTokConnect").disabled=!c.tiktok;
  $("mpCreate").disabled=!c.enabled;
  $("mpAiGenerate").disabled=!c.enabled||!c.gemini;
  $("mpPublicWarning").textContent=c.tiktokPublicApproved?
    "TikTok đã được đánh dấu hoàn tất audit; quyền công khai vẫn phụ thuộc từng tài khoản.":
    "TikTok chưa audit: chỉ cho phép SELF_ONLY (riêng tư).";
  $("mpTikPrivacy").replaceChildren(new Option("Chỉ mình tôi (SELF_ONLY)","SELF_ONLY"));
  if(c.tiktokPublicApproved){
    for(const [name,value] of [["Công khai","PUBLIC_TO_EVERYONE"],["Bạn bè","MUTUAL_FOLLOW_FRIENDS"],
      ["Người theo dõi","FOLLOWER_OF_CREATOR"]])$("mpTikPrivacy").append(new Option(name,value));
  }
  renderAccounts();updateChannelChoices();renderJobs();renderAttention();renderStudioDashboard();
  if(!c.enabled)notify("Chưa bật MULTIPLATFORM_ENABLED=true trên Vercel. Facebook Reels vẫn hoạt động riêng.",true);
}
async function loadSeries(){
  const r=await drive("/series");series=r.series||[];renderSeries();renderStudioDashboard();
}
async function loadEpisodes(){
  const folder=$("mpSeries").value;episodes=[];loadedFolderId="";renderEpisodes();if(!folder)return;
  const data=await drive("/episodes?folder="+encodeURIComponent(folder));
  if($("mpSeries").value!==folder)return;
  episodes=data.episodes||[];loadedFolderId=folder;renderEpisodes();
  aiDrafts=[];campaignSlots=[];museContext=null;museContextSignature="";museSkipped=[];renderAiDrafts();
  const nums=episodes.map(x=>Number(x.episode)).filter(Number.isInteger);
  $("mpAiFrom").value=nums[0]||1;$("mpAiTo").value=nums[Math.min(nums.length-1,9)]||1;
}
async function schedule(e){
  e.preventDefault();
  const targets=checkedAccounts();
  if(!targets.length){notify("Chọn ít nhất một kênh YouTube hoặc TikTok",true);return;}
  const episode=episodes.find(x=>x.id===$("mpEpisode").value);
  const scheduled=$("mpScheduled").value;
  if(!episode||!scheduled){notify("Chọn tập và giờ đăng",true);return;}
  const timestamp=new Date(scheduled+":00+07:00").toISOString();
  const base={folderId:$("mpSeries").value,fileId:episode.id,filename:episode.name,
    title:$("mpTitle").value,caption:$("mpCaption").value,scheduledAt:timestamp,
    rightsConfirmed:$("mpRights").checked,consentToPublish:$("mpConsent").checked};
  const btn=$("mpCreate");btn.disabled=true;
  const outcomes=[];
  try{
    for(const t of targets){
      try{
        await api("/jobs",{...base,provider:t.provider,accountId:t.id,
          privacy:t.provider==="youtube"?$("mpYtPrivacy").value:$("mpTikPrivacy").value,
          sourceUrl:t.provider==="tiktok"?$("mpSourceUrl").value:""});
        outcomes.push("Đã xếp lịch: "+t.display_name);
      }catch(error){outcomes.push("Không thành công: "+t.display_name+" — "+error.message);}
    }
    notify(outcomes.join("\n"),outcomes.some(x=>x.startsWith("Không thành công")));
    await loadJobs();
  }finally{btn.disabled=!config.enabled;}
}

const vnLocal=iso=>new Date(Date.parse(iso)+7*3600000).toISOString().slice(0,16);
const vnTimeInput=raw=>{
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw))throw Error("Giờ Việt Nam không hợp lệ");
  const time=Date.parse(raw+":00+07:00");
  if(!Number.isFinite(time))throw Error("Giờ Việt Nam không hợp lệ");
  return new Date(time).toISOString();
};
function renderAttention(){
  const root=$("mpAttention");if(!root)return;
  root.replaceChildren();$("mpAttentionCount").textContent=String(attentionJobs.length);
  if(!attentionJobs.length){root.append(mk("p","Không có bài YouTube lỗi, đang xử lý hoặc quá giờ.","mp-muted"));return;}
  for(const job of attentionJobs){
    const row=mk("article","","mp-job mp-job-attention"),info=mk("div","","mp-job-main");
    const account=accounts.find(a=>a.id===job.account_id);
    info.append(mk("strong",(account?.display_name||"Kênh YouTube")+" · "+job.filename),
      mk("small",new Date(job.scheduled_at).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})+" · "+job.status,"mp-muted"));
    if(job.title)info.append(mk("small",job.title,"mp-muted"));
    if(job.error)info.append(mk("small",job.error,"mp-error"));
    if(job.remote_id)info.append(mk("small","Video ID: "+job.remote_id,"mp-muted"));
    const b=mk("button","Chi tiết / Xử lý","mp-secondary");b.type="button";b.onclick=()=>openYoutubeJob(job);
    row.append(info,b);root.append(row);
  }
}
function openYoutubeJob(job){
  editingYouTubeJob=job;
  const a=accounts.find(x=>x.id===job.account_id);
  $("mpJobDetailTitle").textContent="YouTube · "+job.filename;
  $("mpJobDetailInfo").textContent="Kênh: "+(a?.display_name||job.account_id)+
    " · "+new Date(job.scheduled_at).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"});
  $("mpJobEditTitle").value=job.title||"";
  $("mpJobEditCaption").value=job.caption||"";
  $("mpJobEditTime").value=vnLocal(job.scheduled_at);
  const queued=job.status==="queued";
  for(const x of ["mpJobEditTitle","mpJobEditCaption","mpJobEditTime"])$(x).disabled=!queued;
  $("mpJobSave").classList.toggle("hidden",!queued);
  $("mpJobReconcile").classList.toggle("hidden",!job.remote_id);
  $("mpJobRetry").classList.toggle("hidden",!(job.status==="failed"&&!job.remote_id));
  $("mpJobDetailStatus").textContent=
    "Trạng thái: "+job.status+(job.error?" · Lỗi: "+job.error:"")+
    (job.remote_id?" · Video ID: "+job.remote_id:"")+
    (job.status==="needs_review"&&!job.remote_id?
      " · Không có ID để đối soát: hãy kiểm tra trực tiếp kênh YouTube, không đăng lại mù.":"");
  $("mpJobDialog").showModal();
}
async function updateYoutubeJob(){
  const job=editingYouTubeJob;if(!job)return;
  await api("/jobs/update",{id:job.id,title:$("mpJobEditTitle").value,
    caption:$("mpJobEditCaption").value,scheduledAt:vnTimeInput($("mpJobEditTime").value)});
  $("mpJobDialog").close();await loadJobs();notify("Đã lưu bài YouTube chưa đăng.");
}
async function reconcileYoutubeJob(){
  const job=editingYouTubeJob;if(!job?.remote_id)throw Error("Chưa có video ID để đối soát YouTube");
  const result=await api("/jobs/reconcile",{id:job.id});
  $("mpJobDialog").close();await loadJobs();notify("YouTube đối soát: "+result.status);
}
async function retryYoutubeJob(){
  const job=editingYouTubeJob;if(!job||job.status!=="failed"||job.remote_id)
    throw Error("Bài này chưa đủ điều kiện thử lại an toàn.");
  if(!confirm("Chỉ thử đăng lại khi thất bại trước khi bắt đầu upload. Hệ thống sẽ xếp lại sau 2 phút. Tiếp tục?"))return;
  const result=await api("/jobs/retry",{id:job.id});
  $("mpJobDialog").close();await loadJobs();notify(result.note||"Đã xếp lại bài YouTube.");
}
function buildAiSlots(){
  if(!$("mpSeries").value||!episodes.length)throw Error("Chọn thư mục phim có EPxxx.mp4 trên Drive");
  const low=Number($("mpAiFrom").value),high=Number($("mpAiTo").value);
  if(!Number.isInteger(low)||!Number.isInteger(high)||low<1||high<low)
    throw Error("Dải tập không hợp lệ");
  const range=episodes.filter(x=>Number(x.episode)>=low&&Number(x.episode)<=high)
    .sort((a,b)=>Number(a.episode)-Number(b.episode));
  if(!range.length||range.length>40)throw Error("Mỗi chiến dịch chọn từ 1 đến 40 tập có thật trên Google Drive");
  if(new Set(range.map(x=>x.episode)).size!==range.length)throw Error("Có tập trùng trong Google Drive");
  const date=$("mpAiStartDate").value,time=$("mpAiStartTime").value;
  if(!/^\d{4}-\d\d-\d\d$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("Ngày và giờ đầu tiên không hợp lệ");
  const perDay=Number($("mpAiPerDay").value),spacing=Number($("mpAiInterval").value);
  if(!Number.isInteger(perDay)||perDay<1||perDay>8||
    !Number.isInteger(spacing)||spacing<15||spacing>600)throw Error("Số bài/ngày hoặc khoảng cách không hợp lệ");
  const first=Date.parse(date+"T"+time+":00+07:00");
  const dayMinute=Number(time.slice(0,2))*60+Number(time.slice(3));
  if(!Number.isFinite(first)||dayMinute<420||dayMinute+(Math.min(perDay,range.length)-1)*spacing>1320)
    throw Error("Chọn lịch trong khung 07:00–22:00 giờ Việt Nam, không vượt sang ngày sau");
  const now=Date.now();
  return range.map((e,i)=>{
    const instant=first+Math.floor(i/perDay)*86400000+(i%perDay)*spacing*60000;
    if(instant<now+60000||instant>now+90*86400000)
      throw Error("Ngày đăng phải từ 1 phút tới 90 ngày trong tương lai");
    return {episode:Number(e.episode),filename:e.name,fileId:e.id,
      scheduledAt:new Date(instant).toISOString()};
  });
}
function validateAiDrafts(){
  if(!aiDrafts.length)return "Chưa có bản nháp đã nhập.";
  if(!campaignSlots.length||aiDrafts.length!==campaignSlots.length)
    return "Cần nhập đủ JSON: "+aiDrafts.length+"/"+campaignSlots.length+" tập.";
  if(aiDrafts.some(x=>!campaignSlots.some(y=>y.episode===x.episode&&y.fileId===x.fileId)))
    return "Bản nháp chứa tập không thuộc chiến dịch.";
  if(museContext&&museContextSignature!==JSON.stringify(buildCurrentMuseContext()))
    return "Bạn đã thay đổi phim, kênh hoặc lịch; cần xuất lệnh Muse mới.";
  const ordered=aiDrafts.slice().sort((a,b)=>a.episode-b.episode);
  let previous=-Infinity;
  for(const d of ordered){
    const t=Date.parse(d.scheduledAt);
    if(!d.title?.trim()||d.title.length>100)return "Tiêu đề tập "+d.episode+" phải dài 1–100 ký tự.";
    if(d.caption.length>2200)return "Mô tả tập "+d.episode+" vượt 2200 ký tự.";
    if(!Number.isFinite(t)||t<=Date.now()+60000||t>Date.now()+90*86400000)
      return "Lịch tập "+d.episode+" phải từ 1 phút tới 90 ngày sau.";
    if(t-previous<15*60000)return "Các tập phải cách nhau ít nhất 15 phút và đăng theo thứ tự.";
    previous=t;
  }
  if(!$("mpSeries").value||aiDrafts.some(x=>x.folderId!==$("mpSeries").value))return "Đã thay thư mục Drive; hãy tạo kế hoạch mới.";
  return "";
}
function updateAiValidation(){
  const result=validateAiDrafts();
  $("mpAiApprove").disabled=!!result||aiGenerating||!config.enabled;
  $("mpAiProgress").textContent=result||"Đã tạo "+aiDrafts.length+" bản nháp. Bạn có thể chỉnh từng tiêu đề, mô tả hoặc giờ đăng trước khi duyệt.";
  if($("mpReviewCount"))$("mpReviewCount").textContent=aiDrafts.length+"/"+campaignSlots.length+" tập";
  if($("mpReviewChannel"))$("mpReviewChannel").textContent=accounts.find(x=>x.id===$("mpWizardChannel").value)?.display_name||"Chưa chọn kênh";
}
function renderAiDrafts(){
  const root=$("mpAiDrafts");if(!root)return;
  root.replaceChildren();
  if(!aiDrafts.length){$("mpAiApprove").disabled=true;return;}
  for(const d of aiDrafts){
    const card=mk("div","","mp-draft");
    const hd=mk("strong","Tập "+String(d.episode).padStart(3,"0")+" · "+d.filename);
    const title=mk("input");title.value=d.title;title.maxLength=100;
    const desc=mk("textarea");desc.value=d.caption;desc.rows=3;desc.maxLength=2200;
    const clock=mk("input");clock.type="datetime-local";clock.value=vnLocal(d.scheduledAt);
    title.oninput=()=>{d.title=title.value;updateAiValidation();};
    desc.oninput=()=>{d.caption=desc.value;updateAiValidation();};
    clock.onchange=()=>{try{d.scheduledAt=vnTimeInput(clock.value);updateAiValidation();}
      catch(err){notify(err.message,true);}};
    const wrapper=(label,control)=>{const x=mk("label",label);x.append(control);return x;};
    card.append(hd,wrapper("Tiêu đề",title),wrapper("Mô tả",desc),wrapper("Giờ đăng VN",clock));
    root.append(card);
  }
  updateAiValidation();
}
async function generateYoutubeCampaign(){
  if(aiGenerating)return;
  if(!config.gemini)throw Error("Vercel chưa cấu hình GEMINI_API_KEY");
  const selected=checkedAccounts().filter(x=>x.provider==="youtube"&&x.active);
  if(!selected.length)throw Error("Tích chọn ít nhất một kênh YouTube đã liên kết");
  const slots=buildAiSlots();
  campaignSlots=slots.map(x=>({...x}));
  const title=series.find(s=>s.id===$("mpSeries").value)?.title||series.find(s=>s.id===$("mpSeries").value)?.name;
  if(!title)throw Error("Chưa có tên phim");
  aiDrafts=[];aiGenerating=true;renderAiDrafts();$("mpAiGenerate").disabled=true;
  const preparedDrafts=[];
  $("mpAiApprove").disabled=true;
  try{
    for(let offset=0;offset<slots.length;offset+=8){
      $("mpAiProgress").textContent="Đang soạn Gemini: "+offset+"/"+slots.length+" tập...";
      const subset=slots.slice(offset,offset+8);
      const answer=await api("/ai/youtube/plan",{seriesTitle:title,instructions:$("mpAiInstructions").value,
        items:subset.map(({episode,filename,scheduledAt})=>({episode,filename,scheduledAt}))});
      if(!Array.isArray(answer.plan)||answer.plan.length!==subset.length)
        throw Error("Gemini trả thiếu tập, đã dừng kế hoạch");
      for(let i=0;i<subset.length;i++){
        const item=answer.plan[i],slot=subset[i];
        if(item.episode!==slot.episode)throw Error("Gemini trả sai thứ tự tập");
        preparedDrafts.push({...slot,...item,folderId:$("mpSeries").value});
      }
    }
    aiDrafts=preparedDrafts;
    museContext=null;museContextSignature="";
  }finally{aiGenerating=false;$("mpAiGenerate").disabled=!config.gemini||!config.enabled;renderAiDrafts();}
}
async function approveYoutubeCampaign(){
  const problem=validateAiDrafts();if(problem)throw Error(problem);
  if(!$("mpAiRights").checked||!$("mpAiConsent").checked)
    throw Error("Cần xác nhận quyền phân phối và chấp thuận bản nháp trước khi xếp lịch");
  const targets=accounts.filter(x=>x.provider==="youtube"&&x.active&&x.id===$("mpWizardChannel").value);
  if(!targets.length)throw Error("Chưa chọn kênh YouTube để đăng");
  if(!confirm("Duyệt và xếp "+aiDrafts.length+" tập cho "+targets.length+
    " kênh YouTube? Tạo lịch trong Supabase; GitHub Actions worker sẽ xử lý khi được bật."))return;
  const button=$("mpAiApprove");button.disabled=true;
  let count=0;const skip=[];
  try{
    for(const channel of targets){
      for(const draft of aiDrafts){
        const exists=jobs.some(j=>j.account_id===channel.id&&j.file_id===draft.fileId&&j.scheduled_at===draft.scheduledAt);
        if(exists){skip.push(channel.display_name+" "+draft.filename);continue;}
        const payload={provider:"youtube",accountId:channel.id,folderId:draft.folderId,
          fileId:draft.fileId,filename:draft.filename,title:draft.title.trim(),
          caption:draft.caption.trim(),scheduledAt:draft.scheduledAt,privacy:$("mpYtPrivacy").value,
          rightsConfirmed:true,consentToPublish:true};
        try{
          await api("/jobs",payload);count++;
          jobs.push({account_id:channel.id,file_id:draft.fileId,scheduled_at:draft.scheduledAt});
        }catch(err){
          throw Error("Đã xếp "+count+" bài trước khi dừng tại "+channel.display_name+" · "+draft.filename+
            ": "+err.message+". Kiểm tra hàng đợi trước khi thử lại để tránh lịch trùng.");
        }
      }
    }
    notify("Đã xếp lịch "+count+" bài YouTube"+(skip.length?" · bỏ qua "+skip.length+" lịch đã có":"")+
      ". Worker GitHub Actions chỉ đăng khi đã bật và có quyền hợp lệ.");
    $("mpCampaignDialog").close();setStudioView("campaigns");
  }finally{await loadJobs().catch(()=>{});updateAiValidation();}
}


const vnDay=iso=>new Date(Date.parse(iso)+7*3600000).toISOString().slice(0,10);
const vnToday=()=>vnDay(new Date().toISOString());
const showTime=iso=>new Date(iso).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});

function buildCurrentMuseContext(){
  const channel=accounts.find(x=>x.id===$("mpWizardChannel").value&&x.provider==="youtube"&&x.active);
  if(!channel)throw Error("Chọn kênh YouTube đã kết nối");
  const movie=series.find(x=>x.id===$("mpSeries").value);
  if(!movie)throw Error("Chọn phim trên Google Drive");
  const slots=buildAiSlots();
  return {accountId:channel.id,folderId:movie.id,seriesTitle:movie.title||movie.name,
    instructions:$("mpAiInstructions").value.trim(),
    items:slots.map(x=>({episode:x.episode,fileId:x.fileId,filename:x.filename,scheduledAt:x.scheduledAt}))};
}
function invalidateMuseDraft(){
  museContext=null;museContextSignature="";campaignSlots=[];aiDrafts=[];museSkipped=[];
  if($("mpMusePrompt"))$("mpMusePrompt").value="";
  if($("mpMuseReply"))$("mpMuseReply").value="";
  if($("mpMuseStatus"))$("mpMuseStatus").textContent="Các lựa chọn đã thay đổi. Hãy xuất lại lệnh Muse.";
  if($("mpAiRights"))$("mpAiRights").checked=false;
  if($("mpAiConsent"))$("mpAiConsent").checked=false;
  renderAiDrafts();
}
function chooseWizardChannel(id){
  for(const check of document.querySelectorAll("#mpAccounts input[type=checkbox]")){
    const account=accounts.find(a=>a.id===check.value);
    if(account?.provider==="youtube")check.checked=check.value===id;
  }
  syncPlatformFields();
  invalidateMuseDraft();
}
async function prepareYoutubeMuse(){
  const context=buildCurrentMuseContext();
  $("mpMusePrepare").disabled=true;
  try{
    const result=await api("/muse/youtube/prepare",context);
    museContext=context;museContextSignature=JSON.stringify(context);
    campaignSlots=buildAiSlots().map(x=>({...x}));
    aiDrafts=[];museSkipped=[];
    $("mpAiRights").checked=false;$("mpAiConsent").checked=false;
    $("mpMusePrompt").value=result.prompt||"";
    $("mpMuseReply").value="";
    $("mpMuseStatus").textContent="Lệnh dành cho "+campaignSlots.length+
      " tập đã tạo. Dán vào Muse có Drive đã kết nối, rồi tải JSON hoặc dán trả lời.";
    renderAiDrafts();
    setWizardStep(2);
  }finally{$("mpMusePrepare").disabled=false;}
}
async function importYoutubeMuse(){
  if(!museContext||!museContextSignature)throw Error("Cần xuất lệnh Muse trước khi nhập JSON");
  if(JSON.stringify(buildCurrentMuseContext())!==museContextSignature)
    throw Error("Thông tin kênh, phim hoặc lịch đã đổi. Hãy xuất lệnh Muse mới.");
  const reply=$("mpMuseReply").value.trim();
  if(!reply)throw Error("Chọn file JSON hoặc dán phản hồi từ Muse");
  const button=$("mpMuseImport");button.disabled=true;
  try{
    const result=await api("/muse/youtube/parse",{...museContext,reply});
    const byEpisode=new Map(aiDrafts.map(x=>[x.episode,x]));
    for(const imported of result.plan||[]){
      const slot=campaignSlots.find(x=>x.episode===imported.episode);
      if(!slot)throw Error("Muse trả tập chưa được chọn");
      byEpisode.set(imported.episode,{...slot,...imported,folderId:museContext.folderId});
    }
    aiDrafts=[...byEpisode.values()].sort((a,b)=>a.episode-b.episode);
    const skipMap=new Map(museSkipped.map(x=>[x.episode,x]));
    for(const skipped of result.skipped||[])skipMap.set(skipped.episode,skipped);
    for(const d of aiDrafts)skipMap.delete(d.episode);
    museSkipped=[...skipMap.values()].sort((a,b)=>a.episode-b.episode);
    renderAiDrafts();
    const missing=campaignSlots.filter(x=>!byEpisode.has(x.episode)).map(x=>x.episode);
    $("mpMuseStatus").textContent="Đã nhập "+aiDrafts.length+"/"+campaignSlots.length+
      " tập. "+(missing.length?"Chưa có: "+missing.map(n=>"EP"+String(n).padStart(3,"0")).join(", ")+". ":"Đã đủ số tập. ")+
      (museSkipped.length?"Muse bỏ qua "+museSkipped.length+" tập cần xử lý lại. ":"")+
      (result.cleanupStatus?"Muse báo dọn workspace: "+result.cleanupStatus+" (chưa xác minh).":"");
    $("mpMuseReply").value="";
    notify("Đã kiểm tra và nhập JSON Muse. "+aiDrafts.length+"/"+campaignSlots.length+" tập.");
    if(!missing.length)setWizardStep(3);
  }finally{button.disabled=false;}
}
async function copyYoutubeMusePrompt(){
  const prompt=$("mpMusePrompt").value;
  if(!prompt)throw Error("Chưa tạo lệnh Muse");
  try{await navigator.clipboard.writeText(prompt);notify("Đã sao chép lệnh Muse.");}
  catch{$("mpMusePrompt").focus();$("mpMusePrompt").select();notify("Chọn Copy để sao chép nội dung đang được bôi đen.");}
}
function downloadYoutubeMusePrompt(){
  const prompt=$("mpMusePrompt").value;if(!prompt)throw Error("Chưa tạo lệnh Muse");
  const blob=new Blob([prompt],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="anpi-youtube-shorts-muse-prompt.txt";document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function readMuseJsonFile(){
  const file=$("mpMuseJsonFile").files?.[0];if(!file)return;
  if(file.size>250000)throw Error("File JSON Muse vượt quá 250 KB; chia kết quả thành nhiều tệp nhỏ");
  $("mpMuseReply").value=await file.text();
  $("mpMuseStatus").textContent="Đã đọc "+file.name+". Nhấn Nhập và kiểm tra JSON để xác thực.";
}

function setupStudioLayout(root){
  const header=root.querySelector(".mp-header");
  header.querySelector("h2").textContent="YouTube Shorts";
  header.querySelector("p").textContent="Quản lý kênh, lịch đăng, bản nháp Muse và chiến dịch tại một nơi.";
  const actions=header.querySelector(".mp-header-actions");
  const add=mk("button","+ Chiến dịch","mp-main-inline");add.id="mpOpenCampaign";add.type="button";
  const connect=mk("button","⚙ Kết nối kênh","mp-secondary");connect.id="mpOpenChannels";connect.type="button";
  actions.append(connect,add);
  const shell=mk("div","","mp-dashboard");
  shell.innerHTML=[
    '<div class="mp-pagebar"><div class="mp-pagepick"><span>KÊNH YOUTUBE ĐANG XEM</span><select id="mpChannelFilter" aria-label="Chọn kênh YouTube"></select></div><span id="mpChannelState" class="mp-hint">Chọn kênh để xem lịch</span></div>',
    '<div class="mp-metrics"><div class="mp-metric"><span>Lịch hôm nay</span><strong id="mpStatToday">0</strong><small>Giờ Việt Nam</small></div>',
    '<div class="mp-metric"><span>Đã đăng</span><strong id="mpStatPublished">0</strong><small>Tất cả bài đã xác nhận</small></div>',
    '<div class="mp-metric"><span>Đang chờ</span><strong id="mpStatQueued">0</strong><small>Công việc chưa xử lý</small></div>',
    '<div class="mp-metric"><span>Cần kiểm tra</span><strong id="mpStatAttention">0</strong><small>Lỗi, đang xử lý, quá hạn</small></div></div>',
    '<nav class="mp-nav" aria-label="Quản lý Shorts"><button type="button" data-mp-view="overview" class="active">Tổng quan</button>',
    '<button type="button" data-mp-view="campaigns">Chiến dịch</button><button type="button" data-mp-view="queue">Hàng đợi</button>',
    '<button type="button" data-mp-view="channels">Kênh đã kết nối</button><button type="button" data-mp-view="manual">Đăng lẻ / TikTok</button></nav>',
    '<section id="mpOverviewView" class="mp-view">',
    '<div class="mp-section-title"><div><h3>Lịch đăng theo ngày</h3><p>Nhấn vào một ngày để xem video theo đúng giờ Việt Nam</p></div>',
    '<div class="mp-week-actions"><button type="button" id="mpPrevWeek" class="mp-secondary" aria-label="Tuần trước">‹</button>',
    '<button type="button" id="mpThisWeek" class="mp-secondary">Hôm nay</button><span id="mpWeekRange"></span>',
    '<button type="button" id="mpNextWeek" class="mp-secondary" aria-label="Tuần sau">›</button></div></div>',
    '<div id="mpWeek" class="mp-week"></div><p class="mp-hint">Dùng ‹ › để xem các tuần khác. Mọi bài đều có thể mở Chi tiết.</p>',
    '<section id="mpDayDetail" class="mp-card hidden"><div class="mp-card-head"><h3 id="mpDayTitle">Lịch đăng</h3>',
    '<button id="mpCloseDay" type="button" class="mp-secondary">Đóng</button></div><div id="mpDayJobs" class="mp-day-list"></div></section>',
    '<div class="mp-section-title"><div><h3>Bài đăng sắp tới</h3><p>Hiển thị kênh đang chọn và tập cần theo dõi</p></div></div>',
    '<div id="mpUpcoming" class="mp-day-list"></div></section>',
    '<section id="mpCampaignsView" class="mp-view hidden"><div class="mp-section-title"><div><h3>Chiến dịch theo phim</h3>',
    '<p>Nhóm các bài đã xếp lịch theo thư mục Drive của kênh đang chọn</p></div>',
    '<button id="mpCampaignNew" class="mp-main-inline" type="button">+ Chiến dịch Muse</button></div>',
    '<div id="mpCampaignList" class="mp-day-list"></div></section>',
    '<section id="mpQueueView" class="mp-view hidden"></section>',
    '<section id="mpChannelsView" class="mp-view hidden"></section>',
    '<section id="mpManualView" class="mp-view hidden"><p class="mp-hint">Đăng một tập YouTube hoặc TikTok. Chiến dịch YouTube hàng loạt sử dụng nút + Chiến dịch ở phía trên.</p></section>',
    '<dialog id="mpCampaignDialog" class="mp-campaign-dialog"><div class="mp-campaign-head"><div><span class="mp-eyebrow">ANPI · CHIẾN DỊCH SHORTS</span>',
    '<h3 id="mpWizardTitle">Tạo chiến dịch mới</h3></div><button id="mpWizardClose" type="button" class="mp-secondary" aria-label="Đóng">×</button></div>',
    '<div class="mp-wizard-steps" aria-label="Tiến trình chiến dịch"><span data-mp-step="1">1. Kênh &amp; phim</span>',
    '<span data-mp-step="2">2. Muse &amp; JSON</span><span data-mp-step="3">3. Duyệt lịch</span></div>',
    '<div id="mpWizardBody" class="mp-campaign-body"></div>',
    '<div class="mp-campaign-footer"><button id="mpWizardBack" class="mp-secondary" type="button">← Quay lại</button>',
    '<span id="mpWizardFooterHint" class="mp-hint">Chưa có bài nào được đăng</span></div></dialog>'
  ].join("");
  header.after(shell);
  const original=root.querySelector(".mp-layout");
  shell.querySelector("#mpOverviewView").append(original.querySelector(".mp-attention"));
  shell.querySelector("#mpQueueView").append(original.querySelector(".mp-queue"));
  shell.querySelector("#mpChannelsView").append(original.querySelector(".mp-account-grid").closest(".mp-card"));
  shell.querySelector("#mpManualView").append(original.querySelector("#mpForm"));
  shell.querySelector("#mpWizardBody").append(original.querySelector("#mpAiCard"));
  original.remove();
  shell.querySelectorAll("[data-mp-view]").forEach(button=>button.onclick=()=>setStudioView(button.dataset.mpView));
  $("mpChannelFilter").onchange=()=>{studioSelectedDay="";studioWeekOffset=0;renderStudioDashboard();};
  $("mpPrevWeek").onclick=()=>{studioWeekOffset=Math.max(-53,studioWeekOffset-1);renderStudioDashboard();};
  $("mpNextWeek").onclick=()=>{studioWeekOffset=Math.min(53,studioWeekOffset+1);renderStudioDashboard();};
  $("mpThisWeek").onclick=()=>{studioWeekOffset=0;studioSelectedDay=vnToday();renderStudioDashboard();};
  $("mpCloseDay").onclick=()=>{studioSelectedDay="";renderStudioDashboard();};
  $("mpOpenChannels").onclick=()=>setStudioView("channels");
  $("mpOpenCampaign").onclick=()=>openStudioWizard().catch(e=>notify(e.message,true));
  $("mpCampaignNew").onclick=()=>openStudioWizard().catch(e=>notify(e.message,true));
  $("mpWizardClose").onclick=()=>$("mpCampaignDialog").close();
  $("mpWizardBack").onclick=()=>setWizardStep(Math.max(1,wizardStep-1));
  setStudioView("overview");
}
function setStudioView(next){
  studioView=next;
  for(const key of ["overview","campaigns","queue","channels","manual"])
    $("mp"+key.charAt(0).toUpperCase()+key.slice(1)+"View").classList.toggle("hidden",key!==next);
  document.querySelectorAll("#multiplatform [data-mp-view]").forEach(x=>x.classList.toggle("active",x.dataset.mpView===next));
  if(next==="overview"||next==="campaigns")renderStudioDashboard();
}
function updateChannelChoices(){
  const ch=$("mpChannelFilter"),wizard=$("mpWizardChannel");if(!ch||!wizard)return;
  const old=ch.value,prevWizard=wizard.value;
  const yt=accounts.filter(a=>a.provider==="youtube"&&a.active);
  for(const select of [ch,wizard]){
    select.replaceChildren(new Option("Chọn kênh YouTube",""));
    for(const a of yt)select.append(new Option(a.display_name,a.id));
  }
  ch.value=yt.some(x=>x.id===old)?old:(yt[0]?.id||"");
  wizard.value=yt.some(x=>x.id===prevWizard)?prevWizard:ch.value;
  $("mpChannelState").textContent=ch.value?"Kênh được kết nối":"Chưa có kênh YouTube. Mở Kênh đã kết nối để thêm.";
}
function updateSeriesChoices(){
  const select=$("mpWizardSeries");if(!select)return;
  const old=select.value||$("mpSeries").value;
  select.replaceChildren(new Option("Chọn phim trên Drive",""));
  for(const item of series)select.append(new Option(item.title||item.name,item.id));
  select.value=series.some(x=>x.id===old)?old:"";
}
function studioJobRow(job){
  const account=accounts.find(x=>x.id===job.account_id);
  const row=mk("article","","mp-studio-entry");
  const time=mk("span",showTime(job.scheduled_at),"mp-entry-time");
  const main=mk("div","","mp-entry-main");
  main.append(mk("strong",(job.filename||"Không rõ tập")+" · "+(account?.display_name||"Kênh YouTube")),
    mk("small",job.title||"Chưa có tiêu đề","mp-muted"));
  if(job.error)main.append(mk("small","Lỗi: "+job.error,"mp-error"));
  const status=mk("span",job.status==="published"?"Đã đăng":job.status==="queued"?"Chờ đăng":
    job.status==="uploaded_private"?"Đã upload riêng tư":job.status==="failed"?"Lỗi":job.status==="needs_review"?"Cần đối soát":
    job.status==="processing"?"Đang xử lý":job.status,"mp-status "+job.status);
  const detail=mk("button","Chi tiết","mp-secondary");detail.type="button";detail.onclick=()=>openYoutubeJob(job);
  row.append(time,main,status,detail);return row;
}
function studioJobList(root,items,empty){
  root.replaceChildren();
  if(!items.length)root.append(mk("div",empty,"mp-empty"));
  for(const j of items)root.append(studioJobRow(j));
}
function renderStudioDashboard(){
  if(!$("mpWeek"))return;
  const selected=$("mpChannelFilter").value;
  const scoped=jobs.filter(j=>j.provider==="youtube"&&(!selected||j.account_id===selected));
  const now=Date.now(),today=vnToday();
  $("mpStatToday").textContent=String(scoped.filter(j=>vnDay(j.scheduled_at)===today).length);
  $("mpStatPublished").textContent=String(scoped.filter(j=>j.status==="published"||j.status==="uploaded_private").length);
  $("mpStatQueued").textContent=String(scoped.filter(j=>j.status==="queued").length);
  $("mpStatAttention").textContent=String(attentionJobs.filter(j=>!selected||j.account_id===selected).length);
  const base=Date.parse(today+"T00:00:00+07:00")+studioWeekOffset*7*86400000;
  const week=$("mpWeek");week.replaceChildren();
  const first=vnDay(new Date(base).toISOString()),last=vnDay(new Date(base+6*86400000).toISOString());
  $("mpWeekRange").textContent=first.slice(5).split("-").reverse().join("/")+" – "+last.slice(5).split("-").reverse().join("/");
  for(let d=0;d<7;d++){
    const timestamp=base+d*86400000,date=vnDay(new Date(timestamp).toISOString());
    const count=scoped.filter(j=>vnDay(j.scheduled_at)===date).length;
    const btn=mk("button","","mp-day"+(date===today?" today":"")+(date===studioSelectedDay?" selected":""));
    btn.type="button";
    btn.setAttribute("aria-label","Ngày "+date+" có "+count+" bài");
    btn.append(mk("span",new Date(timestamp).toLocaleDateString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",
      weekday:"short",day:"2-digit",month:"2-digit"})),mk("strong",String(count)),mk("small","bài đăng"));
    btn.onclick=()=>{studioSelectedDay=date;renderStudioDashboard();};
    week.append(btn);
  }
  $("mpPrevWeek").disabled=studioWeekOffset<=-53;
  $("mpNextWeek").disabled=studioWeekOffset>=53;
  $("mpDayDetail").classList.toggle("hidden",!studioSelectedDay);
  if(studioSelectedDay){
    $("mpDayTitle").textContent="Lịch đăng · "+studioSelectedDay.split("-").reverse().join("/");
    studioJobList($("mpDayJobs"),scoped.filter(j=>vnDay(j.scheduled_at)===studioSelectedDay)
      .sort((a,b)=>Date.parse(a.scheduled_at)-Date.parse(b.scheduled_at)),"Không có video trong ngày này.");
  }
  studioJobList($("mpUpcoming"),scoped.filter(j=>j.status==="queued"&&Date.parse(j.scheduled_at)>=now)
    .sort((a,b)=>Date.parse(a.scheduled_at)-Date.parse(b.scheduled_at)).slice(0,12),"Không có video chờ đăng sắp tới.");
  const groups=new Map();
  for(const job of scoped){
    const key=job.account_id+":"+job.folder_id;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(job);
  }
  const list=$("mpCampaignList");list.replaceChildren();
  if(!groups.size)list.append(mk("div","Chưa có lịch đăng YouTube cho kênh này. Nhấn + Chiến dịch Muse để tạo mới.","mp-empty"));
  for(const group of [...groups.values()].sort((a,b)=>Date.parse(b[0].scheduled_at)-Date.parse(a[0].scheduled_at))){
    const firstJob=group[0],movie=series.find(x=>x.id===firstJob.folder_id);
    const row=mk("article","","mp-studio-entry");
    const main=mk("div","","mp-entry-main");
    main.append(mk("strong",movie?.title||movie?.name||"Thư mục Drive: "+firstJob.folder_id),
      mk("small",group.filter(x=>x.status==="published"||x.status==="uploaded_private").length+
        "/"+group.length+" bài đã hoàn tất · "+accounts.find(x=>x.id===firstJob.account_id)?.display_name,"mp-muted"));
    const button=mk("button","Xem lịch","mp-secondary");
    button.type="button";button.onclick=()=>{studioSelectedDay=vnDay(firstJob.scheduled_at);studioWeekOffset=
      Math.floor((Date.parse(studioSelectedDay+"T00:00:00+07:00")-Date.parse(today+"T00:00:00+07:00"))/(7*86400000));
      setStudioView("overview");};
    row.append(main,button);list.append(row);
  }
}
function setWizardStep(step){
  wizardStep=step;
  for(const index of [1,2,3])$("mpWizardStep"+index).classList.toggle("hidden",index!==step);
  document.querySelectorAll("#mpCampaignDialog [data-mp-step]").forEach(x=>x.classList.toggle("active",Number(x.dataset.mpStep)===step));
  $("mpWizardTitle").textContent=["","Chọn kênh và tập phim","Xuất lệnh Muse, nhập JSON","Duyệt lịch đăng YouTube"][step];
  $("mpWizardBack").classList.toggle("hidden",step===1);
  $("mpWizardFooterHint").textContent=step===1?"Chưa tạo bài đăng":step===2?"Muse chỉ tạo bản nháp, không đăng video":
    "Bản nháp chỉ thành lịch sau khi bạn chấp thuận";
}
async function openStudioWizard(){
  updateChannelChoices();updateSeriesChoices();
  const selected=$("mpChannelFilter").value;
  if(selected)$("mpWizardChannel").value=selected;
  const current=$("mpWizardSeries").value;
  if(!current&&series.length){$("mpWizardSeries").value=series[0].id;$("mpSeries").value=series[0].id;}
  if($("mpWizardSeries").value&&$("mpSeries").value!==$("mpWizardSeries").value)
    $("mpSeries").value=$("mpWizardSeries").value;
  if($("mpWizardSeries").value&&(!episodes.length||loadedFolderId!==$("mpWizardSeries").value)){
    $("mpSeries").value=$("mpWizardSeries").value;await loadEpisodes();
  }
  setWizardStep(1);
  $("mpCampaignDialog").showModal();
}

export async function initMultiplatform(){
  if(ready){await refreshMultiplatform();return;}
  ready=true;
  const root=$("mpRoot");if(!root)return;
  root.innerHTML=`
    <div class="mp-header"><div><div class="mp-eyebrow">ANPI PUBLISHING</div>
      <h2>YouTube Shorts & TikTok</h2><p>Chọn video trên Google Drive, kết nối kênh và lập lịch đăng riêng biệt.</p></div>
      <div class="mp-header-actions"><span id="mpConnected"></span><button id="mpReload" class="mp-secondary">↻ Làm mới</button></div></div>
    <div class="mp-notice" id="mpNotice" role="status"></div>
    <div class="mp-layout">
      <div class="mp-column">
        <section class="mp-card"><div class="mp-card-head"><h3>1. Kênh xuất bản</h3><span id="mpWorkerState" class="mp-tag"></span></div>
          <div class="mp-actions"><button id="mpYoutubeConnect" class="mp-secondary">Kết nối YouTube</button>
            <button id="mpTikTokConnect" class="mp-secondary">Kết nối TikTok</button></div>
          <div id="mpAccounts" class="mp-account-grid"></div></section>
        <form id="mpForm" class="mp-card">
          <h3>2. Chọn phim và tập</h3>
          <div class="mp-two"><label>Thư mục phim<select required id="mpSeries"></select></label>
            <label>Tập video<select required id="mpEpisode"></select></label></div>
          <h3>3. Nội dung và lịch đăng</h3>
          <label>Tiêu đề YouTube (tối đa 100 ký tự)<input id="mpTitle" maxlength="100" placeholder="Tên phim · Tập 01 #Shorts" required></label>
          <label>Caption / mô tả<textarea id="mpCaption" rows="4" maxlength="2200" placeholder="Nội dung video và hashtag phù hợp"></textarea></label>
          <label>Giờ đăng (giờ Việt Nam GMT+7)<input id="mpScheduled" type="datetime-local" required></label>
          <div id="mpYtFields"><label>Hiển thị YouTube<select id="mpYtPrivacy">
            <option value="private">Riêng tư</option><option value="unlisted">Không công khai</option>
            <option value="public" selected>Công khai</option></select></label></div>
          <div id="mpTikFields" class="hidden">
            <label>Quyền riêng tư TikTok<select id="mpTikPrivacy"></select></label>
            <p id="mpPublicWarning" class="mp-hint"></p>
            <label>URL MP4 đã xác minh (không bắt buộc)<input id="mpSourceUrl" type="url" placeholder="Để trống để upload trực tiếp từ Google Drive"></label>
            <p class="mp-hint">Để trống để worker truyền video từ Google Drive sang TikTok bằng FILE_UPLOAD. Nếu nhập URL, tên miền HTTPS phải được TikTok xác minh.</p>
          </div>
          <label class="mp-check"><input type="checkbox" id="mpRights" required> Tôi sở hữu hoặc có quyền phân phối video và âm thanh trên các kênh đã chọn.</label>
          <label class="mp-check"><input type="checkbox" id="mpConsent" required> Tôi đồng ý đưa nội dung vào hàng đợi xuất bản của những tài khoản đã chọn.</label>
          <button class="mp-main-btn" id="mpCreate" type="submit">+ Xếp lịch các kênh đã chọn</button>
        </form>

        <section class="mp-card mp-ai-card" id="mpAiCard" aria-labelledby="mpAiTitle">
          <p id="mpWizardHint" class="mp-hint">Tất cả lịch chỉ được tạo sau khi bạn kiểm tra nội dung và nhấn duyệt.</p>
          <section id="mpWizardStep1" class="mp-step">
            <h3>1. Chọn kênh, phim và lịch cơ sở</h3>
            <div class="mp-two">
              <label>Kênh YouTube<select id="mpWizardChannel" aria-label="Kênh YouTube lập chiến dịch"></select></label>
              <label>Phim từ Google Drive<select id="mpWizardSeries" aria-label="Phim trên Google Drive"></select></label>
            </div>
            <div class="mp-two"><label>Tập bắt đầu<input id="mpAiFrom" type="number" min="1" max="5000" value="1"></label>
              <label>Tập kết thúc<input id="mpAiTo" type="number" min="1" max="5000" value="10"></label></div>
            <div class="mp-two"><label>Ngày bắt đầu (giờ Việt Nam)<input id="mpAiStartDate" type="date"></label>
              <label>Giờ bài đầu (giờ Việt Nam)<input id="mpAiStartTime" type="time" value="09:00"></label></div>
            <div class="mp-two"><label>Số bài mỗi ngày<select id="mpAiPerDay"><option value="2">2 bài</option><option value="3" selected>3 bài</option><option value="5">5 bài</option><option value="8">8 bài</option></select></label>
              <label>Khoảng cách giữa các bài (phút)<input id="mpAiInterval" type="number" min="15" max="600" value="120"></label></div>
            <label>Yêu cầu văn phong cho Muse<textarea id="mpAiInstructions" rows="3" maxlength="800" placeholder="Gợi tò mò, xem video thật, không spoil, 1–3 hashtag"></textarea></label>
            <div class="mp-actions"><button id="mpMusePrepare" type="button" class="mp-main-btn">Tiếp tục · Xuất lệnh Muse</button></div>
          </section>
          <section id="mpWizardStep2" class="mp-step hidden">
            <h3>2. Xuất lệnh Muse &amp; nhập JSON</h3>
            <p class="mp-hint">Dán lệnh vào Muse đã kết nối Google Drive. Muse xử lý từng tập, xuất JSON (có thể chia thành nhiều tệp). Không cần chia sẻ video công khai.</p>
            <div class="mp-actions"><button id="mpMuseCopy" type="button" class="mp-secondary">Sao chép lệnh Muse</button>
              <button id="mpMuseDownload" type="button" class="mp-secondary">Tải lệnh .txt</button></div>
            <label>Lệnh Muse đã tạo<textarea id="mpMusePrompt" readonly rows="10" spellcheck="false"></textarea></label>
            <div class="mp-muse-import">
              <label class="mp-upload-label">Chọn file JSON Muse trả về<input id="mpMuseJsonFile" type="file" accept=".json,application/json,text/plain"></label>
              <label>Hoặc dán JSON vào đây<textarea id="mpMuseReply" rows="7" spellcheck="false" placeholder='{"items":[{"episode":1,"title":"...","description":"...","scheduledAt":"2026-11-10T02:00:00Z"}]}'></textarea></label>
              <button type="button" id="mpMuseImport" class="mp-main-btn">Nhập và kiểm tra JSON</button>
            </div>
            <p id="mpMuseStatus" class="mp-hint" aria-live="polite">Chưa nhập kết quả Muse.</p>
            <div class="mp-actions"><button id="mpWizardReview" type="button" class="mp-secondary">Xem và chỉnh bản nháp</button>
              <button id="mpAiGenerate" type="button" class="mp-secondary">Hoặc dùng Gemini (metadata)</button></div>
            <p id="mpAiProgress" class="mp-hint" aria-live="polite">Gemini chỉ sử dụng metadata, không xem trực tiếp MP4.</p>
          </section>
          <section id="mpWizardStep3" class="mp-step hidden">
            <h3>3. Xem, chỉnh sửa và duyệt lịch đăng</h3>
            <p class="mp-hint">Chỉnh tiêu đề, mô tả và thời gian cho từng tập. Bài chưa có JSON hợp lệ sẽ không được duyệt.</p>
            <div class="mp-review-metrics"><span id="mpReviewCount">0/0 tập</span><span id="mpReviewChannel">Chưa chọn kênh</span></div>
            <div id="mpAiDrafts" class="mp-ai-preview"></div>
            <label class="mp-check"><input type="checkbox" id="mpAiRights"> Tôi xác nhận có quyền phân phối tất cả video, âm thanh và nội dung của chiến dịch.</label>
            <label class="mp-check"><input type="checkbox" id="mpAiConsent"> Tôi đã kiểm tra và chấp thuận từng tiêu đề, mô tả, giờ đăng và kênh YouTube.</label>
            <button id="mpAiApprove" class="mp-main-btn" type="button" disabled>Duyệt và xếp lịch YouTube</button>
          </section>
        </section>
      </div>
      <div class="mp-column">
        <section class="mp-card mp-attention"><div class="mp-card-head"><h3>YouTube cần kiểm tra · <span id="mpAttentionCount">0</span></h3><button id="mpAttentionRefresh" type="button" class="mp-secondary">↻ Đối chiếu</button></div>
          <p class="mp-hint">Bài lỗi, đang xử lý, cần đối soát và bài quá giờ của mọi kênh YouTube.</p><div id="mpAttention"></div></section>
        <section class="mp-card mp-queue"><div class="mp-card-head"><h3>Hàng đợi đa nền tảng</h3><span class="mp-tag">Không tác động Facebook</span></div><div id="mpJobs"></div></section>
      </div>
    </div>
    <dialog id="mpJobDialog" class="mp-dialog"><form method="dialog"><div class="mp-dialog-head">
      <h3 id="mpJobDetailTitle">Chi tiết YouTube</h3>
      <button type="button" id="mpJobClose" class="mp-secondary">Đóng</button></div>
      <p id="mpJobDetailInfo" class="mp-hint"></p>
      <label>Tiêu đề<input id="mpJobEditTitle" maxlength="100"></label>
      <label>Mô tả<textarea id="mpJobEditCaption" maxlength="2200" rows="5"></textarea></label>
      <label>Giờ đăng (Việt Nam)<input type="datetime-local" id="mpJobEditTime"></label>
      <p class="mp-hint" id="mpJobDetailStatus"></p>
      <div class="mp-actions"><button type="button" id="mpJobSave" class="mp-secondary">Lưu bài chưa đăng</button>
        <button type="button" id="mpJobReconcile" class="mp-secondary">Đối soát YouTube</button>
        <button type="button" id="mpJobRetry" class="mp-secondary">Thử đăng lại an toàn</button></div>
    </form></dialog>`;
  setupStudioLayout(root);
  $("mpYoutubeConnect").onclick=()=>location.href="/api/reels/multi/oauth/youtube/start";
  $("mpTikTokConnect").onclick=()=>location.href="/api/reels/multi/oauth/tiktok/start";
  $("mpReload").onclick=()=>refreshMultiplatform();
  $("mpWizardChannel").onchange=()=>{
    const selected=$("mpWizardChannel").value;
    if(selected)chooseWizardChannel(selected);else invalidateMuseDraft();
  };
  $("mpWizardSeries").onchange=()=>{
    $("mpSeries").value=$("mpWizardSeries").value;
    loadEpisodes().catch(e=>notify(e.message,true));
  };
  for(const id of ["mpAiFrom","mpAiTo","mpAiStartDate","mpAiStartTime","mpAiPerDay","mpAiInterval","mpAiInstructions"])
    $(id).addEventListener("change",invalidateMuseDraft);
  $("mpMusePrepare").onclick=()=>prepareYoutubeMuse().catch(e=>notify(e.message,true));
  $("mpMuseCopy").onclick=()=>copyYoutubeMusePrompt().catch(e=>notify(e.message,true));
  $("mpMuseDownload").onclick=()=>{try{downloadYoutubeMusePrompt();}catch(e){notify(e.message,true);}};
  $("mpMuseJsonFile").onchange=()=>readMuseJsonFile().catch(e=>notify(e.message,true));
  $("mpMuseImport").onclick=()=>importYoutubeMuse().catch(e=>{
    $("mpMuseStatus").textContent="JSON chưa hợp lệ: "+e.message;notify(e.message,true);
  });
  $("mpWizardReview").onclick=()=>setWizardStep(3);
  $("mpAttentionRefresh").onclick=()=>loadJobs().catch(e=>notify(e.message,true));
  $("mpAiGenerate").onclick=()=>generateYoutubeCampaign().then(()=>setWizardStep(3)).catch(e=>{notify(e.message,true);$("mpAiProgress").textContent="Lỗi: "+e.message;});
  $("mpAiApprove").onclick=()=>approveYoutubeCampaign().catch(e=>notify(e.message,true));
  $("mpJobClose").onclick=()=>$("mpJobDialog").close();
  $("mpJobSave").onclick=()=>updateYoutubeJob().catch(e=>notify(e.message,true));
  $("mpJobReconcile").onclick=()=>reconcileYoutubeJob().catch(e=>notify(e.message,true));
  $("mpJobRetry").onclick=()=>retryYoutubeJob().catch(e=>notify(e.message,true));
  $("mpSeries").onchange=()=>loadEpisodes().catch(e=>notify(e.message,true));
  $("mpForm").onsubmit=e=>schedule(e).catch(err=>notify(err.message,true));
  const d=new Date(Date.now()+86400000+7*3600000);
  $("mpScheduled").value=d.toISOString().slice(0,10)+"T12:00";
  $("mpAiStartDate").value=d.toISOString().slice(0,10);
  await refreshMultiplatform();
}
export async function refreshMultiplatform(){
  try{await loadAll();await loadSeries();}catch(e){notify(e.message,true);}
}
