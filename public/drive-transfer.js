import {pumpMP4Stream} from "./remote-mp4-chunks.js";
// Direct Google Drive integration & unified ID-based movie folder management.
// Organizes all movies (PineDrama & DramaBox / DramaDownloader) under: PineDrama-Library/<Series_ID>/
//   - movie.json (metadata + source + uploaded episode tracking)
//   - EP001.mp4, EP002.mp4, ...
let token =
  typeof sessionStorage !== "undefined"
    ? sessionStorage.getItem("pws_drive_token") ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("pws_drive_token") || "" : "")
    : "";
let rootFolder = null;
const CHUNK = 4 * 1024 * 1024;
const DRIVE = "https://www.googleapis.com/drive/v3/";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,parents,webViewLink";

const auth = () => {
  if (!token) throw Error("Hãy kết nối Google Drive trước");
  return { Authorization: "Bearer " + token };
};
const limitedName = value => String(value || "").replace(/[\/\\\r\n\0]/g, "_").trim().slice(0, 140) || "Untitled";
const quote = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function inferSourceById(rawId, hint = "") {
  const h = String(hint || "").trim().toLowerCase();
  if (h === "dramabox" || h === "pinedrama") return h;
  const s = String(rawId || "").trim();
  if (/^(41|42|21)\d{8,10}$/.test(s) || s.length <= 13) return "dramabox";
  return "pinedrama";
}

function persistToken(value) {
  token = String(value || "").trim();
  rootFolder = null;
  if (typeof sessionStorage !== "undefined") {
    if (token) sessionStorage.setItem("pws_drive_token", token);
    else sessionStorage.removeItem("pws_drive_token");
  }
  if (typeof localStorage !== "undefined") {
    if (token) localStorage.setItem("pws_drive_token", token);
    else localStorage.removeItem("pws_drive_token");
  }
}

export function driveConnected() {
  return Boolean(token);
}

export function getDriveToken() {
  return token;
}

export function getRootFolderId() {
  return rootFolder;
}

export async function setDriveToken(rawToken) {
  const cleaned = String(rawToken || "").trim();
  if (!cleaned || cleaned.length < 16) throw Error("Access Token Google Drive không hợp lệ");
  persistToken(cleaned);
  await ensureRoot();
  return rootFolder;
}

export function disconnectDrive() {
  persistToken("");
}

async function drive(path, options = {}) {
  const response = await fetch(DRIVE + path, {
    ...options,
    headers: { ...auth(), ...options.headers },
    redirect: "error"
  });
  if (response.status === 401) {
    persistToken("");
    throw Error("Phiên Google Drive đã hết hạn. Vui lòng kết nối lại Google Drive.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error?.message || "Google Drive HTTP " + response.status);
  return body;
}

export async function connectDrive(clientId) {
  const effectiveClientId = String(
    clientId || (typeof localStorage !== "undefined" ? localStorage.getItem("pws_google_client_id") : "") || ""
  ).trim();
  if (!effectiveClientId) {
    throw Error("Chưa có GOOGLE_CLIENT_ID. Hãy nhập Google Client ID hoặc Access Token tại tab Google Drive.");
  }
  if (!window.google?.accounts?.oauth2) {
    throw Error("Thư viện Google OAuth chưa sẵn sàng. Hãy tải lại trang hoặc kiểm tra kết nối mạng.");
  }
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: effectiveClientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: async result => {
        if (result.error || !result.access_token) {
          return reject(Error(result.error_description || result.error || "Google OAuth không thành công"));
        }
        persistToken(result.access_token);
        try {
          await ensureRoot();
          resolve(rootFolder);
        } catch (e) {
          reject(e);
        }
      }
    });
    client.requestAccessToken();
  });
}

async function findFolder(name, parent = null) {
  const query = [
    "name = '" + quote(name) + "'",
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    ...(parent ? ["'" + quote(parent) + "' in parents"] : [])
  ].join(" and ");
  const result = await drive(
    "files?fields=nextPageToken,files(id,name,description,appProperties,parents,createdTime,modifiedTime)&pageSize=100&q=" +
      encodeURIComponent(query)
  );
  return result.files?.[0]?.id || null;
}

async function createFolder(name, parent = null, extra = {}) {
  const response = await drive("files?fields=id,name,description,appProperties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
      ...extra
    })
  });
  return response.id;
}

async function updateFolderMetadata(folderId, series) {
  if (!folderId || !series?.title) return;
  const idStr = String(series.id || "").trim();
  const source = inferSourceById(idStr, series.source || series.platform);
  const appProperties = {
    collectionId: idStr.slice(0, 40),
    source: source.slice(0, 20),
    platform: source.slice(0, 20),
    title: String(series.title || "").slice(0, 80),
    episodeCount: String(series.episodeCount || 0)
  };
  await drive("files/" + encodeURIComponent(folderId) + "?fields=id", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: `[${source.toUpperCase()}] ${series.title} (ID: ${idStr})`.slice(0, 500),
      appProperties
    })
  }).catch(() => {});
}

export async function ensureRoot() {
  if (rootFolder) return rootFolder;
  rootFolder = (await findFolder("PineDrama-Library")) || (await createFolder("PineDrama-Library", null, {
    description: "Thư mục gốc lưu trữ phim PineDrama & DramaBox Web Studio (Phân chia theo ID phim)"
  }));
  return rootFolder;
}

