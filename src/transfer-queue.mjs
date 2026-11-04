// Server-side background Google Drive transfer manager.
// Continues uploading episodes to Google Drive even when the user closes or leaves the web page.

const DRIVE_API = "https://www.googleapis.com/drive/v3/";
const DRIVE_UPLOAD =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,parents,webViewLink";
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB (multiple of 256 KiB required by Google Drive)

const jobs = new Map();

function quoteDrive(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function formatEpisodeName(epNum) {
  const n = Number(epNum);
  if (!Number.isInteger(n) || n < 1 || n > 5000) throw Error("Số tập không hợp lệ: " + epNum);
  return "EP" + String(n).padStart(3, "0") + ".mp4";
}

export function parseEpisodeName(name) {
  const m = /^EP0*(\d+)\.mp4$/i.exec(String(name || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : null;
}

async function driveRequest(accessToken, path, options = {}) {
  const res = await fetch(DRIVE_API + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + accessToken,
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(30000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Error(body?.error?.message || `Google Drive HTTP ${res.status}`);
  }
  return body;
}

async function findDriveFolder(accessToken, name, parent = null) {
  const q = [
    `name = '${quoteDrive(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    ...(parent ? [`'${quoteDrive(parent)}' in parents`] : [])
  ].join(" and ");
  const res = await driveRequest(
    accessToken,
    `files?fields=files(id,name,description,appProperties)&pageSize=50&q=${encodeURIComponent(q)}`
  );
  return res.files?.[0]?.id || null;
}

async function createDriveFolder(accessToken, name, parent = null, extra = {}) {
  const res = await driveRequest(accessToken, "files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
      ...extra
    })
  });
  return res.id;
}

export async function ensureDriveSeriesFolder(accessToken, series) {
  const idStr = String(series?.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(idStr)) throw Error("ID phim không hợp lệ");

  const rootId =
    (await findDriveFolder(accessToken, "PineDrama-Library")) ||
    (await createDriveFolder(accessToken, "PineDrama-Library", null, {
      description: "Thư mục gốc lưu trữ phim PineDrama & DramaBox (Phân chia theo ID phim)"
    }));

  const source = String(series?.source || series?.platform || "pinedrama").toLowerCase();
  const appProperties = {
    collectionId: idStr.slice(0, 40),
    source: source.slice(0, 20),
    platform: source.slice(0, 20),
    title: String(series?.title || "").slice(0, 80),
    episodeCount: String(series?.episodeCount || 0)
  };
  const description = `[${source.toUpperCase()}] ${series?.title || "Phim"} (ID: ${idStr})`.slice(0, 500);

  let folderId = await findDriveFolder(accessToken, idStr, rootId);
  if (!folderId) {
    folderId = await createDriveFolder(accessToken, idStr, rootId, {
      description,
      appProperties
    });
  } else if (series?.title) {
    await driveRequest(accessToken, `files/${encodeURIComponent(folderId)}?fields=id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, appProperties })
    }).catch(() => {});
  }
  return { rootId, folderId };
}

