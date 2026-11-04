import {
  driveConnected,
  connectDrive,
  inferSourceById,
  saveSeriesMetadata,
  inspectSeriesDriveFolder,
  uploadSeriesEpisodesToDrive,
  selectEpisodesForTransfer,
  fetchActiveTransferJobs,
  attachToBackgroundTransferJob
} from "./drive-transfer.js";

const el = (tag, cls = "", text = null) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== null) node.textContent = text;
  return node;
};
const btn = (text, cls = "") => el("button", cls, text);
const num = n => (n == null ? "Chưa có" : Number(n).toLocaleString("vi-VN"));
const viewCount = n => (n == null ? "Chưa có dữ liệu lượt xem" : num(n) + " lượt xem qua API");
const formatBytes = bytes => {
  const b = Number(bytes || 0);
  if (!b || b <= 0) return "0 MB";
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
};

function validPoster(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

function portraitPoster(movie) {
  const box = el("div", "detail-poster");
  const url = validPoster(movie.poster);
  if (url) {
    const img = el("img");
    img.src = url;
    img.alt = movie.title || "Poster";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    box.append(img);
  } else {
    box.textContent = "🎬";
  }
  return box;
}

export async function openMovieDetail(
  movie,
  { api, clientID, container, onDriveUpdated, onOpenManager, onBack }
) {
  container.classList.remove("hidden");
  container.replaceChildren();

  const source = inferSourceById(movie.id, movie.source || movie.platform);
  movie.source = source;
  movie.platform = source;
  const isDramaBox = source === "dramabox";
  const providerLabel = isDramaBox ? "DramaBox (DramaDownloader)" : "PineDrama";

  const heading = el("div", "detail-top");
  const close = btn(`← Quay lại ${isDramaBox ? "DramaDownloader" : "kho phim"}`, "detail-back");
  close.onclick = () => {
    container.replaceChildren();
    container.classList.add("hidden");
    if (typeof onBack === "function") {
      onBack();
      return;
    }
    const targetSection = isDramaBox ? "#dramadownloader" : "#catalog";
    document.querySelector(targetSection)?.classList.remove("hidden");
  };
  heading.append(close);

  if (typeof onOpenManager === "function") {
    const goManager = btn("Mở tab Manager (Drive)", "detail-secondary");
    goManager.onclick = () => onOpenManager(movie.id);
    heading.append(goManager);
  }

  const layout = el("div", "detail-layout");
  const posterBox = portraitPoster(movie);
  const info = el("div", "detail-info");
  info.append(el("span", "detail-kicker", `${providerLabel} · Quản lý & Tải ngầm lên Google Drive`));
  const titleNode = el("h2", "detail-title", movie.title || "Phim #" + movie.id);
  info.append(titleNode);
  const epCountTag = el("p", "detail-tag", String(movie.episodeCount ?? "Đang kiểm tra") + " tập");
  info.append(epCountTag);

  const description = el(
    "p",
    "notice",
    movie.description || `${providerLabel} chưa cung cấp mô tả trong phản hồi danh mục này.`
  );
  const genres = el("p", "detail-muted", movie.genres || "Chưa có danh mục thể loại");
  const views = el("p", "detail-views", viewCount(movie.viewCount));
  const heat =
    movie.heatScore == null
      ? null
      : el("p", "detail-heat", "🔥 Điểm độ hot API: " + Number(movie.heatScore).toLocaleString("vi-VN"));
  const meta = el("p", "detail-id", `Series ID (Tên thư mục Drive): ${movie.id} · Nguồn: ${providerLabel}`);
  const folderPathNote = el(
    "p",
    "detail-muted",
    `Đường dẫn lưu đồng bộ trên Google Drive: PineDrama-Library/${movie.id}/ (movie.json, EP001.mp4, EP002.mp4...)`
  );

  const actionRow = el("div", "detail-actions");
  const saveInfo = btn("Lưu metadata (movie.json)", "detail-secondary");
  const checkDriveBtn = btn("Kiểm tra thư mục trên Drive", "detail-secondary");
  actionRow.append(saveInfo, checkDriveBtn);

  info.append(description, genres, views);
  if (heat) info.append(heat);
  info.append(meta, folderPathNote, actionRow);
  layout.append(posterBox, info);
  container.append(heading, layout);

  const status = el("p", "detail-status", `Đang tải danh sách tập từ ${providerLabel}...`);

  // Direct Google Drive Upload Panel (2 modes: All & Episode Range)
  const transfer = el("div", "detail-transfer");
  const transferTitle = el("h3", "", `Tải video trực tiếp lên Google Drive (Thư mục ID: ${movie.id})`);
  const bgNotice = el(
    "p",
    "detail-muted",
    "⚡ Duy trì tải ngầm trên máy chủ: Khi đã bắt đầu tải, bạn có thể chuyển tab hoặc thoát/đóng trang web mà quá trình tải video lên Google Drive vẫn tiếp tục chạy cho đến khi hoàn tất."
  );
  const driveFolderStatus = el(
    "div",
    "drive-folder-banner",
    driveConnected()
      ? "Đang kiểm tra trạng thái thư mục phim trên Google Drive..."
      : "Hãy kết nối Google Drive để kiểm tra tập đã có và tải video trực tiếp lên Drive."
  );

  const modeWrap = el("div", "transfer-modes");
  const modeAllLabel = el("label", "mode-option active");
  const modeAllRadio = el("input");
  modeAllRadio.type = "radio";
  modeAllRadio.name = "transferMode_" + movie.id;
  modeAllRadio.value = "all";
  modeAllRadio.checked = true;
  const modeAllText = el("span", "", `Tải toàn bộ (Tập 1 → ${movie.episodeCount || "..."})`);
  modeAllLabel.append(modeAllRadio, modeAllText);

  const modeRangeLabel = el("label", "mode-option");
  const modeRangeRadio = el("input");
  modeRangeRadio.type = "radio";
  modeRangeRadio.name = "transferMode_" + movie.id;
  modeRangeRadio.value = "range";
  const modeRangeText = el("span", "", "Tải từ tập này đến tập này (Phim đang cập nhật)");
  modeRangeLabel.append(modeRangeRadio, modeRangeText);
  modeWrap.append(modeAllLabel, modeRangeLabel);

  const rangeControls = el("div", "range-controls hidden");
  const fromLabel = el("label", "range-field", "Từ tập:");
  const fromInput = el("input", "range-input");
  fromInput.type = "number";
  fromInput.min = "1";
  fromInput.max = String(movie.episodeCount || 5000);
  fromInput.value = "1";
  fromLabel.append(fromInput);

  const toLabel = el("label", "range-field", "Đến tập:");
  const toInput = el("input", "range-input");
  toInput.type = "number";
  toInput.min = "1";
  toInput.max = String(movie.episodeCount || 5000);
  toInput.value = String(movie.episodeCount || 1);
  toLabel.append(toInput);

  const fillMissingBtn = btn("Điền tập chưa có trên Drive", "detail-secondary");
  rangeControls.append(fromLabel, toLabel, fillMissingBtn);

  const updateModeUI = () => {
    const isRange = modeRangeRadio.checked;
    modeAllLabel.classList.toggle("active", !isRange);
    modeRangeLabel.classList.toggle("active", isRange);
    rangeControls.classList.toggle("hidden", !isRange);
  };
  modeAllRadio.onchange = updateModeUI;
  modeRangeRadio.onchange = updateModeUI;

  const skipLabel = el("label", "rights-label");
  const skipCheck = el("input");
  skipCheck.type = "checkbox";
  skipCheck.checked = true;
  skipLabel.append(
    skipCheck,
    document.createTextNode(" Tự động bỏ qua các tập đã có trên Google Drive (tránh tải trùng khi cập nhật tập mới)")
  );

  const transferBtnRow = el("div", "row");
  const startBtn = btn("Tải video trực tiếp lên Google Drive (Chạy ngầm)", "primary");
  const cancelBtn = btn("Dừng tải", "detail-secondary hidden");
  transferBtnRow.append(startBtn, cancelBtn);

  const progress = el("p", "detail-status", "");
  const meter = el("progress", "detail-progress");
  meter.max = 100;
  meter.value = 0;
  meter.hidden = true;

  transfer.append(
    transferTitle,
    bgNotice,
    driveFolderStatus,
    modeWrap,
    rangeControls,
    skipLabel,
    transferBtnRow,
    progress,
    meter
  );

  // Playback & Episode Grid
  const playback = el("div", "detail-playback");
  const video = el("video", "player");
  video.controls = true;
  video.playsInline = true;
  video.preload = "none";
  const playerMessage = el("p", "detail-muted", "Chọn tập bên dưới để phát trực tuyến.");
  video.onerror = () => {
    playerMessage.textContent = "Trình duyệt không phát được luồng hiện tại (định dạng, CDN hoặc hạn URL).";
  };
  const epHeading = el("h3", "", "Danh sách tập");
  const epGrid = el("div", "episodes");
  playback.append(epHeading, video, playerMessage, epGrid);

  container.append(status, transfer, playback);
  container.scrollIntoView({ behavior: "smooth", block: "start" });

  let episodes = [];
  let uploadedSet = new Set();
  let busy = false;
  let abortController = null;
  const epButtons = new Map();

  const ensureGoogle = async () => {
    if (driveConnected()) return;
    await connectDrive(clientID());
    if (typeof onDriveUpdated === "function") onDriveUpdated();
  };

  const markUploadedButtons = () => {
    for (const [epNum, b] of epButtons.entries()) {
      const isUp = uploadedSet.has(epNum);
      b.classList.toggle("on-drive", isUp);
      b.textContent = isUp ? `${epNum} ✓` : String(epNum);
    }
  };

  const refreshDriveFolderState = async () => {
    if (!driveConnected()) {
      driveFolderStatus.textContent =
        "Chưa kết nối Google Drive. Nhấn nút tải hoặc 'Kiểm tra thư mục trên Drive' để kết nối.";
      return;
    }
    try {
      driveFolderStatus.textContent = `Đang kiểm tra thư mục PineDrama-Library/${movie.id} trên Google Drive...`;
      const infoDrive = await inspectSeriesDriveFolder(movie.id);
      uploadedSet = new Set(infoDrive.uploadedEpisodes || []);
      markUploadedButtons();
      const totalEp = episodes.length || movie.episodeCount || 0;
      if (!infoDrive.exists) {
        driveFolderStatus.innerHTML = `Thư mục <code>PineDrama-Library/${movie.id}</code> chưa có trên Drive. Sẽ tự động tạo khi tải.`;
      } else {
        driveFolderStatus.replaceChildren();
        const textSpan = el(
          "span",
          "",
          `Thư mục Drive ID ${movie.id}: Đã có ${uploadedSet.size}/${totalEp || "?"} tập (${formatBytes(
            infoDrive.totalSizeBytes
          )}) · `
        );
        const link = el("a", "drive-link", "Mở thư mục trên Drive ↗");
        link.href = infoDrive.folderUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        driveFolderStatus.append(textSpan, link);
        if (totalEp && uploadedSet.size > 0 && uploadedSet.size < totalEp) {
          let firstMissing = 1;
          while (firstMissing <= totalEp && uploadedSet.has(firstMissing)) firstMissing++;
          if (firstMissing <= totalEp) {
            fromInput.value = String(firstMissing);
            toInput.value = String(totalEp);
          }
        }
      }
    } catch (e) {
      driveFolderStatus.textContent = "Không kiểm tra được thư mục Drive: " + e.message;
    }
  };

  const handleTransferProgress = info => {
    const total = info.total || 1;
    const done = info.index || 0;
    const part = info.percent || 0;
    meter.hidden = false;
    meter.value = Math.round(((done + part / 100) / total) * 100);
    if (Array.isArray(info.uploadedEpisodes)) {
      for (const epNum of info.uploadedEpisodes) uploadedSet.add(Number(epNum));
      markUploadedButtons();
    }
    if (info.phase === "existing" || info.phase === "done") {
      uploadedSet.add(info.episode);
      markUploadedButtons();
    }
    const phaseText =
      info.phase === "existing"
        ? "đã có sẵn trên Drive (bỏ qua)"
        : info.phase === "done"
          ? "đã tải xong lên Drive ✓"
          : `đang tải ngầm lên Drive (${part}%)`;
    progress.textContent = `[${done + 1}/${total}] Tập ${info.episode} (EP${String(info.episode).padStart(
      3,
      "0"
    )}.mp4): ${phaseText} (Vẫn tiếp tục khi thoát trang)`;
  };

  // Reconnect to any active server background transfer job for this series
  const checkExistingBackgroundJob = async () => {
    try {
      const jobs = await fetchActiveTransferJobs(movie.id);
      const runningJob = jobs.find(j => j.status === "running" || j.status === "queued");
      if (!runningJob || busy) return;

      busy = true;
      abortController = new AbortController();
      startBtn.disabled = true;
      cancelBtn.classList.remove("hidden");
      meter.hidden = false;
      progress.textContent = `Đang đồng bộ lại tiến trình tải ngầm đang chạy cho phim #${movie.id}...`;

      const result = await attachToBackgroundTransferJob(
        runningJob.id,
        { signal: abortController.signal },
        handleTransferProgress
      );
      const newlyUploaded = (result.report || []).filter(x => !x.skipped).length;
      const skippedCount = (result.report || []).filter(x => x.skipped).length;
      meter.value = 100;
      progress.textContent = `Hoàn tất tiến trình tải ngầm! Đã tải mới ${newlyUploaded} tập, bỏ qua ${skippedCount} tập đã có. Lưu tại: PineDrama-Library/${movie.id}`;
      await refreshDriveFolderState();
      if (typeof onDriveUpdated === "function") onDriveUpdated();
    } catch (e) {
      progress.textContent = "Tiến trình tải ngầm dừng: " + e.message;
      await refreshDriveFolderState().catch(() => {});
    } finally {
      busy = false;
      abortController = null;
      startBtn.disabled = false;
      cancelBtn.classList.add("hidden");
    }
  };

  fillMissingBtn.onclick = async () => {
    try {
      await ensureGoogle();
      await refreshDriveFolderState();
      const totalEp = episodes.length || movie.episodeCount || 1;
      let firstMissing = 1;
      while (firstMissing <= totalEp && uploadedSet.has(firstMissing)) firstMissing++;
      modeRangeRadio.checked = true;
      updateModeUI();
      if (firstMissing > totalEp) {
        progress.textContent = `Tất cả ${totalEp} tập đã có đủ trên Google Drive!`;
      } else {
        fromInput.value = String(firstMissing);
        toInput.value = String(totalEp);
        progress.textContent = `Đã điền khoảng tập còn thiếu: Tập ${firstMissing} đến Tập ${totalEp}.`;
      }
    } catch (e) {
      progress.textContent = "Lỗi: " + e.message;
    }
  };

  checkDriveBtn.onclick = async () => {
    checkDriveBtn.disabled = true;
    try {
      await ensureGoogle();
      await refreshDriveFolderState();
    } catch (e) {
      status.textContent = "Lỗi kết nối Drive: " + e.message;
    } finally {
      checkDriveBtn.disabled = false;
    }
  };

  saveInfo.onclick = async () => {
    saveInfo.disabled = true;
    const prev = saveInfo.textContent;
    try {
      await ensureGoogle();
      await saveSeriesMetadata(movie, episodes, [...uploadedSet]);
      saveInfo.textContent = "Đã lưu movie.json lên Drive ✓";
      status.textContent = `Đã lưu thông tin phim vào thư mục PineDrama-Library/${movie.id}/movie.json.`;
      await refreshDriveFolderState();
      if (typeof onDriveUpdated === "function") onDriveUpdated();
    } catch (e) {
      status.textContent = "Lỗi Google Drive: " + e.message;
      saveInfo.textContent = prev;
    } finally {
      saveInfo.disabled = false;
    }
  };

  cancelBtn.onclick = () => {
    if (abortController) {
      abortController.abort();
      progress.textContent = "Đang gửi yêu cầu dừng tiến trình tải...";
    }
  };

  startBtn.onclick = async () => {
    if (busy) return;
    if (!episodes.length) {
      progress.textContent = `Danh sách tập chưa tải xong từ ${providerLabel}, vui lòng chờ hoặc thử lại.`;
      return;
    }
    const mode = modeRangeRadio.checked ? "range" : "all";
    const options = {
      mode,
      fromEpisode: Number(fromInput.value),
      toEpisode: Number(toInput.value),
      skipExisting: skipCheck.checked
    };
    let previewSelected;
    try {
      previewSelected = selectEpisodesForTransfer(episodes, options);
    } catch (e) {
      progress.textContent = "Lỗi chọn tập: " + e.message;
      return;
    }

    busy = true;
    abortController = new AbortController();
    options.signal = abortController.signal;
    startBtn.disabled = true;
    cancelBtn.classList.remove("hidden");
    meter.hidden = false;
    meter.value = 0;

    try {
      await ensureGoogle();
      progress.textContent =
        mode === "all"
          ? `Đang khởi tạo tiến trình tải ngầm toàn bộ ${previewSelected.length} tập vào PineDrama-Library/${movie.id}...`
          : `Đang khởi tạo tiến trình tải ngầm từ Tập ${options.fromEpisode} đến Tập ${options.toEpisode} (${previewSelected.length} tập) vào PineDrama-Library/${movie.id}...`;

      const result = await uploadSeriesEpisodesToDrive(movie, episodes, options, handleTransferProgress);

      const newlyUploaded = result.report.filter(x => !x.skipped).length;
      const skippedCount = result.report.filter(x => x.skipped).length;
      meter.value = 100;
      progress.textContent = `Hoàn tất! Đã tải mới ${newlyUploaded} tập, bỏ qua ${skippedCount} tập đã có. Lưu tại: PineDrama-Library/${movie.id}`;
      await refreshDriveFolderState();
      if (typeof onDriveUpdated === "function") onDriveUpdated();
    } catch (e) {
      progress.textContent = "Tạm dừng / Lỗi tải video: " + e.message + " (Các tập đã tải xong được giữ nguyên trên Drive).";
      await refreshDriveFolderState().catch(() => {});
    } finally {
      busy = false;
      abortController = null;
      startBtn.disabled = false;
      cancelBtn.classList.add("hidden");
    }
  };

  try {
    let listing;
    if (isDramaBox) {
      listing = await api(`/dramabox/series/${encodeURIComponent(movie.id)}/episodes`);
      if (listing.series) {
        if (listing.series.title && (!movie.title || movie.title.startsWith("Phim #"))) {
          movie.title = listing.series.title;
          titleNode.textContent = movie.title;
        }
        if (listing.series.description && !movie.description) {
          movie.description = listing.series.description;
          description.textContent = movie.description;
        }
        if (listing.series.genres && !movie.genres) {
          movie.genres = listing.series.genres;
          genres.textContent = movie.genres;
        }
        if (listing.series.poster && !movie.poster) {
          movie.poster = listing.series.poster;
          const newPoster = portraitPoster(movie);
          posterBox.replaceWith(newPoster);
        }
      }
    } else {
      const query = movie.episodeCount ? `?total=${movie.episodeCount}` : "";
      listing = await api(`/series/${encodeURIComponent(movie.id)}/episodes${query}`);
    }

    episodes = listing.episodes || [];
    if (!episodes.length) throw Error("Danh sách tập trống");
    movie.episodeCount = episodes.length;
    epCountTag.textContent = `${episodes.length} tập`;
    modeAllText.textContent = `Tải toàn bộ (Tập 1 → ${episodes.length})`;
    fromInput.max = String(episodes.length);
    toInput.max = String(episodes.length);
    toInput.value = String(episodes.length);

    status.textContent = `Đã xác minh ${episodes.length} tập từ ${providerLabel}. Bạn có thể xem trực tuyến hoặc tải ngầm lên Google Drive bên dưới.`;
    epHeading.textContent = `Danh sách tập · ${episodes.length} tập (Tập có dấu ✓ là đã có trên Google Drive)`;
    epGrid.replaceChildren();
    epButtons.clear();

    for (const episode of episodes) {
      const episodeButton = btn(String(episode.number));
      episodeButton.disabled = Boolean(episode.locked);
      episodeButton.title = episode.locked ? "Tập đang khóa" : "Phát tập " + episode.number;
      epButtons.set(episode.number, episodeButton);
      episodeButton.onclick = async () => {
        epGrid.querySelectorAll("button").forEach(x => x.classList.remove("active"));
        episodeButton.classList.add("active");
        video.pause();
        video.removeAttribute("src");
        video.load();
        playerMessage.textContent = "Đang lấy URL tập " + episode.number + "...";
        try {
          let streamUrl = episode.url || episode.direct_url || null;
          if (!streamUrl) {
            const streamEndpoint = isDramaBox
              ? `/dramabox/series/${encodeURIComponent(movie.id)}/episodes/${encodeURIComponent(episode.id || episode.number)}/stream`
              : `/series/${encodeURIComponent(movie.id)}/episodes/${encodeURIComponent(episode.id)}/stream?total=${episodes.length}`;
            const stream = await api(streamEndpoint);
            streamUrl = stream.url;
          }
          video.src = streamUrl;
          video.load();
          playerMessage.textContent = `Tập ${episode.number} (${providerLabel}) · đang phát trực tuyến.`;
          await video.play().catch(() => {
            playerMessage.textContent = "Nhấn Play để bắt đầu; nếu lỗi có thể do CDN/codec.";
          });
        } catch (e) {
          playerMessage.textContent = "Không thể phát tập " + episode.number + ": " + e.message;
        }
      };
      epGrid.append(episodeButton);
    }

    if (driveConnected()) {
      await refreshDriveFolderState();
    }
    checkExistingBackgroundJob();
  } catch (e) {
    status.textContent = "Không tải được danh sách tập: " + e.message;
    playerMessage.textContent = `Vẫn có thể lưu thông tin phim; tải video yêu cầu lấy được danh sách tập từ ${providerLabel}.`;
  }
}
