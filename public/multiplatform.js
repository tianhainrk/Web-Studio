let ready=false,accounts=[],series=[],episodes=[],jobs=[],attentionJobs=[],config={};
let aiDrafts=[],aiGenerating=false,editingYouTubeJob=null;
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
  const root=$("mpAccounts");root.replaceChildren();
  if(!accounts.length)root.append(mk("p","Chưa kết nối kênh YouTube hoặc TikTok.","mp-muted"));
  for(const a of accounts){
    const row=mk("label","","mp-account");
    const check=mk("input");check.type="checkbox";check.value=a.id;check.disabled=!a.active;
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
  const select=$("mpSeries");select.replaceChildren(new Option("Chọn phim trên Google Drive",""));
  for(const s of series)select.append(new Option(s.title||s.name,s.id));
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
  renderJobs();renderAttention();
}
async function loadAll(){
  const c=await api("/config");
  config=c;
  if(!c.enabled){$("mpCreate").disabled=true;$("mpYoutubeConnect").disabled=true;
    $("mpTikTokConnect").disabled=true;notify("Bật MULTIPLATFORM_ENABLED=true trên Vercel sau khi áp dụng SQL.",true);return;}
  const [a,j]=await Promise.all([api("/accounts"),api("/jobs")]);
  config=c;accounts=a.accounts||[];jobs=j.jobs||[];
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
  renderAccounts();renderJobs();renderAttention();
  if(!c.enabled)notify("Chưa bật MULTIPLATFORM_ENABLED=true trên Vercel. Facebook Reels vẫn hoạt động riêng.",true);
}
async function loadSeries(){
  const r=await drive("/series");series=r.series||[];renderSeries();
}
async function loadEpisodes(){
  const folder=$("mpSeries").value;episodes=[];renderEpisodes();if(!folder)return;
  const data=await drive("/episodes?folder="+encodeURIComponent(folder));episodes=data.episodes||[];renderEpisodes();
  aiDrafts=[];renderAiDrafts();
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
  if(!aiDrafts.length)return "Chưa có bản nháp AI.";
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
  const title=series.find(s=>s.id===$("mpSeries").value)?.title||series.find(s=>s.id===$("mpSeries").value)?.name;
  if(!title)throw Error("Chưa có tên phim");
  aiDrafts=[];aiGenerating=true;renderAiDrafts();$("mpAiGenerate").disabled=true;
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
        aiDrafts.push({...slot,...item,folderId:$("mpSeries").value});
      }
      renderAiDrafts();
    }
  }finally{aiGenerating=false;$("mpAiGenerate").disabled=!config.gemini||!config.enabled;renderAiDrafts();}
}
async function approveYoutubeCampaign(){
  const problem=validateAiDrafts();if(problem)throw Error(problem);
  if(!$("mpAiRights").checked||!$("mpAiConsent").checked)
    throw Error("Cần xác nhận quyền phân phối và chấp thuận bản nháp trước khi xếp lịch");
  const targets=checkedAccounts().filter(x=>x.provider==="youtube"&&x.active);
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
      ". Chưa tự đăng nếu GitHub Actions worker chưa bật.");
  }finally{await loadJobs().catch(()=>{});updateAiValidation();}
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

        <section class="mp-card mp-ai-card" aria-labelledby="mpAiTitle">
          <div class="mp-card-head"><h3 id="mpAiTitle">4. AI chiến dịch YouTube Shorts</h3><span class="mp-tag">Gemini · duyệt trước</span></div>
          <p class="mp-hint">Gemini dựa vào tên phim và số tập để đề xuất tiêu đề, mô tả và giờ đăng. AI không xem nội dung video ở chế độ này. Bạn được sửa từng bài trước khi duyệt.</p>
          <div class="mp-two"><label>Tập bắt đầu<input id="mpAiFrom" type="number" min="1" max="5000" value="1"></label>
            <label>Tập kết thúc<input id="mpAiTo" type="number" min="1" max="5000" value="10"></label></div>
          <div class="mp-two"><label>Ngày bắt đầu (Việt Nam)<input id="mpAiStartDate" type="date"></label>
            <label>Giờ bài đầu (Việt Nam)<input id="mpAiStartTime" type="time" value="09:00"></label></div>
          <div class="mp-two"><label>Bài mỗi ngày<select id="mpAiPerDay"><option value="2">2 bài</option><option value="3" selected>3 bài</option><option value="5">5 bài</option><option value="8">8 bài</option></select></label>
            <label>Khoảng cách (phút)<input id="mpAiInterval" type="number" min="15" max="600" value="120"></label></div>
          <label>Phong cách tiêu đề và mô tả<textarea id="mpAiInstructions" rows="2" maxlength="800" placeholder="Tự nhiên, gợi tò mò, tránh spoil, tối đa 3 hashtag"></textarea></label>
          <div class="mp-actions"><button type="button" id="mpAiGenerate" class="mp-secondary">Gemini tạo nội dung và gợi ý giờ đăng</button></div>
          <p id="mpAiProgress" class="mp-hint" aria-live="polite">Chọn thư mục phim ở trên và kênh YouTube muốn đăng.</p>
          <div id="mpAiDrafts" class="mp-ai-preview"></div>
          <label class="mp-check"><input type="checkbox" id="mpAiRights"> Tôi xác nhận có quyền phân phối video và âm thanh trong chiến dịch.</label>
          <label class="mp-check"><input type="checkbox" id="mpAiConsent"> Tôi đã xem và chấp thuận từng tiêu đề, mô tả, giờ đăng và kênh YouTube đã chọn.</label>
          <button id="mpAiApprove" class="mp-main-btn" type="button" disabled>Duyệt và xếp lịch các tập YouTube</button>
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
  $("mpYoutubeConnect").onclick=()=>location.href="/api/reels/multi/oauth/youtube/start";
  $("mpTikTokConnect").onclick=()=>location.href="/api/reels/multi/oauth/tiktok/start";
  $("mpReload").onclick=()=>refreshMultiplatform();
  $("mpAttentionRefresh").onclick=()=>loadJobs().catch(e=>notify(e.message,true));
  $("mpAiGenerate").onclick=()=>generateYoutubeCampaign().catch(e=>{notify(e.message,true);$("mpAiProgress").textContent="Lỗi: "+e.message;});
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