export async function ensureSeriesFolder(series) {
  const rawId = String(series?.id ?? series ?? "").trim();
  const idStr = rawId.includes(":") ? rawId.split(":").pop().trim() : rawId;
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(idStr)) throw Error("ID phim không hợp lệ");
  if (series?.folderId) {
    if (series?.title) await updateFolderMetadata(series.folderId, { ...series, id: idStr });
    return series.folderId;
  }
  const source = inferSourceById(idStr, series?.source || series?.platform);
  const parent = await ensureRoot();
  let folderId = await findFolder(idStr, parent);
  if (!folderId) {
    const extra = series?.title
      ? {
          description: `[${source.toUpperCase()}] ${series.title} (ID: ${idStr})`.slice(0, 500),
          appProperties: {
            collectionId: idStr.slice(0, 40),
            source: source.slice(0, 20),
            platform: source.slice(0, 20),
            title: String(series.title || "").slice(0, 80),
            episodeCount: String(series.episodeCount || 0)
          }
        }
      : { description: `Phim ${source.toUpperCase()} ID: ${idStr}` };
    folderId = await createFolder(idStr, parent, extra);
  } else if (series?.title) {
    await updateFolderMetadata(folderId, { ...series, id: idStr, source });
  }
  return folderId;
}

export function formatEpisodeFileName(episodeNumber) {
  const n = Number(episodeNumber);
  if (!Number.isInteger(n) || n < 1 || n > 5000) throw Error("Số tập không hợp lệ: " + episodeNumber);
  return "EP" + String(n).padStart(3, "0") + ".mp4";
}

export function parseEpisodeFileName(name) {
  const m = /^EP0*(\d+)\.mp4$/i.exec(String(name || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : null;
}

export function selectEpisodesForTransfer(episodes, options = {}) {
  if (!Array.isArray(episodes) || episodes.length === 0) {
    throw Error("Danh sách tập phim trống hoặc chưa được tải");
  }
  const sorted = [...episodes].sort((a, b) => Number(a.number) - Number(b.number));
  const maxEp = Number(sorted[sorted.length - 1].number) || sorted.length;
  const mode = options.mode || "all";
  if (mode === "all") {
    return sorted;
  }
  if (mode !== "range") {
    throw Error("Chế độ tải không hợp lệ (chỉ hỗ trợ 'all' hoặc 'range')");
  }
  const fromEp = Number(options.fromEpisode);
  const toEp = Number(options.toEpisode);
  if (!Number.isInteger(fromEp) || !Number.isInteger(toEp)) {
    throw Error("Số tập bắt đầu và kết thúc phải là số nguyên");
  }
  if (fromEp < 1 || toEp < 1 || fromEp > toEp || toEp > maxEp) {
    throw Error(`Khoảng tập phải nằm trong phạm vi từ 1 đến ${maxEp} (Từ tập <= Đến tập)`);
  }
  const selected = sorted.filter(ep => ep.number >= fromEp && ep.number <= toEp);
  if (!selected.length) {
    throw Error(`Không tìm thấy tập nào trong khoảng ${fromEp} - ${toEp}`);
  }
  return selected;
}

async function startUpload(name, mediaType, parent, size) {
  const response = await fetch(UPLOAD, {
    method: "POST",
    redirect: "error",
    headers: {
      ...auth(),
      "Content-Type": "application/json",
      "X-Upload-Content-Type": mediaType,
      "X-Upload-Content-Length": String(size)
    },
    body: JSON.stringify({ name: limitedName(name), parents: [parent] })
  });
  if (!response.ok) throw Error("Không mở được phiên Drive: " + response.status);
  const location = response.headers.get("Location");
  if (!location || !location.startsWith("https://www.googleapis.com/"))
    throw Error("Google Drive chưa cung cấp URL upload hợp lệ");
  return location;
}

function sendChunk(location, blob, from, to, total, mime) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", location);
    xhr.timeout = 120000;
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("Content-Range", "bytes " + from + "-" + to + "/" + total);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
    xhr.onerror = () => reject(Error("Mất kết nối với Google Drive"));
    xhr.ontimeout = () => reject(Error("Quá thời gian tải lên Drive"));
    xhr.send(blob);
  });
}

function uploadProgress(result, from, to, size) {
  if (result.status === 308) {
    const m = /^bytes=0-(\d+)$/.exec(result.range || "");
    const next = m ? Number(m[1]) + 1 : to + 1;
    if (next <= from || next > size) throw Error("Drive trả về vùng byte không hợp lệ");
    return { next, done: false };
  }
  if (result.status === 200 || result.status === 201) return { next: size, done: true };
  throw Error("Drive không nhận khối video (HTTP " + result.status + ")");
}

