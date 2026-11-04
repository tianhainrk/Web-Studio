import {parseLosslessJSON} from "./lossless-json.mjs";
import { setTimeout as delay } from "node:timers/promises";

export class ProviderError extends Error {
  constructor(message, code = "provider_error") { super(message); this.code = code; }
}

export const API_HOST = "https://api-va.tiktokv.com";
const USER_AGENT = "PineDrama/466003 CFNetwork/Darwin";
const MAX_BODY = 2 * 1024 * 1024;

const common = () => ({
  aid: "845221", app_name: "tiktok_drama", app_package: "com.ss.iphone.ttmd.video",
  channel: "App Store", version_code: "46.6.0", app_version: "46.6.0",
  build_number: "466003", device_platform: "iphone",
  device_type: process.env.PINE_DEVICE_TYPE || "iPhone17,3",
  os_version: process.env.PINE_OS_VERSION || "26.0",
  os_api: process.env.PINE_OS_API || "26",
  language: "vi", app_language: "vi", locale: "vi_VN",
  sys_region: "VN", region: "VN", carrier_region: process.env.PINE_CARRIER_REGION || "VN", content_language: "vi",
  tz_name: process.env.PINE_TZ_NAME || "Etc/UTC", tz_offset: process.env.PINE_TZ_OFFSET || "0"
});

const numericID = value => {
  const s = typeof value === "bigint" ? String(value) :
    typeof value === "string" ? value :
    (typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "");
  if (!/^[1-9][0-9]{0,18}$/.test(s) || BigInt(s) > 9223372036854775807n) {
    throw new ProviderError("ID phim/tập không hợp lệ", "bad_id");
  }
  return s;
};
export { numericID };

function flag(v) {
  if (v === undefined || v === null) return false;
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  throw new ProviderError("Cờ quyền truy cập không hợp lệ", "invalid_flag");
}
function statusOK(data) {
  if (data.status_code !== 0 || (data.biz_code != null && data.biz_code !== 0))
    throw new ProviderError("PineDrama chưa chấp nhận yêu cầu", "upstream_denied");
}
function coverURL(v) {
  const raw = typeof v === "string" ? v : v?.url_list?.[0];
  try { const u = new URL(raw); return u.protocol === "https:" ? u.href : null; }
  catch { return null; }
}
function candidateURL(s) {
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password ||
        !u.hostname || !u.pathname || u.pathname.startsWith("/tiktok/md/") ||
        /^(localhost|127\.|0\.0\.0\.0|::1)$/i.test(u.hostname) ||
        /\.(json|html?)$/i.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}

async function request(path, params) {
  const url = new URL("/tiktok/md/" + path, API_HOST);
  const entries = { ...common(), ...params };
  for (const k of Object.keys(entries).sort()) url.searchParams.set(k, entries[k]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, "accept": "application/json, application/x-protobuf" },
      signal: controller.signal, redirect: "manual"
    });
    if (response.status !== 200) throw new ProviderError("PineDrama HTTP " + response.status, "http");
    const announced = Number(response.headers.get("content-length") || 0);
    if (announced > MAX_BODY) throw new ProviderError("Phản hồi quá lớn", "limit");
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BODY)
      throw new ProviderError("Phản hồi rỗng hoặc quá lớn", "limit");
    return { buffer, mime: response.headers.get("content-type") || "" };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(err.name === "AbortError" ? "PineDrama timeout" : "Không thể kết nối PineDrama", "network");
  } finally { clearTimeout(timer); }
}

function json(bytes) {
  try { return parseLosslessJSON(bytes); }
  catch { throw new ProviderError("JSON không hợp lệ", "invalid_json"); }
}

