const $=id=>document.getElementById(id);
const state={campaign:null,posts:[],offset:0,stop:false,busy:false,providers:null};
const PAGE_SIZE=20;
async function api(path,{method="GET",body}={}){
  const response=await fetch("/api/publisher/"+path,{
    method,credentials:"same-origin",
    ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
  });
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(value.error||"HTTP "+response.status);
  return value;
}
function message(text,error=false,target="fpCampaignStatus"){
  $(target).textContent=text;$(target).style.color=error?"#ff9ea4":"#bda7f0";
}
function el(tag,text="",cls=""){
  const item=document.createElement(tag);
  if(text)item.textContent=text;
  if(cls)item.className=cls;
  return item;
}
async function refreshConnections(){
  const info=await api("status");
  state.providers=info;
  let lines=[];
  lines.push("Database: "+(info.storage?"sẵn sàng":"chưa cấu hình"));
  lines.push("Gemini: "+(info.gemini?"sẵn sàng":"chưa có API key"));
  lines.push("MuseAI: "+(info.muse?"sẵn sàng":"chưa có API key"));
  lines.push("Meta App: "+(info.metaApp?"sẵn sàng":"chưa cấu hình"));
  lines.push("Google OAuth: "+(info.googleApp?"sẵn sàng":"chưa cấu hình"));
  if(info.storage){
    try{
      const conn=await api("connections");
      lines.push("Fanpage: "+conn.pages.length);
      lines.push("Drive backend: "+(conn.driveConnected?"đã kết nối":"chưa kết nối"));
      const datalist=$("fpKnownPages");datalist.replaceChildren();
      const connectionList=$("fpConnectionList");connectionList.replaceChildren();
      if(conn.driveConnected){
        const drive=el("div","","row");
        drive.style.cssText="justify-content:space-between;align-items:center";
        drive.append(el("span","Google Drive — đã kết nối"));
        const disconnect=el("button","Ngắt Drive","detail-secondary");
        disconnect.onclick=async()=>{
          if(!window.confirm("Ngắt quyền Drive của Publisher? Các lịch đã Meta xác nhận không bị xóa."))return;
          try{await api("disconnect",{method:"POST",body:{provider:"google"}});await refreshConnections();}
          catch(e){message(e.message,true);}
        };
        drive.append(disconnect);connectionList.append(drive);
      }
      for(const page of conn.pages){
        const option=el("option");option.value=page.metadata?.pageId||page.id.replace("meta-page-","");
        option.label=page.display_name;datalist.append(option);
        const entry=el("div","","row");entry.style.cssText="justify-content:space-between;align-items:center;gap:10px";
        entry.append(el("span",page.display_name+" · "+option.value));
        const disconnect=el("button","Ngắt Page","detail-secondary");
        disconnect.onclick=async()=>{
          if(!window.confirm("Ngắt liên kết "+page.display_name+"?"))return;
          try{await api("disconnect",{method:"POST",body:{provider:"meta",id:option.value}});await refreshConnections();}
          catch(e){message(e.message,true);}
        };
        entry.append(disconnect);connectionList.append(entry);
      }
    }catch(e){lines.push("Kết nối: "+e.message);}
  }
  $("fpConnectionsInfo").textContent=lines.join(" · ");
}
async function connect(provider){
  try{
    const data=await api("oauth/"+provider+"/start");
    if(!data.url||!data.url.startsWith("https://"))throw Error("Địa chỉ OAuth không hợp lệ");
    window.location.assign(data.url);
  }catch(err){message("OAuth: "+err.message,true);}
}
async function refreshCampaignList(){
  const data=await api("campaigns");
  const select=$("fpCampaignSelect");
  const selected=select.value;
  select.replaceChildren();select.append(new Option("Chọn chiến dịch đã lưu",""));
  for(const c of data.campaigns)
    select.append(new Option(c.name+" · "+c.status+" · "+c.id.slice(0,8),c.id));
  if([...select.options].some(o=>o.value===selected))select.value=selected;
}
async function openCampaign(id){
  if(!id)throw Error("Hãy chọn chiến dịch");
  const data=await api("campaign?id="+encodeURIComponent(id));
  state.campaign=data.campaign;state.posts=data.posts;
  state.offset=0;renderPosts();
  message("Đã mở chiến dịch: "+data.campaign.name+" · "+data.posts.length+" video");
}
async function reloadCampaign(){
  if(!state.campaign)return;
  const data=await api("campaign?id="+encodeURIComponent(state.campaign.id));
  state.campaign=data.campaign;state.posts=data.posts;
  renderPosts();
}
async function createCampaign(getDraft){
  const draft=getDraft();
  if(!draft)throw Error("Hãy nhấn Tạo lịch xem trước trước khi lưu chiến dịch");
  if(!window.confirm("Lưu "+draft.pages.reduce((sum,p)=>sum+p.episodes.length,0)+
    " video thành bản nháp trên máy chủ? Chưa đăng Facebook."))return;
  const result=await api("campaigns",{method:"POST",body:draft});
  await refreshCampaignList();
  $("fpCampaignSelect").value=result.campaign.id;
  await openCampaign(result.campaign.id);
}
function renderPosts(){
  const c=state.campaign;
  const counts={};
  for(const post of state.posts)counts[post.status]=(counts[post.status]||0)+1;
  $("fpSavedSummary").textContent=c
    ?c.name+" · "+c.status+" · "+state.posts.length+" video · "+
       Object.entries(counts).map(([k,v])=>k+": "+v).join(" · ")
    :"Chưa mở chiến dịch.";
  const container=$("fpSavedPosts");container.replaceChildren();
  const all=state.posts.length;
  state.offset=Math.max(0,Math.min(state.offset,Math.max(0,Math.ceil(all/PAGE_SIZE)-1)));
  const start=state.offset*PAGE_SIZE;
  $("fpPageInfo").textContent=c?("Trang "+(state.offset+1)+"/"+Math.max(1,Math.ceil(all/PAGE_SIZE))):"";
  $("fpPagePrev").disabled=state.offset===0;
  $("fpPageNext").disabled=start+PAGE_SIZE>=all;
  for(const post of state.posts.slice(start,start+PAGE_SIZE)){
    const row=el("div","","panel");
    row.style.cssText="padding:10px;background:#15192b;border:1px solid #333852;border-radius:10px";
    const title=el("div","Tập "+post.episode_number+" · "+post.movie_title+
      " · Page "+post.page_id+" · "+post.local_date+" "+post.local_time,"muted");
    row.append(title);
    row.append(el("strong",post.status+" · "+post.id.slice(0,8)));
    if(post.last_error)row.append(el("p",post.last_error,"muted"));
    if(["draft","awaiting_rights"].includes(post.status)){
      const input=el("textarea");input.rows=2;input.value=post.caption||"";
      input.placeholder="Caption — có thể tạo bằng AI rồi chỉnh sửa";
      input.style.cssText="width:100%;margin-top:8px";
      row.append(input);
      const controls=el("div","","row");
      controls.style.cssText="margin-top:6px;gap:8px;flex-wrap:wrap";
      const save=el("button","Lưu caption","detail-secondary");
      save.onclick=async()=>{try{
        const result=await api("posts/edit",{method:"POST",body:{
          id:post.id,caption:input.value,title:post.title,hashtags:post.hashtags
        }});
        Object.assign(post,result.post);
        message("Đã lưu caption tập "+post.episode_number);
      }catch(e){message(e.message,true);}};
      const ai=el("button","Tạo bằng AI","detail-secondary");
      ai.onclick=async()=>{try{
        const result=await api("posts/caption",{method:"POST",body:{id:post.id}});
        Object.assign(post,result.post);input.value=post.caption;
        message("AI đã tạo caption, hãy kiểm tra trước khi duyệt");
      }catch(e){message(e.message,true);}};
      const approve=el("button","Duyệt tập này","primary");
      approve.onclick=async()=>{try{
        if(!window.confirm("Xác nhận bạn có quyền phân phối và đã đọc caption tập "+
          post.episode_number+"?"))return;
        const result=await api("posts/approve",{method:"POST",body:{
          id:post.id,caption:input.value,title:post.title,
          hashtags:post.hashtags,confirm:true
        }});
        Object.assign(post,result.post);renderPosts();message("Đã duyệt tập "+post.episode_number);
      }catch(e){message(e.message,true);}};
      controls.append(save,ai,approve);row.append(controls);
    }
    if(["approved","uploading","failed","needs_reconcile","scheduled","published"].includes(post.status)){
      const progress=Number(post.file_size)>0
        ?" · "+Math.round(100*Number(post.start_offset||0)/Number(post.file_size))+"%":"";
      row.append(el("div","Upload"+progress+(post.meta_video_id?" · Meta ID "+post.meta_video_id:""),"muted"));
      const buttons=el("div","","row");buttons.style.marginTop="7px";
      if(post.status==="failed"){
        const retry=el("button","Tiếp tục upload","detail-secondary");
        retry.onclick=async()=>{try{await api("upload/retry",{method:"POST",body:{id:post.id,confirm:true}});await reloadCampaign();}catch(e){message(e.message,true);}};
        buttons.append(retry);
      }
      if(post.status==="scheduled"){
        const cancel=el("button","Hủy lịch trên Facebook","danger");
        cancel.onclick=async()=>{
          if(!window.confirm("Hủy video đã lên lịch trên Facebook? Thao tác này sẽ xóa video tương ứng khỏi Meta."))return;
          try{
            await api("upload/cancel",{method:"POST",body:{id:post.id,confirm:true}});
            await reloadCampaign();message("Meta đã xác nhận hủy lịch.",false,"fpUploadStatus");
          }catch(e){message(e.message,true,"fpUploadStatus");}
        };
        buttons.append(cancel);
      }
      if(post.meta_video_id){
        const reconcile=el("button","Kiểm tra Meta","detail-secondary");
        reconcile.onclick=async()=>{try{await api("upload/reconcile",{method:"POST",body:{id:post.id}});await reloadCampaign();}catch(e){message(e.message,true);}};
        buttons.append(reconcile);
      }
      row.append(buttons);
    }
    container.append(row);
  }
}
async function generateAll(){
  if(!state.campaign)throw Error("Chưa mở chiến dịch");
  state.stop=false;
  const remaining=state.posts.filter(p=>["draft","awaiting_rights"].includes(p.status)&&!p.caption);
  if(!remaining.length){message("Tất cả bài nháp đã có caption.");return;}
  if(!window.confirm("Tạo caption AI cho "+remaining.length+" video? Hệ thống sẽ sử dụng hạn mức AI của bạn."))return;
  for(let i=0;i<remaining.length&&!state.stop;i+=5){
    const ids=remaining.slice(i,i+5).map(x=>x.id);
    const data=await api("posts/caption-batch",{method:"POST",body:{ids}});
    const failed=data.results.filter(x=>!x.ok);
    message("AI: "+Math.min(i+5,remaining.length)+"/"+remaining.length+
      (failed.length?" · "+failed.length+" lỗi trong đợt":""));
  }
  await reloadCampaign();
}
async function approveVisible(){
  if(!state.campaign)throw Error("Chưa mở chiến dịch");
  const page=state.posts.slice(state.offset*PAGE_SIZE,(state.offset+1)*PAGE_SIZE)
    .filter(p=>["draft","awaiting_rights"].includes(p.status));
  if(!page.length)throw Error("Trang này không có bài chờ duyệt");
  if(!window.confirm("Duyệt "+page.length+" caption đang hiển thị? Hãy kiểm tra từng nội dung và xác nhận quyền đăng lại."))return;
  for(const p of page){
    try{
      const data=await api("posts/approve",{method:"POST",body:{id:p.id,confirm:true}});
      Object.assign(p,data.post);
    }catch(err){message("Không duyệt được tập "+p.episode_number+": "+err.message,true);break;}
  }
  renderPosts();
}
async function approveCampaign(){
  if(!state.campaign)throw Error("Chưa mở chiến dịch");
  if(!window.confirm("Tất cả video đã được kiểm tra quyền phân phối và caption? Mở cho phép upload lên Meta?"))return;
  const data=await api("campaigns/approve",{method:"POST",body:{
    id:state.campaign.id,confirm:true
  }});
  state.campaign=data.campaign;renderPosts();message("Chiến dịch đã được duyệt. Bạn có thể upload từng video.");
}
async function processPost(post){
  if(post.status==="approved"){
    message("Khởi tạo Meta cho tập "+post.episode_number,false,"fpUploadStatus");
    const started=await api("upload/start",{method:"POST",body:{id:post.id,confirm:true}});
    Object.assign(post,started.post);
  }
  if(post.status!=="uploading")throw Error("Tác vụ không ở trạng thái có thể upload");
  while(post.status==="uploading"&&!state.stop){
    if(Number(post.start_offset)>=Number(post.file_size))break;
    const response=await api("upload/step",{method:"POST",body:{id:post.id}});
    Object.assign(post,response.post);
    message("Tập "+post.episode_number+" · "+Math.round(100*response.offset/response.total)+"%",false,"fpUploadStatus");
  }
  if(post.status==="uploading"&&!state.stop&&Number(post.start_offset)>=Number(post.file_size)){
    const complete=await api("upload/finish",{method:"POST",body:{id:post.id,confirm:true}});
    Object.assign(post,complete.post);
    message("Meta đã nhận lịch tập "+post.episode_number,false,"fpUploadStatus");
  }
}
async function uploadNext(all=false){
  if(state.busy)throw Error("Đang xử lý video khác");
  if(!state.campaign||state.campaign.status!=="approved")throw Error("Chiến dịch chưa được duyệt");
  state.stop=false;state.busy=true;
  try{
    let count=0;
    for(const post of state.posts){
      if(state.stop)break;
      if(!["approved","uploading"].includes(post.status))continue;
      try{await processPost(post);count++;}
      catch(e){message("Lỗi tập "+post.episode_number+": "+e.message,true,"fpUploadStatus");break;}
      if(!all)break;
    }
    await reloadCampaign();
    if(!count)message("Không còn tác vụ upload phù hợp.",false,"fpUploadStatus");
  }finally{state.busy=false;}
}
async function reconcile(){
  if(!state.campaign)throw Error("Chưa mở chiến dịch");
  const targets=state.posts.filter(p=>p.meta_video_id&&
    ["scheduled","needs_reconcile","published"].includes(p.status)).slice(0,25);
  for(const p of targets){
    try{await api("upload/reconcile",{method:"POST",body:{id:p.id}});}
    catch(e){message("Đối soát Meta: "+e.message,true,"fpUploadStatus");}
  }
  await reloadCampaign();
}
function run(task,target="fpCampaignStatus"){
  return Promise.resolve().then(task).catch(e=>message(e.message,true,target));
}
export function initPublisherAdmin({getDraft}){
  $("fpConnectMeta").onclick=()=>run(()=>connect("meta"));
  $("fpConnectServerDrive").onclick=()=>run(()=>connect("google"));
  $("fpRefreshConnections").onclick=()=>run(refreshConnections);
  $("fpRefreshCampaigns").onclick=()=>run(refreshCampaignList);
  $("fpCreateCampaign").onclick=()=>run(()=>createCampaign(getDraft));
  $("fpOpenCampaign").onclick=()=>run(()=>openCampaign($("fpCampaignSelect").value));
  $("fpGenerateCaptions").onclick=()=>run(generateAll);
  $("fpApproveVisible").onclick=()=>run(approveVisible);
  $("fpApproveCampaign").onclick=()=>run(approveCampaign);
  $("fpUploadNext").onclick=()=>run(()=>uploadNext(false),"fpUploadStatus");
  $("fpUploadAll").onclick=()=>run(()=>uploadNext(true),"fpUploadStatus");
  $("fpStopUploads").onclick=()=>{state.stop=true;message("Đã yêu cầu dừng sau chunk hiện tại.",false,"fpUploadStatus");};
  $("fpReconcile").onclick=()=>run(reconcile,"fpUploadStatus");
  $("fpPagePrev").onclick=()=>{state.offset=Math.max(0,state.offset-1);renderPosts();};
  $("fpPageNext").onclick=()=>{state.offset++;renderPosts();};
  if(new URLSearchParams(location.search).has("publisher")){
    message("Đã quay lại từ OAuth. Kiểm tra trạng thái kết nối.");
    history.replaceState({},document.title,location.pathname);
  }
  document.addEventListener("pws:authenticated",()=>run(async()=>{
    await refreshConnections();await refreshCampaignList();
  }));
}