async function listFolderChildren(accessToken, folderId) {
  const all = [];
  let pageToken = "";
  for (let p = 0; p < 10; p++) {
    const q = `'${quoteDrive(folderId)}' in parents and trashed = false`;
    const url =
      `files?fields=nextPageToken,files(id,name,size,mimeType,modifiedTime,webViewLink)&pageSize=200&q=${encodeURIComponent(
        q
      )}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await driveRequest(accessToken, url);
    if (Array.isArray(res.files)) all.push(...res.files);
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return all;
}

async function readDriveJson(accessToken, fileId) {
  const res = await fetch(`${DRIVE_API}files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function writeDriveMovieJson(accessToken, folderId, series, episodes, uploadedNumbers, existingJsonFile = null) {
  let previousMeta = null;
  if (existingJsonFile?.id) {
    previousMeta = await readDriveJson(accessToken, existingJsonFile.id);
  }
  const source = String(series?.source || series?.platform || previousMeta?.source || "pinedrama").toLowerCase();
  const uploaded = [...new Set((uploadedNumbers || []).map(Number).filter(n => Number.isInteger(n) && n >= 1))].sort(
    (a, b) => a - b
  );

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
    reportedEpisodeCount: series.episodeCount ?? (episodes?.length || previousMeta?.reportedEpisodeCount || null),
    uploadedEpisodes: uploaded,
    uploadedCount: uploaded.length,
    episodes: Array.isArray(episodes) && episodes.length
      ? episodes.map(x => ({
          id: String(x.id ?? x.number),
          number: Number(x.number ?? x.num),
          title: String(x.title || "Tập " + (x.number ?? x.num)),
          locked: Boolean(x.locked)
        }))
      : previousMeta?.episodes || [],
    importedAt: previousMeta?.importedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const jsonBytes = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  if (existingJsonFile?.id) {
    const patchRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingJsonFile.id
      )}?uploadType=media&fields=id,name`,
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: jsonBytes,
        signal: AbortSignal.timeout(25000)
      }
    );
    if (patchRes.ok) return await patchRes.json().catch(() => ({ id: existingJsonFile.id }));
  }

  const initRes = await fetch(DRIVE_UPLOAD, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/json",
      "X-Upload-Content-Length": String(jsonBytes.byteLength)
    },
    body: JSON.stringify({ name: "movie.json", parents: [folderId] }),
    signal: AbortSignal.timeout(25000)
  });
  if (!initRes.ok) throw Error(`Không tạo được movie.json trên Drive (HTTP ${initRes.status})`);
  const location = initRes.headers.get("Location");
  const putRes = await fetch(location, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(jsonBytes.byteLength)
    },
    body: jsonBytes,
    signal: AbortSignal.timeout(25000)
  });
  if (!putRes.ok) throw Error(`Không ghi được movie.json (HTTP ${putRes.status})`);
  return putRes.json().catch(() => ({}));
}

export async function streamRemoteMP4ToDrive({
  videoUrl,
  userAgent = "PineDrama/466003 CFNetwork/Darwin",
  folderId,
  fileName,
  accessToken,
  onProgress = () => {},
  signal = null
}) {
  const upstream = await fetch(videoUrl, {
    method: "GET",
    headers: { "User-Agent": userAgent },
    signal: signal || AbortSignal.timeout(180000)
  });
  if (!upstream.ok || !upstream.body) {
    throw Error(`Không tải được luồng video từ CDN (HTTP ${upstream.status})`);
  }

  const declaredLength = Number(upstream.headers.get("content-length") || 0);

  // If Content-Length is known and > CHUNK_SIZE, stream in 8 MiB resumable chunks without buffering whole file
  if (declaredLength > CHUNK_SIZE) {
    const initRes = await fetch(DRIVE_UPLOAD, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(declaredLength)
      },
      body: JSON.stringify({ name: fileName, parents: [folderId] }),
      signal: signal || AbortSignal.timeout(30000)
    });
    if (!initRes.ok) {
      const errBody = await initRes.json().catch(() => ({}));
      throw Error(errBody?.error?.message || `Google Drive từ chối mở phiên tải lên (HTTP ${initRes.status})`);
    }
    const location = initRes.headers.get("Location");
    if (!location) throw Error("Google Drive không trả về URL phiên resumable");

    const reader = upstream.body.getReader();
    let pending = Buffer.alloc(0);
    let offset = 0;
    let lastMeta = {};

    const flushPart = async chunkBuf => {
      const start = offset;
      const end = offset + chunkBuf.byteLength - 1;
      const putRes = await fetch(location, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunkBuf.byteLength),
          "Content-Range": `bytes ${start}-${end}/${declaredLength}`
        },
        body: chunkBuf,
        signal: signal || AbortSignal.timeout(120000)
      });
      if (putRes.status !== 308 && putRes.status !== 200 && putRes.status !== 201) {
        const txt = await putRes.text().catch(() => "");
        throw Error(`Google Drive lỗi ghi chunk (HTTP ${putRes.status}): ${txt.slice(0, 120)}`);
      }
      if (putRes.status === 200 || putRes.status === 201) {
        lastMeta = await putRes.json().catch(() => ({}));
      }
      offset += chunkBuf.byteLength;
      onProgress(Math.min(99, Math.round((offset / declaredLength) * 100)));
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending = Buffer.concat([pending, Buffer.from(value)]);
        while (pending.byteLength >= CHUNK_SIZE) {
          const slice = pending.subarray(0, CHUNK_SIZE);
          pending = pending.subarray(CHUNK_SIZE);
          await flushPart(slice);
        }
      }
      if (pending.byteLength > 0) {
        await flushPart(pending);
      }
    } finally {
      reader.releaseLock();
    }

    onProgress(100);
    return { size: declaredLength, file: lastMeta };
  }

  // Standard single-shot upload for smaller files or when Content-Length is not announced upfront
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 250 * 1024 * 1024) {
    throw Error(`Kích thước video không hợp lệ (${bytes.byteLength} bytes)`);
  }
  onProgress(40);

  const initRes = await fetch(DRIVE_UPLOAD, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(bytes.byteLength)
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
    signal: signal || AbortSignal.timeout(30000)
  });
  if (!initRes.ok) {
    const errBody = await initRes.json().catch(() => ({}));
    throw Error(errBody?.error?.message || `Google Drive từ chối mở phiên tải lên (HTTP ${initRes.status})`);
  }
  const location = initRes.headers.get("Location");
  if (!location) throw Error("Google Drive không trả về URL phiên resumable");

  const putRes = await fetch(location, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.byteLength)
    },
    body: bytes,
    signal: signal || AbortSignal.timeout(150000)
  });
  if (putRes.status !== 200 && putRes.status !== 201) {
    const errText = await putRes.text().catch(() => "");
    throw Error(`Google Drive lỗi khi ghi video (HTTP ${putRes.status}): ${errText.slice(0, 120)}`);
  }
  const meta = await putRes.json().catch(() => ({}));
  onProgress(100);
  return { size: bytes.byteLength, file: meta };
}

function sanitizeJobView(job) {
  return {
    jobId: job.jobId,
    seriesId: job.series.id,
    source: job.series.source || "pinedrama",
    title: job.series.title,
    poster: job.series.poster || null,
    folderId: job.folderId,
    folderUrl: job.folderId ? `https://drive.google.com/drive/folders/${job.folderId}` : null,
    status: job.status,
    phase: job.phase,
    currentEpisode: job.currentEpisode,
    currentIndex: job.currentIndex,
    totalSelected: job.totalSelected,
    episodePercent: job.episodePercent,
    overallPercent: job.overallPercent,
    uploadedEpisodes: [...job.uploadedSet].sort((a, b) => a - b),
    newlyUploadedCount: job.newlyUploadedCount,
    skippedCount: job.skippedCount,
    message: job.message,
    error: job.error || null,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt
  };
}