export function decodeCatalog(data) {
  statusOK(data);
  if (!Array.isArray(data.collections)) throw new ProviderError("Catalog thiếu collections", "invalid_catalog");
  const used = new Set();
  const movies = data.collections.map(row => {
    const id = numericID(row.collection_id_str ?? row.collection_id);
    if (used.has(id) || typeof row.title !== "string" || !row.title.trim())
      throw new ProviderError("Catalog trùng ID hoặc thiếu tên", "invalid_catalog");
    used.add(id);
    const total = row.num_videos == null ? null : Number(row.num_videos);
    if (total != null && (!Number.isInteger(total) || total < 1 || total > 5000))
      throw new ProviderError("Số tập không hợp lệ", "invalid_catalog");
    return {
      id, title: row.title.trim(), description: typeof row.description === "string" ? row.description : "",
      poster: coverURL(row.cover), episodeCount: total
    };
  });
  const more = flag(data.has_more);
  const cursor = more && typeof data.cursor === "string" && data.cursor.trim() ? data.cursor : null;
  return { movies, nextCursor: cursor, serverHasMore: more, blockedByEmptyCursor: more && !cursor };
}

export function decodePlaylist(data, movie) {
  statusOK(data);
  if (!Array.isArray(data.episode_list)) throw new ProviderError("Thiếu episode_list", "incomplete_playlist");
  const usedIDs = new Set(), usedNumbers = new Set(), episodes = [];
  for (const row of data.episode_list) {
    if (flag(row.is_intro)) continue;
    const id = numericID(row.video_id_str ?? row.video_id);
    const number = Number(row.num), seq = Number(row.seq_id);
    if (!Number.isSafeInteger(number) || number < 1 || number !== seq ||
        usedIDs.has(id) || usedNumbers.has(number))
      throw new ProviderError("Tập phim không liên tục/trùng lặp", "incomplete_playlist");
    usedIDs.add(id); usedNumbers.add(number);
    episodes.push({
      id, seriesId: movie.id, number,
      title: typeof row.title === "string" ? row.title : "",
      locked: flag(row.is_paid) && !flag(row.has_purchased) && !flag(row.is_limited_free),
      limitedFree: flag(row.is_limited_free)
    });
  }
  const expected = movie.episodeCount == null ? episodes.length : movie.episodeCount;
  episodes.sort((a,b)=>a.number-b.number);
  if (!expected || expected !== episodes.length || episodes.some((e,i)=>e.number !== i+1))
    throw new ProviderError("Playlist không đầy đủ, không giả tạo tập thiếu", "incomplete_playlist");
  return { seriesId: movie.id, episodes, reportedTotal: expected };
}

export class PB {
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length > MAX_BODY) throw new ProviderError("Protobuf vượt giới hạn", "invalid_pb");
    this.fields = new Map();
    let p = 0, count = 0;
    const varint = () => {
      let value = 0n;
      for (let i=0; i<10; i++) {
        if (p >= bytes.length) throw new ProviderError("Protobuf bị cắt", "invalid_pb");
        const b = bytes[p++];
        if (i === 9 && b > 1) throw new ProviderError("Protobuf varint overflow", "invalid_pb");
        value |= BigInt(b & 127) << BigInt(7*i);
        if (!(b & 128)) return value;
      }
      throw new ProviderError("Protobuf varint lỗi", "invalid_pb");
    };
    while (p < bytes.length) {
      if (++count > 50000) throw new ProviderError("Protobuf quá nhiều trường", "invalid_pb");
      const tag = varint(), field = Number(tag >> 3n), wire = Number(tag & 7n);
      if (field < 1 || field > 536870911) throw new ProviderError("Protobuf field lỗi", "invalid_pb");
      let value;
      if (wire === 0) value = { type:"uint", data:varint() };
      else if (wire === 1 || wire === 5) {
        const n = wire === 1 ? 8 : 4;
        if (n > bytes.length-p) throw new ProviderError("Protobuf bị cắt", "invalid_pb");
        p += n; value = { type:"fixed" };
      } else if (wire === 2) {
        const n = Number(varint());
        if (!Number.isSafeInteger(n) || n > bytes.length-p) throw new ProviderError("Protobuf length lỗi", "invalid_pb");
        value = { type:"bytes", data:bytes.subarray(p,p+n) };
        p += n;
      } else throw new ProviderError("Protobuf wire không hỗ trợ", "invalid_pb");
      if (!this.fields.has(field)) this.fields.set(field, []);
      this.fields.get(field).push(value);
    }
  }
  one(f, type) {
    const vals = this.fields.get(f);
    if (!vals) return null;
    if (vals.length !== 1 || vals[0].type !== type) throw new ProviderError("Protobuf type lỗi", "invalid_pb");
    return vals[0].data;
  }
  uint(f) { return this.one(f,"uint"); }
  id(f) { const n = this.uint(f); return n == null ? null : numericID(n); }
  str(f) {
    const v=this.one(f,"bytes"); if (!v) return null;
    try { return new TextDecoder("utf-8",{fatal:true}).decode(v); }
    catch { throw new ProviderError("Protobuf text lỗi", "invalid_pb"); }
  }
  msg(f) { const v=this.one(f,"bytes"); return v ? new PB(v) : null; }
  many(f) {
    return (this.fields.get(f) || []).map(x => {
      if (x.type !== "bytes") throw new ProviderError("Protobuf message lỗi", "invalid_pb");
      return new PB(x.data);
    });
  }
  strings(f) {
    return (this.fields.get(f)||[]).map(v=>{
      if (v.type !== "bytes") throw new ProviderError("Protobuf string lỗi","invalid_pb");
      return new TextDecoder("utf-8",{fatal:true}).decode(v.data);
    });
  }
}

