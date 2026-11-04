// Pure preview generator; never uploads media or posts to Meta.
export const CAMPAIGN_TIMEZONE = "Asia/Ho_Chi_Minh";
const dateParts = value => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) throw Error("startDate phải có định dạng YYYY-MM-DD");
  const [year,month,day] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day)
    throw Error("startDate không hợp lệ");
  return {year,month,day};
};
const minuteOfDay = value => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  if (!m) throw Error("Giờ đăng phải có định dạng HH:mm");
  return Number(m[1])*60+Number(m[2]);
};
const two = value => String(value).padStart(2,"0");
const fmtClock = n => two(Math.floor(n/60))+":"+two(n%60);
const localDate = (start,offset) =>
  new Date(Date.UTC(start.year,start.month-1,start.day+offset)).toISOString().slice(0,10);
const utcISO = (day,minute) => {
  const [y,m,d] = day.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d,0,minute-7*60)).toISOString();
};
function validatePage(raw, defaults) {
  const pageId=String(raw?.pageId||"").trim(),seriesId=String(raw?.seriesId||"").trim();
  if (!/^\d{5,25}$/.test(pageId)) throw Error("Page ID không hợp lệ");
  if (!/^[a-zA-Z0-9_-]{3,90}$/.test(seriesId)) throw Error("Series ID không hợp lệ");
  if (!Array.isArray(raw?.episodes) || !raw.episodes.length || raw.episodes.length>5000)
    throw Error("Danh sách tập trống hoặc không hợp lệ");
  const numbers=new Set(), files=new Set();
  const episodes=raw.episodes.map(ep => {
    const number=Number(ep?.number??ep?.num),driveFileId=String(ep?.driveFileId||"").trim();
    if (!Number.isSafeInteger(number)||number<1||number>5000||numbers.has(number))
      throw Error("Số tập trùng hoặc không hợp lệ");
    if (!/^[\w-]{10,128}$/.test(driveFileId)||files.has(driveFileId))
      throw Error("Drive File ID trùng hoặc không hợp lệ");
    numbers.add(number); files.add(driveFileId);
    return {number,driveFileId,rightsApproved:ep.rightsApproved===true};
  }).sort((a,b)=>a.number-b.number);
  const dailyLimit=raw.dailyLimit==null?defaults.dailyLimit:Number(raw.dailyLimit);
  const days=raw.days==null?defaults.days:Number(raw.days);
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100) throw Error("Số tập/ngày của phân công không hợp lệ");
  if(!Number.isInteger(days)||days<1||days>90) throw Error("Số ngày của phân công không hợp lệ");
  return {pageId,seriesId,episodes,dailyLimit,days};
}
/**
 * Build campaign draft for independent Fanpages in Vietnam time.
 * Each row requires editorial approval before any future publisher may act.
 */
export function buildCampaignSchedule({
  pages,startDate,days=7,dailyLimit=12,windowStart="08:00",
  windowEnd="22:00",staggerMinutes=3,timezone=CAMPAIGN_TIMEZONE
}={}) {
  if (timezone!==CAMPAIGN_TIMEZONE) throw Error("Chỉ hỗ trợ Asia/Ho_Chi_Minh");
  if (!Array.isArray(pages)||pages.length<1||pages.length>50) throw Error("Cần từ 1 đến 50 phân công Fanpage–phim");
  if (!Number.isInteger(days)||days<1||days>90) throw Error("Số ngày không hợp lệ");
  if (!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100) throw Error("Số tập/ngày không hợp lệ");
  if (!Number.isInteger(staggerMinutes)||staggerMinutes<0||staggerMinutes>30)
    throw Error("Phút lệch Page không hợp lệ");
  const start=dateParts(startDate),begin=minuteOfDay(windowStart),end=minuteOfDay(windowEnd);
  const slack=(pages.length-1)*staggerMinutes;
  if (end<=begin+slack) throw Error("Khung giờ không đủ rộng");
  const cleaned=pages.map(p=>validatePage(p,{dailyLimit,days}));
  if(new Set(cleaned.map(x=>x.pageId+":"+x.seriesId)).size!==cleaned.length)
    throw Error("Một Fanpage không thể được phân công cùng bộ phim hai lần");
  if(cleaned.reduce((sum,p)=>sum+p.episodes.length,0)>5000)
    throw Error("Một bản nháp chỉ hỗ trợ tối đa 5000 bài; hãy chia chiến dịch");
  const usedPageFiles=new Set();
  for(const page of cleaned) for(const ep of page.episodes){
    const key=page.pageId+":"+ep.driveFileId;
    if(usedPageFiles.has(key))throw Error("Một video Drive bị chọn lặp lại trên cùng Fanpage");
    usedPageFiles.add(key);
  }
  const entries=[];
  for (const [pageIndex,page] of cleaned.entries()) {
    if(page.episodes.length>page.days*page.dailyLimit)
      throw Error("Không xếp đủ "+page.episodes.length+" tập trên Fanpage "+page.pageId+
        " trong "+page.days+" ngày; tăng số ngày hoặc số tập/ngày");
    for (let dayIndex=0;dayIndex<page.days;dayIndex++) {
      const batch=page.episodes.slice(dayIndex*page.dailyLimit,(dayIndex+1)*page.dailyLimit);
      const day=localDate(start,dayIndex);
      for (let i=0;i<batch.length;i++) {
        const pct=batch.length===1?0:i/(batch.length-1);
        const minute=Math.round(begin+pct*(end-begin-slack))+pageIndex*staggerMinutes;
        const ep=batch[i];
        entries.push({
          pageId:page.pageId,seriesId:page.seriesId,episodeNumber:ep.number,
          driveFileId:ep.driveFileId,localDate:day,localTime:fmtClock(minute),
          timezone,scheduledAt:utcISO(day,minute),rightsApproved:ep.rightsApproved,
          editorialApproved:false,status:ep.rightsApproved?"draft":"awaiting_rights"
        });
      }
    }
  }
  return entries.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||
    a.pageId.localeCompare(b.pageId)||a.episodeNumber-b.episodeNumber);
}
