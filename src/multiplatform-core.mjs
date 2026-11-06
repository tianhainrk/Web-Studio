import {validId} from "./reels-core.mjs";

export const MULTI_PROVIDERS=Object.freeze(["youtube","tiktok"]);
export function youtubeTitle(value){
  const v=String(value||"").trim();
  if(!v||v.length>100)throw Error("Tiêu đề YouTube phải dài 1–100 ký tự");
  return v;
}
export function verifyMediaUrl(value,verifiedHost){
  if(!verifiedHost||!/^[a-z0-9.-]+$/i.test(verifiedHost))throw Error("Chưa cấu hình TIKTOK_VERIFIED_MEDIA_HOST");
  let url;
  try{url=new URL(String(value||""));}catch{throw Error("TikTok cần URL video HTTPS hợp lệ");}
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!==verifiedHost.toLowerCase()||
    url.port||url.username||url.password||url.hash||url.href.length>1800)
    throw Error("URL TikTok phải thuộc đúng tên miền HTTPS đã xác minh, không có thông tin đăng nhập");
  return url.toString();
}
export function cleanPostRequest(raw,{now=Date.now(),verifiedHost="",publicTikTokApproved=false}={}){
  if(!raw||typeof raw!=="object")throw Error("Dữ liệu đăng video không hợp lệ");
  const provider=String(raw.provider||"");
  if(!MULTI_PROVIDERS.includes(provider))throw Error("Nền tảng không hợp lệ");
  if(!/^[0-9a-f-]{36}$/i.test(String(raw.accountId||"")))throw Error("Tài khoản không hợp lệ");
  if(!validId(raw.folderId)||!validId(raw.fileId)||!/^EP0*[1-9][0-9]{0,3}\.mp4$/i.test(String(raw.filename||"")))
    throw Error("Hãy chọn đúng tệp EPxxx.mp4 trong thư mục Google Drive");
  const time=Date.parse(raw.scheduledAt);
  if(!Number.isFinite(time)||time<now+60000||time>now+90*86400000)
    throw Error("Chọn giờ đăng từ 1 phút tới tối đa 90 ngày trong tương lai");
  if(raw.rightsConfirmed!==true)throw Error("Phải xác nhận có quyền phân phối video");
  if(raw.consentToPublish!==true)throw Error("Phải đồng ý rõ ràng trước khi đưa video vào lịch đăng");
  const caption=String(raw.caption||"").trim();
  if(caption.length>2200)throw Error("Caption vượt quá 2200 ký tự");
  const title=provider==="youtube"?youtubeTitle(raw.title):String(raw.title||"").slice(0,100);
  const privacy=String(raw.privacy||"");
  if(provider==="youtube"&&!["public","unlisted","private"].includes(privacy))
    throw Error("Chọn chế độ hiển thị YouTube");
  if(provider==="tiktok"&&!["SELF_ONLY","PUBLIC_TO_EVERYONE","MUTUAL_FOLLOW_FRIENDS","FOLLOWER_OF_CREATOR"].includes(privacy))
    throw Error("Chọn quyền riêng tư được TikTok cho phép");
  if(provider==="tiktok"&&!publicTikTokApproved&&privacy!=="SELF_ONLY")
    throw Error("Chưa xác minh TikTok App audit, chỉ được xếp lịch video riêng tư");
  const source_url=provider==="tiktok"?verifyMediaUrl(raw.sourceUrl,verifiedHost):null;
  return {provider,account_id:raw.accountId,folder_id:raw.folderId,file_id:raw.fileId,
    filename:raw.filename,caption,title,scheduled_at:new Date(time).toISOString(),
    privacy,source_url,consent_recorded_at:new Date(now).toISOString(),
    rights_confirmed_at:new Date(now).toISOString()};
}
export function tiktokStatus(status){
  if(status==="PUBLISH_COMPLETE")return "published";
  if(["FAILED","PUBLISH_FAILED"].includes(status))return "failed";
  return "processing";
}
export function isTikTokApprovedPrivate(privacy,creator){
  return Array.isArray(creator?.privacy_level_options)&&creator.privacy_level_options.includes(privacy);
}
