// Public-page metadata adapter. No signing keys, cookies, entitlements or DRM work.
const MAX_EPISODES = 5000;
const numberId = value => {
  const text = String(value ?? "").trim();
  return /^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : null;
};
const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const flag = value => value === true || value === 1 || value === "1" || value === "true";
const notFlag = value => value === false || value === 0 || value === "0" || value === "false";

export function parseDramaBoxInput(text) {
  const input = String(text || "").trim();
  if (numberId(input)) return {bookId:input, origin:"https://www.dramaboxdb.com"};
  let url;
  try { url = new URL(input); } catch { throw Error("Dán Book ID hoặc link phim DramaBox hợp lệ"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["www.dramaboxdb.com","dramaboxdb.com","www.dramabox.com","dramabox.com"].includes(url.hostname.toLowerCase()))
    throw Error("Chỉ chấp nhận link HTTPS của DramaBox hoặc Book ID");
  const match = url.pathname.match(/\/(?:movie|drama|detail|ep)\/(\d{5,19})(?:\/|$)/i);
  if (!match || !numberId(match[1])) throw Error("Không tìm thấy Book ID hợp lệ trong đường dẫn phim");
  return {
    bookId:match[1],
    origin:url.hostname.toLowerCase().includes("dramaboxdb.com") ?
      "https://www.dramaboxdb.com":"https://www.dramabox.com"
  };
}

function getNextData(html) {
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scripts.exec(html))) {
    if (!/\bid\s*=\s*(["'])__NEXT_DATA__\1/i.test(match[1])) continue;
    try { return JSON.parse(match[2]); }
    catch { throw Error("Trang có __NEXT_DATA__ nhưng JSON không hợp lệ"); }
  }
  throw Error("Trang không cung cấp __NEXT_DATA__; cấu trúc website có thể đã đổi hoặc bị bảo vệ");
}

function pickEpisodeArray(props) {
  const p = asObject(props);
  const book=asObject(p.bookInfo || p.book || p.dramaInfo);
  const lists = [p.chapterList,p.chapters,p.episodeList,p.episodes,
    book.chapterList,book.episodes,asObject(p.chapterData).list,
    asObject(p.chapterData).chapterList,asObject(p.bookDetail).chapterList];
  return lists.find(Array.isArray) || null;
}

function explicitLocked(ch) {
  const paid = flag(ch.isCharge) || flag(ch.is_paid) || flag(ch.isPaid);
  const purchased = flag(ch.isPay) || flag(ch.hasPurchased) || flag(ch.has_purchased);
  const free = flag(ch.isFree) || flag(ch.is_free) || flag(ch.isLimitedFree);
  if (purchased || free || notFlag(ch.isCharge) || notFlag(ch.is_paid)) return false;
  if (paid || ch.unlock === false || ch.locked === true) return true;
  return false;
}

function streamCandidate(ch) {
  const cdnList=Array.isArray(ch.cdnList)?ch.cdnList:[];
  const fromCDN=cdnList.flatMap(c=>Array.isArray(c?.videoPathList)?c.videoPathList:[])
    .find(v=>typeof v?.videoPath==="string" && /^https:\/\//i.test(v.videoPath));
  const candidates=[ch.mp4,ch.videoUrl,ch.videoPath,ch.m3u8Url,fromCDN?.videoPath];
  return candidates.find(v=>typeof v==="string" && /^https:\/\//i.test(v)) || null;
}

export function extractPublicDramaBoxSeries(payload, bookId) {
  const data = asObject(payload);
  const props=asObject(data.props?.pageProps || data.pageProps || data.data?.pageProps);
  const info=asObject(props.bookInfo || props.book || props.dramaInfo || props.bookDetail);
  const list=pickEpisodeArray(props);
  if (!list || !list.length) throw Error("Trang chưa trả danh sách tập công khai. Không tạo danh sách giả.");
  if (list.length>MAX_EPISODES) throw Error("Danh sách tập vượt giới hạn cho phép");
  const seen=new Set();
  const episodes=list.map((raw,i)=>{
    const ch=asObject(raw);
    const index=ch.index ?? ch.chapterIndex;
    const number=index == null?i+1:Number(index)+1;
    if (!Number.isSafeInteger(number)||number<1||number>MAX_EPISODES||seen.has(number))
      throw Error("Số tập không hợp lệ hoặc bị trùng");
    seen.add(number);
    const locked=explicitLocked(ch);
    const publicUrl=streamCandidate(ch);
    return {
      num:number,
      title:String(ch.name||ch.chapterName||ch.title||"Tập "+number).slice(0,120),
      chapterId:String(ch.id??ch.chapterId??""),
      locked,
      source_locked:locked,
      source_status:locked?"web_restricted":publicUrl?"web_url_present":"web_no_url",
      direct_url:locked?null:publicUrl
    };
  }).sort((a,b)=>a.num-b.num);
  const countRaw=info.chapterCount ?? info.chapterNum ?? props.chapterCount;
  const reportedCount=Number.isInteger(Number(countRaw)) && Number(countRaw)>0 ?
    Number(countRaw) : episodes.length;
  return {
    platform:"dramabox",
    series_id:"dramabox:"+bookId,
    name:String(info.bookName || info.name || info.title || "DramaBox #"+bookId).slice(0,120),
    episode_count:episodes.length,
    reported_episode_count:reportedCount,
    incomplete:reportedCount>episodes.length,
    episodes,
    source:"Public DramaBox web metadata only; fallback providers may report different availability, not proof of entitlement",
  };
}

export function parseDramaBoxPublicHTML(html, bookId) {
  return extractPublicDramaBoxSeries(getNextData(html), bookId);
}