export function getTransferJob(jobId) {
  const job = jobs.get(String(jobId || ""));
  return job ? sanitizeJobView(job) : null;
}

export function listTransferJobs() {
  const out = [];
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.status !== "running" && now - job.updatedAtMs > 3600000) {
      jobs.delete(id);
      continue;
    }
    out.push(sanitizeJobView(job));
  }
  return out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function cancelTransferJob(jobId) {
  const job = jobs.get(String(jobId || ""));
  if (!job) return null;
  if (job.status === "running") {
    job.aborted = true;
    job.abortController?.abort();
    job.status = "cancelled";
    job.message = `Đã dừng tải theo yêu cầu. Các tập đã tải xong (${job.uploadedSet.size} tập) được giữ nguyên trên Drive.`;
    job.updatedAt = new Date().toISOString();
    job.updatedAtMs = Date.now();
  }
  return sanitizeJobView(job);
}

export function startBackgroundTransfer({
  series,
  episodes,
  selectedEpisodes,
  skipExisting = true,
  accessToken,
  resolveStreamUrl
}) {
  const seriesId = String(series?.id || "").trim();
  const source = String(series?.source || series?.platform || "pinedrama").toLowerCase();

  // Check if there is already a running job for this series
  for (const existing of jobs.values()) {
    if (existing.series.id === seriesId && existing.status === "running") {
      return sanitizeJobView(existing);
    }
  }

  const jobId = `job_${source}_${seriesId}_${Date.now()}`;
  const abortController = new AbortController();
  const job = {
    jobId,
    series: { ...series, id: seriesId, source, platform: source },
    allEpisodes: episodes,
    selectedEpisodes,
    skipExisting: skipExisting !== false,
    accessToken,
    resolveStreamUrl,
    abortController,
    aborted: false,
    folderId: null,
    status: "running",
    phase: "preparing",
    currentEpisode: selectedEpisodes[0]?.number || 1,
    currentIndex: 0,
    totalSelected: selectedEpisodes.length,
    episodePercent: 0,
    overallPercent: 0,
    uploadedSet: new Set(),
    newlyUploadedCount: 0,
    skippedCount: 0,
    report: [],
    message: `Đang khởi tạo thư mục Google Drive PineDrama-Library/${seriesId}...`,
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now()
  };

  jobs.set(jobId, job);

  // Launch detached background execution that continues even after HTTP response closes
  void runTransferJobLoop(job);

  return sanitizeJobView(job);
}

