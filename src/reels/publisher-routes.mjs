import {randomUUID} from "node:crypto";
import {buildCampaignSchedule} from "./campaign-schedule.mjs";
import {db,storageReady,insertCampaign,listCampaigns,campaign,posts,getPost,patchPost} from "./publisher-storage.mjs";
import {aiConfigured,generateCaption} from "./publisher-ai.mjs";
import {oauthStart,oauthFinish,validateOAuthState,connectedResources,disconnectProvider} from "./publisher-oauth.mjs";
import {beginVideoUpload,transferOneChunk,finalizeVideoUpload,videoStatus,resetFailedUpload,cancelScheduledVideo} from "./publisher-video.mjs";

const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x||""));
const result=(body,code=200)=>({code,body});
function error(message,status=400){const e=Error(message);e.status=status;return e;}
function postFields(x,info){
  const assignment=info.pages.find(p=>String(p.pageId)===x.pageId&&String(p.seriesId)===x.seriesId);
  const episode=assignment.episodes.find(p=>Number(p.number)===x.episodeNumber);
  return {
    page_id:x.pageId,series_id:x.seriesId,
    movie_title:String(assignment.movieTitle||"").slice(0,180),
    episode_number:x.episodeNumber,
    episode_description:String(episode.episodeDescription||"").slice(0,1200),
    genres:String(assignment.genres||"").slice(0,250),
    drive_file_id:x.driveFileId,scheduled_at:x.scheduledAt,
    local_date:x.localDate,local_time:x.localTime,
    rights_approved:x.rightsApproved,
    editorial_approved:false,
    status:x.rightsApproved?"draft":"awaiting_rights"
  };
}
async function createCampaign(data){
  const plan=buildCampaignSchedule(data);
  if(!plan.length)throw error("Lịch không có tập");
  if(plan.some(p=>new Date(p.scheduledAt).getTime()<Date.now()+25*60*1000))
    throw error("Ngày giờ đăng cần còn ít nhất 25 phút để chuẩn bị video");
  const ai=data.aiProvider==="muse"?"muse":"gemini";
  const name=String(data.campaignName||"").trim().slice(0,120);
  if(!name)throw error("Hãy đặt tên chiến dịch");
  const saved=await insertCampaign({
    name,ai_provider:ai,
    tone:["natural","dramatic","concise"].includes(data.captionTone)?data.captionTone:"natural",
    status:"draft",
    config:{
      startDate:data.startDate,days:data.days,dailyLimit:data.dailyLimit,
      windowStart:data.windowStart,windowEnd:data.windowEnd,
      staggerMinutes:data.staggerMinutes,timezone:data.timezone,
      assignments: data.pages.map(p=>({
        pageId:p.pageId,seriesId:p.seriesId,movieTitle:String(p.movieTitle||"").slice(0,140),
        count:p.episodes.length,days:p.days||data.days,dailyLimit:p.dailyLimit||data.dailyLimit
      }))
    }
  },plan.map(x=>postFields(x,data)));
  return {campaign:saved,posts:plan.length};
}
async function makeCaption(id){
  const p=await getPost(id);
  if(!p)throw error("Bài không tồn tại",404);
  if(!["draft","awaiting_rights"].includes(p.status))throw error("Không sửa caption khi đã duyệt hoặc upload");
  const c=await campaign(p.campaign_id);
  if(!c)throw error("Chiến dịch không tồn tại",404);
  const generated=await generateCaption(c.ai_provider,{
    movieTitle:p.movie_title||p.series_id,episodeNumber:p.episode_number,
    episodeDescription:p.episode_description,genres:p.genres,tone:c.tone
  });
  return patchPost(id,generated,{status:"eq."+p.status});
}
async function captionBatch(ids){
  if(!Array.isArray(ids)||ids.length<1||ids.length>5||ids.some(x=>!uuid(x)))
    throw error("Mỗi đợt AI nhận tối đa 5 bài hợp lệ");
  // Parallel bounded fan-out keeps this endpoint within short function deadlines.
  return Promise.all(ids.map(async id=>{
    try{
      const p=await makeCaption(id);
      return {id,ok:true,caption:p.caption,title:p.title,hashtags:p.hashtags};
    }catch(e){return {id,ok:false,error:String(e.message).slice(0,200)};}
  }));
}
async function approvePost(id,changes){
  const p=await getPost(id);
  if(!p||!["draft","awaiting_rights"].includes(p.status))throw error("Bài không còn ở trạng thái nháp");
  if(p.rights_approved!==true)throw error("Bài chưa được xác nhận quyền phân phối");
  const caption=String(changes.caption??p.caption??"").trim().slice(0,1500);
  if(caption.length<5)throw error("Hãy kiểm tra và duyệt caption trước");
  const title=String(changes.title??p.title??"").trim().slice(0,150);
  const hashtags=Array.isArray(changes.hashtags)?changes.hashtags:p.hashtags;
  return patchPost(id,{
    caption,title,hashtags:Array.isArray(hashtags)?hashtags.slice(0,10):[],
    editorial_approved:true,status:"approved"
  },{status:"eq."+p.status});
}
async function approveCampaign(id){
  const c=await campaign(id);
  if(!c||c.status!=="draft")throw error("Chiến dịch không còn ở trạng thái nháp");
  const all=await posts(id);
  if(!all.length||all.some(p=>p.status!=="approved"||!p.editorial_approved||!p.rights_approved))
    throw error("Cần duyệt nội dung và quyền sử dụng của mọi bài trước khi mở upload");
  if(all.some(p=>new Date(p.scheduled_at).getTime()<Date.now()+20*60*1000))
    throw error("Có bài đã quá gần giờ đăng: hãy tạo lịch khác");
  const r=await db("publisher_campaigns",{method:"PATCH",query:{id:"eq."+id,status:"eq.draft"},
    data:{status:"approved",updated_at:new Date().toISOString()},prefer:"return=representation"});
  if(!r.length)throw error("Chiến dịch đã đổi trạng thái",409);
  return r[0];
}
async function updateCaption(id,body){
  const p=await getPost(id);
  if(!p||!["draft","awaiting_rights"].includes(p.status))
    throw error("Không thể chỉnh sửa bài đã duyệt");
  return patchPost(id,{
    caption:String(body.caption||"").slice(0,1500),
    title:String(body.title||"").slice(0,150),
    hashtags:Array.isArray(body.hashtags)?body.hashtags.slice(0,10):[]
  },{status:"eq."+p.status});
}
async function cancelCampaign(id){
  const c=await campaign(id);
  if(!c)throw error("Chiến dịch không tồn tại",404);
  if(c.status!=="draft")throw error("Chiến dịch đã có upload hoặc lịch Meta; phải hủy từng lịch tại Meta trước");
  await db("publisher_campaigns",{method:"PATCH",query:{id:"eq."+id,status:"eq.draft"},
    data:{status:"cancelled"},prefer:"return=minimal"});
  return {ok:true};
}
export async function publisherRoute(p,req,body,sessionCookie,query){
  if(p==="/publisher/status"&&req.method==="GET")
    return result({storage:storageReady(),gemini:aiConfigured("gemini"),muse:aiConfigured("muse"),
      metaApp:Boolean(process.env.META_APP_ID&&process.env.META_APP_SECRET),
      googleApp:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET)});
  if(p==="/publisher/oauth/meta/start"&&req.method==="GET")
    return result({url:oauthStart("meta",sessionCookie)});
  if(p==="/publisher/oauth/google/start"&&req.method==="GET")
    return result({url:oauthStart("google",sessionCookie)});
  const m=p.match(/^\/publisher\/oauth\/(meta|google)\/callback$/);
  if(m&&req.method==="GET"){
    validateOAuthState(query.get("state"),m[1],sessionCookie);
    if(query.get("error"))throw error("OAuth bị từ chối: "+String(query.get("error")).slice(0,100));
    const connected=await oauthFinish(m[1],query.get("code"));
    return {redirect:"/?publisher="+encodeURIComponent(m[1]+"-"+connected.count)};
  }
  if(p==="/publisher/connections"&&req.method==="GET")
    return result(await connectedResources());
  if(p==="/publisher/disconnect"&&req.method==="POST"){
    if(!["meta","google"].includes(body.provider))throw error("Provider không hợp lệ");
    return result({ok:true,result:await disconnectProvider(body.provider,body.id)});
  }
  if(p==="/publisher/campaigns"&&req.method==="GET")
    return result({campaigns:await listCampaigns()});
  if(p==="/publisher/campaigns"&&req.method==="POST")
    return result(await createCampaign(body),201);
  if(p==="/publisher/campaign"&&req.method==="GET"){
    const id=query.get("id");if(!uuid(id))throw error("Campaign ID không hợp lệ");
    const c=await campaign(id);if(!c)throw error("Chiến dịch không tồn tại",404);
    return result({campaign:c,posts:await posts(id)});
  }
  if(p==="/publisher/posts/caption"&&req.method==="POST"){
    if(!uuid(body.id))throw error("Post ID không hợp lệ");
    return result({post:await makeCaption(body.id)});
  }
  if(p==="/publisher/posts/caption-batch"&&req.method==="POST")
    return result({results:await captionBatch(body.ids)});
  if(p==="/publisher/posts/edit"&&req.method==="POST"){
    if(!uuid(body.id))throw error("Post ID không hợp lệ");
    return result({post:await updateCaption(body.id,body)});
  }
  if(p==="/publisher/posts/approve"&&req.method==="POST"){
    if(!uuid(body.id))throw error("Post ID không hợp lệ");
    if(body.confirm!==true)throw error("Cần xác nhận duyệt bài");
    return result({post:await approvePost(body.id,body)});
  }
  if(p==="/publisher/campaigns/approve"&&req.method==="POST"){
    if(!uuid(body.id)||body.confirm!==true)throw error("Cần xác nhận duyệt chiến dịch");
    return result({campaign:await approveCampaign(body.id)});
  }
  if(p==="/publisher/campaigns/cancel"&&req.method==="POST"){
    if(!uuid(body.id)||body.confirm!==true)throw error("Cần xác nhận hủy chiến dịch");
    return result(await cancelCampaign(body.id));
  }
  if(p==="/publisher/upload/start"&&req.method==="POST"){
    if(!uuid(body.id)||body.confirm!==true)throw error("Cần xác nhận upload bài");
    return result({post:await beginVideoUpload(body.id)});
  }
  if(p==="/publisher/upload/step"&&req.method==="POST"){
    if(!uuid(body.id))throw error("Post ID không hợp lệ");
    return result(await transferOneChunk(body.id));
  }
  if(p==="/publisher/upload/finish"&&req.method==="POST"){
    if(!uuid(body.id)||body.confirm!==true)throw error("Cần xác nhận lên lịch Meta");
    return result({post:await finalizeVideoUpload(body.id)});
  }
  if(p==="/publisher/upload/retry"&&req.method==="POST"){
    if(!uuid(body.id)||body.confirm!==true)throw error("Cần xác nhận khôi phục upload");
    return result({post:await resetFailedUpload(body.id)});
  }
  if(p==="/publisher/upload/cancel"&&req.method==="POST"){
    if(!uuid(body.id)||body.confirm!==true)throw error("Cần xác nhận xóa lịch đã đặt trên Facebook");
    return result({post:await cancelScheduledVideo(body.id)});
  }
  if(p==="/publisher/upload/reconcile"&&req.method==="POST"){
    if(!uuid(body.id))throw error("Post ID không hợp lệ");
    return result(await videoStatus(body.id));
  }
  return null;
}