export function decodeStreamJSON(obj, episode) {
  statusOK(obj);
  const matched=(obj.paid_videos||[]).filter(row=>
    String(row.paid_video_id)===episode.id || String(row.aweme?.aweme_id)===episode.id);
  if (matched.length!==1) throw new ProviderError("Không khớp ID tập","missing_episode");
  const row=matched[0], aweme=row.aweme||{}, paid=aweme.paid_content_info||aweme.paid_content||{};
  if (numericID(row.paid_video_id)!==episode.id || String(aweme.aweme_id)!==episode.id ||
      Number(row.seq_id)!==episode.number ||
      (paid.paid_collection_id && numericID(paid.paid_collection_id)!==episode.seriesId) ||
      (paid.paid_video_id && numericID(paid.paid_video_id)!==episode.id) ||
      (paid.episode_num && Number(paid.episode_num)!==episode.number))
    throw new ProviderError("Video không khớp tập đã chọn","missing_episode");
  if (flag(row.is_intro) || flag(paid.is_partial_preview) || flag(paid.should_show_preview) ||
      flag(paid.is_paid_video_encrypted) || flag(aweme.video?.need_set_token))
    throw new ProviderError("Tập bị khóa/preview/token","locked");
  const ids=[obj.collection?.collection_id, paid.paid_collection_id].filter(x=>x!=null).map(numericID);
  if (!ids.length || ids.some(x=>x!==episode.seriesId))
    throw new ProviderError("Không khớp bộ phim","missing_episode");
  const candidates=[];
  for (const br of (aweme.video?.bit_rate||[])) {
    const addr=br?.play_addr;
    const u=(addr?.url_list||[]).map(candidateURL).find(Boolean);
    if (u) {
      const w=Number(addr?.width||0), h=Number(addr?.height||0), rate=Number(br?.bit_rate||0);
      candidates.push({ url:u, width:w, height:h, bitrate:rate, gear:String(br?.gear_name||"") });
    }
  }
  candidates.sort((a,b)=>(b.width*b.height - a.width*a.height) || (b.bitrate - a.bitrate));
  for (const addr of [aweme.video?.play_addr, aweme.video?.play_addr_h264]) {
    const u=(addr?.url_list||[]).map(candidateURL).find(Boolean);
    if (u) candidates.push({ url:u, width:Number(addr?.width||0), height:Number(addr?.height||0), bitrate:0, gear:"default" });
  }
  const best=candidates[0];
  if (!best) throw new ProviderError("Không có URL phát hợp lệ","no_video");
  return {
    url: best.url,
    mime: best.url.split("?")[0].endsWith(".m3u8")?"application/vnd.apple.mpegurl":"video/mp4",
    width: best.width||null,
    height: best.height||null,
    gear: best.gear||null
  };
}