async function runTransferJobLoop(job) {
  const touch = msg => {
    if (msg) job.message = msg;
    job.updatedAt = new Date().toISOString();
    job.updatedAtMs = Date.now();
  };

  try {
    const { folderId } = await ensureDriveSeriesFolder(job.accessToken, job.series);
    job.folderId = folderId;

    const children = await listFolderChildren(job.accessToken, folderId);
    let movieJsonFile = null;
    const existingMap = new Map();

    for (const f of children) {
      if (f.name === "movie.json") {
        movieJsonFile = f;
        continue;
      }
      const epNum = parseEpisodeName(f.name);
      if (epNum !== null && Number(f.size || 0) > 0) {
        existingMap.set(epNum, f);
        job.uploadedSet.add(epNum);
      }
    }

    movieJsonFile = await writeDriveMovieJson(
      job.accessToken,
      folderId,
      job.series,
      job.allEpisodes,
      [...job.uploadedSet],
      movieJsonFile
    );

    const total = job.selectedEpisodes.length;
    for (let i = 0; i < total; i++) {
      if (job.aborted) break;
      const ep = job.selectedEpisodes[i];
      const epNum = Number(ep.number ?? ep.num);
      const fileName = formatEpisodeName(epNum);

      job.currentIndex = i;
      job.currentEpisode = epNum;
      job.episodePercent = 0;
      job.overallPercent = Math.round((i / total) * 100);

      if (job.skipExisting && existingMap.has(epNum)) {
        const ex = existingMap.get(epNum);
        job.skippedCount++;
        job.uploadedSet.add(epNum);
        job.report.push({ episode: epNum, fileId: ex.id, size: Number(ex.size || 0), skipped: true });
        job.phase = "existing";
        job.episodePercent = 100;
        job.overallPercent = Math.round(((i + 1) / total) * 100);
        touch(`[${i + 1}/${total}] Tập ${epNum} (${fileName}): đã có sẵn trên Drive (bỏ qua)`);
        continue;
      }

      job.phase = "uploading";
      touch(`[${i + 1}/${total}] Tập ${epNum} (${fileName}): đang lấy luồng video...`);

      const streamInfo = await job.resolveStreamUrl(ep);
      if (!streamInfo?.url) {
        throw Error(`Tập ${epNum} không có URL MP4 khả dụng để tải lên Drive`);
      }

      const uploaded = await streamRemoteMP4ToDrive({
        videoUrl: streamInfo.url,
        userAgent: streamInfo.userAgent || "okhttp/4.10.0",
        folderId,
        fileName,
        accessToken: job.accessToken,
        signal: job.abortController.signal,
        onProgress: pct => {
          job.episodePercent = pct;
          job.overallPercent = Math.min(99, Math.round(((i + pct / 100) / total) * 100));
          touch(`[${i + 1}/${total}] Tập ${epNum} (${fileName}): đang tải ngầm lên Drive (${pct}%)`);
        }
      });

      job.newlyUploadedCount++;
      job.uploadedSet.add(epNum);
      job.report.push({
        episode: epNum,
        fileId: uploaded.file?.id || null,
        size: uploaded.size || 0,
        skipped: false
      });

      // Persist updated movie.json after each uploaded episode so Drive Manager is always in sync
      await writeDriveMovieJson(
        job.accessToken,
        folderId,
        job.series,
        job.allEpisodes,
        [...job.uploadedSet],
        movieJsonFile
      ).catch(() => {});

      job.phase = "done";
      job.episodePercent = 100;
      job.overallPercent = Math.round(((i + 1) / total) * 100);
      touch(`[${i + 1}/${total}] Tập ${epNum} (${fileName}): đã tải xong lên Drive ✓`);
    }

    if (job.aborted) {
      job.status = "cancelled";
      touch(
        `Đã dừng tải. Đã tải mới ${job.newlyUploadedCount} tập, bỏ qua ${job.skippedCount} tập (Lưu tại PineDrama-Library/${job.series.id}).`
      );
      return;
    }

    job.status = "completed";
    job.overallPercent = 100;
    touch(
      `Hoàn tất! Đã tải mới ${job.newlyUploadedCount} tập, bỏ qua ${job.skippedCount} tập đã có. Lưu tại: PineDrama-Library/${job.series.id}`
    );
  } catch (err) {
    if (job.aborted) {
      job.status = "cancelled";
      return;
    }
    job.status = "error";
    job.error = String(err?.message || err);
    touch(
      `Tạm dừng / Lỗi tải tại Tập ${job.currentEpisode}: ${job.error} (Các tập đã tải xong được giữ nguyên trên Drive).`
    );
  }
}