export async function uploadBlobToFolder(blob, folder, name, onProgress = () => {}) {
  if (!blob || !blob.size) throw Error("File rỗng");
  const mime = blob.type || "application/octet-stream";
  const session = await startUpload(name, mime, folder, blob.size);
  let offset = 0,
    last = null;
  while (offset < blob.size) {
    const end = Math.min(offset + CHUNK, blob.size) - 1;
    const result = await sendChunk(session, blob.slice(offset, end + 1, mime), offset, end, blob.size, mime);
    last = result;
    const parsed = uploadProgress(result, offset, end, blob.size);
    offset = parsed.next;
    onProgress(Math.round((offset / blob.size) * 100));
    if (parsed.done) break;
  }
  let meta = {};
  try {
    meta = JSON.parse(last?.body || "{}");
  } catch {}
  return meta;
}

export async function uploadToDrive(file, onProgress = () => {}) {
  return uploadBlobToFolder(file, await ensureRoot(), file.name, onProgress);
}

async function findExisting(name, parent) {
  const q = "name = '" + quote(name) + "' and trashed = false and '" + quote(parent) + "' in parents";
  const response = await drive("files?fields=files(id,name,size,modifiedTime,webViewLink)&q=" + encodeURIComponent(q));
  return response.files?.[0] || null;
}

async function listAllChildrenInFolder(folderId) {
  const all = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const q = "'" + quote(folderId) + "' in parents and trashed = false";
    const url =
      "files?fields=nextPageToken,files(id,name,size,mimeType,modifiedTime,webViewLink,description,appProperties)&pageSize=200&q=" +
      encodeURIComponent(q) +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const res = await drive(url);
    if (Array.isArray(res.files)) all.push(...res.files);
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return all;
}