export function decodeStreamPB(bytes, episode) {
  const res=new PB(bytes);
  if ((res.uint(1)||0n)!==0n || (res.uint(27)||0n)!==0n)
    throw new ProviderError("PineDrama từ chối cấp video","upstream_denied");
  const matched=[];
  for (const row of res.many(2)) {
    const aweme=row.msg(4);
    if (aweme && (row.id(1)===episode.id || aweme.str(1)===episode.id))
      matched.push({row,aweme});
  }
  if (matched.length!==1) throw new ProviderError("Không khớp tập","missing_episode");
  const {row,aweme}=matched[0], video=aweme.msg(7), paid=aweme.msg(317);
  if (!video || row.id(1)!==episode.id || aweme.str(1)!==episode.id ||
      row.uint(12)!==BigInt(episode.number) || (row.uint(5)||0n)!==0n)
    throw new ProviderError("Không khớp định danh video","missing_episode");
  const ids=[];
  const collection=res.msg(14);
  if (collection?.id(1)) ids.push(collection.id(1));
  if (paid?.id(1)) ids.push(paid.id(1));
  if (!ids.length || ids.some(x=>x!==episode.seriesId) ||
      (paid?.id(6) && paid.id(6)!==episode.id) ||
      (paid?.uint(3) && paid.uint(3)!==BigInt(episode.number)))
    throw new ProviderError("Không khớp collection","missing_episode");
  if ((paid?.uint(7)||0n)!==0n || (paid?.uint(8)||0n)!==0n ||
      (paid?.uint(17)||0n)!==0n || (video.uint(24)||0n)!==0n)
    throw new ProviderError("Tập bị khóa/preview/token","locked");
  const candidates=[];
  for (const br of video.many(11)) {
    const addr=br.msg(4);
    if (!addr) continue;
    const u=addr.strings(2).map(candidateURL).find(Boolean);
    if (u) {
      const w=Number(addr.uint(3)||0n), h=Number(addr.uint(4)||0n), rate=Number(br.uint(3)||0n);
      candidates.push({ url:u, width:w, height:h, bitrate:rate, gear:br.str(1)||"" });
    }
  }
  candidates.sort((a,b)=>(b.width*b.height - a.width*a.height) || (b.bitrate - a.bitrate));
  for (const field of [1,18]) {
    const address=video.msg(field);
    if (address) {
      const u=address.strings(2).map(candidateURL).find(Boolean);
      if (u) candidates.push({ url:u, width:Number(address.uint(3)||0n), height:Number(address.uint(4)||0n), bitrate:0, gear:"default" });
    }
  }
  const best=candidates[0];
  if (!best) throw new ProviderError("Không có URL phát hợp lệ","no_video");
  return {
    url: best.url,
    mime: best.url.split("?")[0].endsWith(".m3u8")?"application/vnd.apple.mpegurl":"video/mp4",
    width: best.width||null,
    height: best.height||null,
    gear: best.gear||null
  };
}

export async function discover({ count=12, cursor="" }={}) {
  if (![12,24,50].includes(Number(count))) throw new ProviderError("count chỉ 12, 24, 50","invalid_count");
  const { buffer }=await request("mini_drama_center/v1/", {
    scene:"1",category_id:"",cursor:String(cursor),count:String(count),is_mixed_column_page:"0"
  });
  return decodeCatalog(json(buffer));
}
export async function playlist(movie) {
  const {buffer}=await request("collection/episode_panel/v1/",{collection_id:numericID(movie.id)});
  return decodePlaylist(json(buffer),movie);
}
export async function resolve(episode) {
  if (episode.locked) throw new ProviderError("Tập đang khóa","locked");
  const {buffer,mime}=await request("collection/video/v1/",{
    collection_id:numericID(episode.seriesId), query_type:"seq_id",
    current_seq_id:String(episode.number),count:"10",direction:"1",root_scene:"2",
    query_scene:"mini_drama_container",enter_from:"series_discover",
    is_trailer_paginated:"0",need_collection_detail:"0",
    drama_request_type:"load_more",iap_country_code:"",request_source:"",
    ac:"wifi",resolution:"1290*2796",dpi:"460"
  });
  const startsJSON=[...buffer].find(x=>![9,10,13,32].includes(x))===123;
  return startsJSON || mime.includes("json")
    ? decodeStreamJSON(json(buffer),episode) : decodeStreamPB(buffer,episode);
}
