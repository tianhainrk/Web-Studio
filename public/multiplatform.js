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
      </div>
      <section class="mp-card mp-queue"><div class="mp-card-head"><h3>Hàng đợi đa nền tảng</h3><span class="mp-tag">Không tác động Facebook</span></div><div id="mpJobs"></div></section>
    </div>`;
  $("mpYoutubeConnect").onclick=()=>location.href="/api/reels/multi/oauth/youtube/start";
  $("mpTikTokConnect").onclick=()=>location.href="/api/reels/multi/oauth/tiktok/start";
  $("mpReload").onclick=()=>refreshMultiplatform();
  $("mpSeries").onchange=()=>loadEpisodes().catch(e=>notify(e.message,true));
  $("mpForm").onsubmit=e=>schedule(e).catch(err=>notify(err.message,true));
  const d=new Date(Date.now()+86400000+7*3600000);
  $("mpScheduled").value=d.toISOString().slice(0,10)+"T12:00";
  await refreshMultiplatform();
}
export async function refreshMultiplatform(){
  try{await loadAll();await loadSeries();}catch(e){notify(e.message,true);}
}