async function readDriveJSONFile(fileId) {
  const response = await fetch(DRIVE + "files/" + encodeURIComponent(fileId) + "?alt=media", {
    headers: auth(),
    redirect: "error"
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export async function saveSeriesMetadata(series, episodes = [], uploadedEpisodeNumbers = null, existingFolderId = null) {
  const folder = existingFolderId || (await ensureSeriesFolder(series));
  const existingJson = await findExisting("movie.json", folder);
  let previousMeta = null;
  if (existingJson && (!series.title || uploadedEpisodeNumbers === null)) {
    previousMeta = await readDriveJSONFile(existingJson.id);
  }
  const uploaded = Array.isArray(uploadedEpisodeNumbers)
    ? [...new Set(uploadedEpisodeNumbers.map(Number).filter(n => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b)
    : Array.isArray(previousMeta?.uploadedEpisodes)
      ? previousMeta.uploadedEpisodes
      : [];

  const source = inferSourceById(series.id, series.source || series.platform || previousMeta?.source || previousMeta?.platform);
  const payload = {
    source,
    platform: source,
    collectionId: String(series.id),
    folderName: String(series.id),
    title: String(series.title || previousMeta?.title || "Phim #" + series.id),
    description: String(series.description ?? previousMeta?.description ?? ""),
    genres: series.genres || previousMeta?.genres || "",
    viewCount: series.viewCount ?? previousMeta?.viewCount ?? null,
    heatScore: series.heatScore ?? previousMeta?.heatScore ?? null,
    poster: series.poster || previousMeta?.poster || null,
    reportedEpisodeCount: series.episodeCount ?? (episodes.length || previousMeta?.reportedEpisodeCount || null),
    uploadedEpisodes: uploaded,
    uploadedCount: uploaded.length,
    episodes: episodes.length
      ? episodes.map(x => ({
          id: String(x.id ?? x.number),
          number: x.number,
          title: x.title || `Tập ${x.number}`,
          locked: Boolean(x.locked)
        }))
      : previousMeta?.episodes || [],
    importedAt: previousMeta?.importedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const jsonBytes = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  if (existingJson?.id) {
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(existingJson.id) + "?uploadType=media&fields=id,name",
      {
        method: "PATCH",
        headers: { ...auth(), "Content-Type": "application/json; charset=UTF-8" },
        body: jsonBytes
      }
    );
    if (res.ok) return await res.json().catch(() => ({ id: existingJson.id }));
  }
  return uploadBlobToFolder(jsonBytes, folder, "movie.json");
}

export async function inspectSeriesDriveFolder(seriesId) {
  const idStr = String(seriesId || "").trim();
  if (!/^[a-zA-Z0-9_-]{2,90}$/.test(idStr)) throw Error("ID phim không hợp lệ");
  const parent = await ensureRoot();
  let folderId = await findFolder(idStr, parent);
  if (!folderId) {
    // Check legacy DramaDownloader/<platform>/<idStr> path if present
    const legacyRoot = await findFolder("DramaDownloader", parent);
    if (legacyRoot) {
      const legacyPlatform = await findFolder("dramabox", legacyRoot);
      if (legacyPlatform) {
        folderId = await findFolder(idStr, legacyPlatform);
      }
    }
  }
  if (!folderId) {
    return {
      exists: false,
      id: idStr,
      folderId: null,
      folderUrl: null,
      uploadedEpisodes: [],
      uploadedFiles: [],
      movieMeta: null,
      totalSizeBytes: 0
    };
  }
  const files = await listAllChildrenInFolder(folderId);
  let movieJsonFile = null;
  let manifestJsonFile = null;
  const uploadedFiles = [];
  const epSet = new Set();
  let totalSizeBytes = 0;
  for (const f of files) {
    if (f.name === "movie.json") {
      movieJsonFile = f;
      continue;
    }
    if (f.name === "manifest.json") {
      manifestJsonFile = f;
      continue;
    }
    const epNum = parseEpisodeFileName(f.name);
    if (epNum !== null && Number(f.size || 0) > 0) {
      epSet.add(epNum);
      const sz = Number(f.size || 0);
      totalSizeBytes += sz;
      uploadedFiles.push({
        id: f.id,
        name: f.name,
        episode: epNum,
        size: sz,
        modifiedTime: f.modifiedTime || null,
        webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`
      });
    }
  }
  uploadedFiles.sort((a, b) => a.episode - b.episode);
  const uploadedEpisodes = [...epSet].sort((a, b) => a - b);
  const metaFile = movieJsonFile || manifestJsonFile;
  const movieMeta = metaFile ? await readDriveJSONFile(metaFile.id) : null;
  return {
    exists: true,
    id: idStr,
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    uploadedEpisodes,
    uploadedFiles,
    movieMeta,
    totalSizeBytes
  };
}

async function uploadEpisodeViaChunkProxy(series, episode, folderId, fileName, totalEpisodes, onProgress = () => {}) {
  const source = inferSourceById(series.id, series.source || series.platform);
  const proxyUrl =
    source === "dramabox"
      ? `/api/dramabox/series/${encodeURIComponent(series.id)}/episodes/${encodeURIComponent(episode.id || episode.number)}/stream`
      : `/api/series/${encodeURIComponent(series.id)}/episodes/${encodeURIComponent(episode.id)}/proxy?total=${encodeURIComponent(totalEpisodes)}`;
  const headRes = await fetch(proxyUrl, { method: "HEAD", credentials: "same-origin" });
  if (!headRes.ok) {
    const err = await headRes.json().catch(() => ({}));
    throw Error(err.error || "Không kiểm tra được luồng video (HTTP " + headRes.status + ")");
  }
  const length = Number(headRes.headers.get("Content-Length") || 0);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw Error("Không xác định được kích thước tập phim");
  }
  const session = await startUpload(fileName, "video/mp4", folderId, length);
  let offset = 0,
    last = null;
  while (offset < length) {
    const end = Math.min(length, offset + CHUNK) - 1;
    const partRes = await fetch(proxyUrl, {
      method: "GET",
      credentials: "same-origin",
      headers: { Range: `bytes=${offset}-${end}` }
    });
    if (partRes.status !== 206 && partRes.status !== 200) {
      throw Error("Lỗi đọc khối video từ proxy (HTTP " + partRes.status + ")");
    }
    const buf = await partRes.arrayBuffer();
    const blob = new Blob([buf], { type: "video/mp4" });
    last = await sendChunk(session, blob, offset, end, length, "video/mp4");
    offset = uploadProgress(last, offset, end, length).next;
    onProgress(Math.round((offset / length) * 100));
  }
  let meta = {};
  try {
    meta = JSON.parse(last?.body || "{}");
  } catch {}
  return { file: meta, size: length };
}

export async function uploadSingleEpisodeToDrive(series, episode, folderId, totalEpisodes, onProgress = () => {}) {
  auth();
  const fileName = formatEpisodeFileName(episode.number);
  const source = inferSourceById(series.id, series.source || series.platform);
  onProgress(10);
  const endpoint =
    source === "dramabox"
      ? `/api/dramabox/series/${encodeURIComponent(series.id)}/episodes/${encodeURIComponent(episode.id || episode.number)}/drive-upload`
      : `/api/series/${encodeURIComponent(series.id)}/episodes/${encodeURIComponent(episode.id)}/drive-upload?total=${encodeURIComponent(totalEpisodes)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folderId,
      fileName,
      accessToken: token,
      total: totalEpisodes,
      videoUrl: episode.url || episode.direct_url || null
    })
  });
  if (res.ok) {
    const data = await res.json();
    onProgress(100);
    return { file: data.file || {}, size: data.size || 0 };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const err = await res.json().catch(() => ({}));
    throw Error(err.error || "Không thể tải tập " + episode.number + " (HTTP " + res.status + ")");
  }
  // Fallback to chunked range proxy if single-shot transfer encountered a gateway/size limit
  return uploadEpisodeViaChunkProxy(series, episode, folderId, fileName, totalEpisodes, onProgress);
}

export async function fetchActiveTransferJobs(seriesId = null) {
  const qs = seriesId ? `?seriesId=${encodeURIComponent(seriesId)}` : "";
  const res = await fetch(`/api/transfer/jobs${qs}`, { credentials: "same-origin" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.jobs) ? data.jobs : [];
}

export async function cancelServerTransferJob(jobId) {
  const res = await fetch("/api/transfer/cancel", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: jobId })
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.job || null;
}

export async function attachToBackgroundTransferJob(jobId, options = {}, onStatus = () => {}) {
  const signal = options.signal || null;
  let lastJob = null;

  const abortListener = () => {
    cancelServerTransferJob(jobId).catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      await cancelServerTransferJob(jobId).catch(() => {});
      throw Error("Đã dừng tải theo yêu cầu người dùng");
    }
    signal.addEventListener("abort", abortListener, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) {
        throw Error("Đã dừng tải theo yêu cầu người dùng");
      }
      const res = await fetch(`/api/transfer/status?id=${encodeURIComponent(jobId)}`, {
        credentials: "same-origin"
      });
      if (!res.ok) {
        throw Error("Không đọc được trạng thái tiến trình tải ngầm trên server");
      }
      const data = await res.json();
      const job = data.job;
      if (!job) throw Error("Tiến trình tải không tồn tại");
      lastJob = job;

      onStatus({
        jobId: job.id,
        episode: job.currentEpisode || 1,
        index: job.currentIndex || 0,
        total: job.totalSelected || 1,
        percent: job.currentPercent || 0,
        phase: job.phase || job.status,
        folderId: job.folderId,
        folderUrl: job.folderUrl,
        uploadedEpisodes: job.uploadedEpisodes || [],
        background: true
      });

      if (job.status === "completed") {
        return {
          jobId: job.id,
          folderId: job.folderId,
          folderName: String(job.seriesId),
          folderUrl: job.folderUrl || (job.folderId ? `https://drive.google.com/drive/folders/${job.folderId}` : null),
          report: job.report || [],
          uploadedEpisodes: job.uploadedEpisodes || []
        };
      }
      if (job.status === "cancelled") {
        throw Error(job.error || "Đã dừng tải theo yêu cầu người dùng");
      }
      if (job.status === "failed") {
        throw Error(job.error || "Lỗi khi tải tập phim lên Google Drive");
      }

      await new Promise(r => setTimeout(r, 1200));
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

/**
 * Direct transfer of PineDrama or DramaBox series episodes into Google Drive folder PineDrama-Library/<series.id>/
 * Uses server-side detached background transfer (/api/transfer/start) by default so uploads continue even if
 * the user closes the browser tab or navigates away ("duy trì tải video lên driver khi thoát khỏi trang web").
 */
export async function uploadSeriesEpisodesToDrive(series, episodes, options = {}, onStatus = () => {}) {
  auth();
  const selected = selectEpisodesForTransfer(episodes, options);
  const skipExisting = options.skipExisting !== false;
  const signal = options.signal || null;
  const source = inferSourceById(series.id, series.source || series.platform);

  // Try starting detached server-side transfer job first so uploads survive tab/page exit
  if (options.useBackgroundServer !== false) {
    const startRes = await fetch("/api/transfer/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: token,
        source,
        series: {
          ...series,
          source,
          platform: source,
          episodeCount: series.episodeCount || episodes.length
        },
        episodes: episodes.map(ep => ({
          id: String(ep.id ?? ep.number),
          number: Number(ep.number),
          title: ep.title || `Tập ${ep.number}`,
          locked: Boolean(ep.locked),
          url: ep.url || ep.direct_url || null
        })),
        options: {
          mode: options.mode || "all",
          fromEpisode: options.fromEpisode,
          toEpisode: options.toEpisode,
          skipExisting
        }
      })
    }).catch(() => null);

    if (startRes && startRes.ok) {
      const startData = await startRes.json().catch(() => ({}));
      if (startData.job?.id) {
        return attachToBackgroundTransferJob(startData.job.id, { signal }, onStatus);
      }
    }
  }

  // Fallback to client-orchestrated upload if server background endpoint is unavailable
  const folderId = await ensureSeriesFolder(series);
  const existingChildren = await listAllChildrenInFolder(folderId);
  const existingMap = new Map();
  const uploadedSet = new Set();

  for (const f of existingChildren) {
    const epNum = parseEpisodeFileName(f.name);
    if (epNum !== null && Number(f.size || 0) > 0) {
      existingMap.set(epNum, f);
      uploadedSet.add(epNum);
    }
  }

  await saveSeriesMetadata(series, episodes, [...uploadedSet], folderId);

  const report = [];
  for (let index = 0; index < selected.length; index++) {
    if (signal?.aborted) {
      throw Error("Đã dừng tải theo yêu cầu người dùng");
    }
    const ep = selected[index];

    if (skipExisting && existingMap.has(ep.number)) {
      const ex = existingMap.get(ep.number);
      report.push({ episode: ep.number, fileId: ex.id, size: Number(ex.size || 0), skipped: true });
      onStatus({
        episode: ep.number,
        index,
        total: selected.length,
        percent: 100,
        phase: "existing",
        folderId
      });
      continue;
    }

    if (ep.locked) {
      throw Error(`Tập ${ep.number} đang bị khóa, không thể tải.`);
    }

    onStatus({
      episode: ep.number,
      index,
      total: selected.length,
      percent: 5,
      phase: "uploading",
      folderId
    });

    const uploaded = await uploadSingleEpisodeToDrive(
      series,
      ep,
      folderId,
      episodes.length,
      pct => {
        onStatus({
          episode: ep.number,
          index,
          total: selected.length,
          percent: pct,
          phase: "uploading",
          folderId
        });
      }
    );

    uploadedSet.add(ep.number);
    report.push({
      episode: ep.number,
      fileId: uploaded.file?.id || null,
      size: uploaded.size || 0,
      skipped: false
    });

    onStatus({
      episode: ep.number,
      index,
      total: selected.length,
      percent: 100,
      phase: "done",
      folderId
    });
  }

  await saveSeriesMetadata(series, episodes, [...uploadedSet], folderId);
  return {
    folderId,
    folderName: String(series.id),
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    report,
    uploadedEpisodes: [...uploadedSet].sort((a, b) => a - b)
  };
}

async function parseManagedDriveSeriesFolder(folder, forcedPlatform = null) {
  const children = await listAllChildrenInFolder(folder.id);
  let movieJsonFile = null;
  let manifestJsonFile = null;
  const uploadedFiles = [];
  const epSet = new Set();
  let totalSizeBytes = 0;
  let latestTime = folder.modifiedTime || folder.createdTime || null;

  for (const f of children) {
    if (f.modifiedTime && (!latestTime || f.modifiedTime > latestTime)) {
      latestTime = f.modifiedTime;
    }
    if (f.name === "movie.json") {
      movieJsonFile = f;
      continue;
    }
    if (f.name === "manifest.json") {
      manifestJsonFile = f;
      continue;
    }
    const epNum = parseEpisodeFileName(f.name);
    if (epNum !== null && Number(f.size || 0) > 0) {
      const sz = Number(f.size || 0);
      epSet.add(epNum);
      totalSizeBytes += sz;
      uploadedFiles.push({
        id: f.id,
        name: f.name,
        episode: epNum,
        size: sz,
        modifiedTime: f.modifiedTime || null,
        webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`
      });
    }
  }

  uploadedFiles.sort((a, b) => a.episode - b.episode);
  const uploadedEpisodes = [...epSet].sort((a, b) => a - b);
  const metaFile = movieJsonFile || manifestJsonFile;
  const meta = metaFile ? await readDriveJSONFile(metaFile.id) : null;
  const props = folder.appProperties || {};

  let rawId = String(meta?.collectionId || meta?.seriesId || props.collectionId || folder.name).trim();
  if (rawId.includes(":")) {
    rawId = rawId.split(":").pop().trim();
  }
  const source = inferSourceById(
    rawId,
    forcedPlatform || meta?.source || meta?.platform || props.source || props.platform
  );
  const episodeCount =
    Number(meta?.reportedEpisodeCount || meta?.episodeCount || props.episodeCount || 0) || null;
  const title =
    meta?.title ||
    props.title ||
    (folder.description
      ? folder.description
          .replace(/^DramaDownloader\s+[a-z0-9_-]+:[^\s·]+\s*·\s*/i, "")
          .replace(/\s*\(ID:\s*[^)]+\)\s*$/, "")
      : "") ||
    `Phim ID ${rawId}`;

  let nextMissingEpisode = 1;
  if (uploadedEpisodes.length > 0) {
    const maxCheck = episodeCount || uploadedEpisodes[uploadedEpisodes.length - 1] + 1;
    nextMissingEpisode = null;
    for (let ep = 1; ep <= maxCheck; ep++) {
      if (!epSet.has(ep)) {
        nextMissingEpisode = ep;
        break;
      }
    }
  }

  return {
    id: rawId,
    source,
    platform: source,
    folderName: folder.name,
    folderId: folder.id,
    folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
    title,
    description: meta?.description || "",
    genres: meta?.genres || "",
    poster: meta?.poster || null,
    viewCount: meta?.viewCount ?? null,
    heatScore: meta?.heatScore ?? null,
    episodeCount,
    uploadedEpisodes,
    uploadedCount: uploadedEpisodes.length,
    uploadedFiles,
    totalSizeBytes,
    nextMissingEpisode,
    isComplete: Boolean(episodeCount && uploadedEpisodes.length >= episodeCount),
    updatedAt: meta?.updatedAt || latestTime
  };
}

export async function listManagedSeriesOnDrive(onProgress = () => {}) {
  const parent = await ensureRoot();
  const q = [
    "'" + quote(parent) + "' in parents",
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false"
  ].join(" and ");
  const res = await drive(
    "files?fields=nextPageToken,files(id,name,description,appProperties,createdTime,modifiedTime)&pageSize=100&orderBy=modifiedTime desc&q=" +
      encodeURIComponent(q)
  );
  const topFolders = res.files || [];
  const itemsById = new Map();

  for (let i = 0; i < topFolders.length; i++) {
    const folder = topFolders[i];
    onProgress({ current: i + 1, total: topFolders.length, folderName: folder.name });

    // If this is the legacy "DramaDownloader" container folder, scan inside it for <platform>/<seriesId>
    if (folder.name === "DramaDownloader") {
      const platQ = [
        "'" + quote(folder.id) + "' in parents",
        "mimeType = 'application/vnd.google-apps.folder'",
        "trashed = false"
      ].join(" and ");
      const platRes = await drive(
        "files?fields=files(id,name,description,appProperties,createdTime,modifiedTime)&pageSize=50&q=" +
          encodeURIComponent(platQ)
      ).catch(() => ({ files: [] }));
      for (const platFolder of platRes.files || []) {
        const seriesQ = [
          "'" + quote(platFolder.id) + "' in parents",
          "mimeType = 'application/vnd.google-apps.folder'",
          "trashed = false"
        ].join(" and ");
        const seriesRes = await drive(
          "files?fields=files(id,name,description,appProperties,createdTime,modifiedTime)&pageSize=100&orderBy=modifiedTime desc&q=" +
            encodeURIComponent(seriesQ)
        ).catch(() => ({ files: [] }));
        for (const sFolder of seriesRes.files || []) {
          const parsed = await parseManagedDriveSeriesFolder(sFolder, platFolder.name);
          if (!itemsById.has(parsed.id) || parsed.uploadedCount > itemsById.get(parsed.id).uploadedCount) {
            itemsById.set(parsed.id, parsed);
          }
        }
      }
      continue;
    }

    const parsed = await parseManagedDriveSeriesFolder(folder);
    if (!itemsById.has(parsed.id) || parsed.uploadedCount > itemsById.get(parsed.id).uploadedCount) {
      itemsById.set(parsed.id, parsed);
    }
  }

  return [...itemsById.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function deleteDriveFileOrFolder(fileId) {
  if (!fileId) throw Error("Thiếu ID tệp/thư mục trên Drive");
  return drive("files/" + encodeURIComponent(fileId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true })
  });
}

// Keep licensed manifest validator & uploader for backward compatibility with existing tests
function safeRemoteMP4(raw) {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !url.hostname ||
      /^(localhost|.*\.local|127\..*|0\..*|10\..*|192\.168\..*|172\.(1[6-9]|2[0-9]|3[0-1])\..*)$/i.test(url.hostname)
    )
      throw Error("URL không công khai hoặc không dùng HTTPS");
    if (url.pathname.toLowerCase().endsWith(".m3u8")) throw Error("HLS không phải file MP4 tải trực tiếp");
    return url.href;
  } catch (e) {
    throw Error("URL MP4 được cấp phép không hợp lệ: " + e.message);
  }
}

export function validateLicensedManifest(rows, expected) {
  if (!Array.isArray(rows) || rows.length !== expected || !Number.isInteger(expected) || expected < 1 || expected > 5000)
    throw Error("Manifest phải chứa đúng " + expected + " tập phim");
  const ids = new Set();
  const normalized = rows
    .map(row => {
      const ep = Number(row.episode);
      if (!Number.isInteger(ep) || ep < 1 || ep > expected || ids.has(ep))
        throw Error("Số tập thiếu hoặc bị trùng");
      ids.add(ep);
      return { episode: ep, url: safeRemoteMP4(row.url) };
    })
    .sort((a, b) => a.episode - b.episode);
  return normalized;
}

async function inspectRemoteMP4(url) {
  let res;
  try {
    res = await fetch(url, { method: "HEAD", mode: "cors", redirect: "error", signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw Error("Nguồn không cho phép đọc từ trình duyệt (CORS/HEAD): " + e.message);
  }
  if (!res.ok) throw Error("Nguồn video từ chối HEAD: HTTP " + res.status);
  const length = Number(res.headers.get("Content-Length"));
  const type = res.headers.get("Content-Type") || "";
  if (!Number.isSafeInteger(length) || length <= 0)
    throw Error("Nguồn không cung cấp Content-Length, chưa thể chuyển tiếp chính xác");
  if (!/video\/mp4|application\/octet-stream/i.test(type) && !new URL(url).pathname.toLowerCase().endsWith(".mp4"))
    throw Error("Nguồn không phải file MP4 trực tiếp");
  return { length, mime: "video/mp4", ranges: /bytes/i.test(res.headers.get("Accept-Ranges") || "") };
}

async function remotePart(url, start, end, total) {
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      mode: "cors",
      redirect: "error",
      headers: { Range: "bytes=" + start + "-" + end },
      signal: AbortSignal.timeout(120000)
    });
  } catch (e) {
    throw Error("Không thể đọc video qua CORS từ nguồn: " + e.message);
  }
  if (res.status !== 206 && !(start === 0 && end === total - 1 && res.status === 200)) {
    res.body?.cancel().catch(() => {});
    throw Error("Nguồn không trả byte-range đúng (HTTP " + res.status + ")");
  }
  const announced = Number(res.headers.get("Content-Length") || 0);
  if (announced > CHUNK) {
    res.body?.cancel().catch(() => {});
    throw Error("Nguồn trả khối lớn hơn giới hạn");
  }
  const data = await res.arrayBuffer();
  if (data.byteLength !== end - start + 1) throw Error("Nguồn trả sai số byte");
  return new Blob([data], { type: "video/mp4" });
}

export async function uploadLicensedSeries(series, manifest, onStatus = () => {}) {
  const normalized = validateLicensedManifest(manifest, Number(series.episodeCount));
  const folder = await ensureSeriesFolder(series);
  const report = [];
  for (let index = 0; index < normalized.length; index++) {
    const item = normalized[index],
      name = formatEpisodeFileName(item.episode);
    onStatus({ episode: item.episode, index, total: normalized.length, percent: 0, phase: "checking" });
    const info = await inspectRemoteMP4(item.url);
    const existing = await findExisting(name, folder);
    if (existing) {
      if (Number(existing.size) !== info.length)
        throw Error(name + " tồn tại trên Drive nhưng kích thước khác; hãy kiểm tra trước khi tiếp tục");
      report.push({ episode: item.episode, fileId: existing.id, skipped: true });
      onStatus({ episode: item.episode, index, total: normalized.length, percent: 100, phase: "existing" });
      continue;
    }
    const session = await startUpload(name, info.mime, folder, info.length);
    let offset = 0,
      last = null;
    while (offset < info.length) {
      const end = Math.min(info.length, offset + CHUNK) - 1;
      const blob = await remotePart(item.url, offset, end, info.length);
      last = await sendChunk(session, blob, offset, end, info.length, info.mime);
      offset = uploadProgress(last, offset, end, info.length).next;
      onStatus({
        episode: item.episode,
        index,
        total: normalized.length,
        percent: Math.round((offset / info.length) * 100),
        phase: "uploading"
      });
    }
    let meta = {};
    try {
      meta = JSON.parse(last?.body || "{}");
    } catch {}
    report.push({ episode: item.episode, fileId: meta.id || null, size: info.length });
    onStatus({ episode: item.episode, index, total: normalized.length, percent: 100, phase: "done" });
  }
  await saveSeriesMetadata(series);
  return report;
}

// Unified Drive folder layout: DramaDownloader / DramaBox imports are now stored directly
// under PineDrama-Library/<series.id> with movie.json so Manager syncs all sources seamlessly!
export async function ensureDownloaderImportFolder(series) {
  auth();
  const platform = String(series?.platform || series?.source || "dramabox").toLowerCase();
  const key = String(series?.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{2,90}$/.test(key)) {
    throw Error("Series ID không hợp lệ");
  }
  return ensureSeriesFolder({
    id: key,
    source: platform,
    platform,
    title: series?.title || `Phim #${key}`,
    episodeCount: series?.episodeCount || (Array.isArray(series?.episodes) ? series.episodes.length : 0)
  });
}

export async function uploadDownloaderLocalMP4(folder, number, file, onProgress = () => {}) {
  auth();
  if (!(file instanceof Blob) || !file.size) throw Error("Bạn chưa chọn file MP4");
  if (!/\.mp4$/i.test(file.name || "") || !["", "video/mp4", "application/octet-stream"].includes(file.type))
    throw Error("Chỉ hỗ trợ file MP4 được phép tải lên");
  const name = formatEpisodeFileName(number);
  const exists = await findExisting(name, folder);
  if (exists) {
    if (Number(exists.size) !== file.size) throw Error(name + " đã tồn tại nhưng kích thước khác; kiểm tra Drive trước");
    return { skipped: true, id: exists.id, size: file.size };
  }
  const meta = await uploadBlobToFolder(file, folder, name, onProgress);
  return { skipped: false, id: meta.id || null, size: file.size };
}

export async function uploadDownloaderRemoteMP4(folder, number, rawUrl, onProgress = () => {}) {
  auth();
  const source = safeRemoteMP4(rawUrl);
  const info = await inspectRemoteMP4(source);
  const name = formatEpisodeFileName(number);
  const existing = await findExisting(name, folder);
  if (existing) {
    if (Number(existing.size) !== info.length) throw Error(name + " đã tồn tại nhưng khác kích thước; kiểm tra Drive trước");
    return { skipped: true, id: existing.id, size: info.length };
  }
  const session = await startUpload(name, "video/mp4", folder, info.length);
  let last = null;
  if (!info.ranges) {
    const response = await fetch(source, { method: "GET", mode: "cors", redirect: "error", cache: "no-store" });
    if (response.status !== 200 || !response.body) throw Error("Nguồn không trả MP4 qua GET: HTTP " + response.status);
    const contentSize = Number(response.headers.get("Content-Length") || 0);
    if (contentSize && contentSize !== info.length) throw Error("GET và HEAD trả kích thước khác nhau");
    await pumpMP4Stream(
      response.body,
      info.length,
      CHUNK,
      async (bytes, from, to, total) => {
        last = await sendChunk(session, new Blob([bytes], { type: "video/mp4" }), from, to, total, "video/mp4");
        const result = uploadProgress(last, from, to, total);
        if (result.next !== to + 1) throw Error("Google Drive xác nhận chunk không khớp");
      },
      onProgress
    );
  } else {
    let offset = 0;
    while (offset < info.length) {
      const end = Math.min(offset + CHUNK, info.length) - 1;
      const part = await remotePart(source, offset, end, info.length);
      last = await sendChunk(session, part, offset, end, info.length, "video/mp4");
      offset = uploadProgress(last, offset, end, info.length).next;
      onProgress(Math.round((offset / info.length) * 100));
    }
  }
  let result = {};
  try {
    result = JSON.parse(last?.body || "{}");
  } catch {}
  return { skipped: false, id: result.id || null, size: info.length, method: info.ranges ? "range" : "stream" };
}

export async function saveDownloaderImportMetadata(folder, series, uploadedNumbers = []) {
  auth();
  const platform = String(series?.platform || series?.source || "dramabox").toLowerCase();
  return saveSeriesMetadata(
    {
      id: String(series.id),
      source: platform,
      platform,
      title: series.title,
      description: series.description || "",
      genres: series.genres || "",
      poster: series.poster || null,
      episodeCount: series.episodeCount || (Array.isArray(series.episodes) ? series.episodes.length : null)
    },
    Array.isArray(series.episodes)
      ? series.episodes.map(e => ({
          id: String(e.id ?? e.number),
          number: Number(e.number),
          title: e.title || `Tập ${e.number}`,
          locked: Boolean(e.locked)
        }))
      : [],
    uploadedNumbers,
    folder
  );
}
