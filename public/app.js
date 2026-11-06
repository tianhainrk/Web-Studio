import {initMultiplatform,refreshMultiplatform} from "./multiplatform.js";
import {initReelsStudio,refreshReelsStudio} from "./reels.js";
import { openMovieDetail } from "./detail.js";
import {
  connectDrive,
  driveConnected,
  setDriveToken,
  disconnectDrive,
  getRootFolderId,
  inferSourceById,
  uploadToDrive,
  listManagedSeriesOnDrive,
  uploadSeriesEpisodesToDrive,
  deleteDriveFileOrFolder,
  saveSeriesMetadata,
  fetchActiveTransferJobs,
  cancelServerTransferJob
} from "./drive-transfer.js";

const $ = id => document.getElementById(id);
let movies = [],
  selected = null,
  googleClientId = "",
  managedItems = [],
  managerBusy = false,
  lastActiveTab = "catalog",
  ddLoadedOnce = false;

const api = async (p, options = {}) => {
  const r = await fetch("/api" + p, { credentials: "same-origin", ...options });
  let j = await r.json();
  if (!r.ok) throw Error(j.error || "API failed");
  return j;
};

function status(s, error = false) {
  $("message").textContent = s;
  $("message").style.color = error ? "#ff9ea4" : "#bda7f0";
}

function effectiveClientId() {
  return (localStorage.getItem("pws_google_client_id") || googleClientId || "").trim();
}

function updateDriveConnectionUI() {
  const connected = driveConnected();
  const rootId = getRootFolderId();
  const badge = $("driveHeaderBadge");
  if (badge) {
    badge.textContent = connected ? "Drive: Đã kết nối ✓" : "Drive: Chưa kết nối";
    badge.classList.toggle("connected", connected);
  }
  if ($("headerConnectDrive")) {
    $("headerConnectDrive").textContent = connected ? "Quản lý Drive" : "Liên kết Google Drive";
  }
  if ($("driveState")) {
    $("driveState").innerHTML = connected
      ? `Đã kết nối Google Drive ✓ ${
          rootId
            ? `· <a class="drive-link" href="https://drive.google.com/drive/folders/${rootId}" target="_blank" rel="noopener">Mở thư mục gốc PineDrama-Library ↗</a>`
            : ""
        }`
      : "Chưa kết nối Google Drive";
  }
  if ($("googleDisconnect")) {
    $("googleDisconnect").classList.toggle("hidden", !connected);
  }
  if ($("managerConnectBtn")) {
    $("managerConnectBtn").classList.toggle("hidden", connected);
  }
}

function switchTab(tabName) {
  lastActiveTab = tabName;
  document.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x.dataset.tab === tabName));
  ["catalog", "dramadownloader", "manager", "drive", "reels", "multiplatform"].forEach(x => {
    const node = $(x);
    if (node) node.classList.toggle("hidden", x !== tabName);
  });
  $("detail").classList.add("hidden");
  if (tabName === "reels") refreshReelsStudio().catch(e => status("Reels: " + e.message, true));
  if (tabName === "multiplatform") initMultiplatform().catch(e => status("Đa nền tảng: " + e.message, true));
  if (tabName === "manager" && driveConnected() && !managerBusy) {
    loadDriveManager();
  }
  if (tabName === "dramadownloader" && !ddLoadedOnce) {
    ddLoadedOnce = true;
    loadDramaBoxCatalog(false);
  }
}

async function handleConnectDrive() {
  try {
    await connectDrive(effectiveClientId());
    updateDriveConnectionUI();
    status("Đã liên kết Google Drive và khởi tạo thư mục PineDrama-Library thành công!");
    if (!$("manager").classList.contains("hidden")) {
      await loadDriveManager();
    }
  } catch (e) {
    status("Liên kết Google Drive: " + e.message, true);
    if ($("driveState")) $("driveState").textContent = e.message;
    switchTab("drive");
  }
}

// Poll server-side background transfers so the user always sees live status even after page reload
let bgPollTimer = null;
async function pollBackgroundTransfers() {
  try {
    const jobs = await fetchActiveTransferJobs();
    const active = jobs.filter(j => j.status === "running" || j.status === "queued");
    const banner = $("bgTransferBanner");
    if (!banner) return;
    if (!active.length) {
      banner.classList.add("hidden");
      banner.replaceChildren();
      return;
    }
    const job = active[0];
    banner.classList.remove("hidden");
    banner.replaceChildren();

    const left = document.createElement("div");
    const epNum = String(job.currentEpisode || 1).padStart(3, "0");
    left.innerHTML =
      `<strong style="color:#81e69b">⚡ Đang tải ngầm lên Google Drive (${active.length} tiến trình):</strong> ` +
      `<span><b>${job.seriesTitle}</b> (ID: <code>${job.seriesId}</code>) · ` +
      `Tập ${job.currentEpisode || 1} (EP${epNum}.mp4) [${(job.currentIndex || 0) + 1}/${job.totalSelected || 1}] · ${
        job.currentPercent || 0
      }%</span> ` +
      `<small class="muted">(Tự động duy trì khi thoát trang web)</small>`;

    const right = document.createElement("div");
    right.className = "row";
    const openBtn = document.createElement("button");
    openBtn.className = "btn-sm detail-secondary";
    openBtn.textContent = "Xem tiến trình";
    openBtn.onclick = () =>
      openMovie({
        id: job.seriesId,
        source: job.source || inferSourceById(job.seriesId),
        title: job.seriesTitle,
        episodeCount: job.totalEpisodes || job.totalSelected
      });

    const stopBtn = document.createElement("button");
    stopBtn.className = "btn-sm danger";
    stopBtn.textContent = "Dừng tải";
    stopBtn.onclick = async () => {
      stopBtn.disabled = true;
      await cancelServerTransferJob(job.id);
      await pollBackgroundTransfers();
    };
    right.append(openBtn, stopBtn);
    banner.append(left, right);
  } catch {}
}

function startBackgroundTransferPolling() {
  if (bgPollTimer) clearInterval(bgPollTimer);
  pollBackgroundTransfers();
  bgPollTimer = setInterval(pollBackgroundTransfers, 3000);
}

async function auth() {
  const me = await api("/me");
  googleClientId = me.googleClientId || "";
  if ($("customClientId") && !localStorage.getItem("pws_google_client_id") && googleClientId) {
    $("customClientId").value = googleClientId;
  } else if ($("customClientId")) {
    $("customClientId").value = localStorage.getItem("pws_google_client_id") || "";
  }
  $("loginView").classList.toggle("hidden", me.authenticated);
  $("appView").classList.toggle("hidden", !me.authenticated);
  $("headerActions").classList.toggle("hidden", !me.authenticated);
  updateDriveConnectionUI();
  if (me.authenticated) {
    startBackgroundTransferPolling();
    if (location.hash === "#reels") {
      initReelsStudio();
      switchTab("reels");
    } else if (location.hash === "#multiplatform") {
      switchTab("multiplatform");
    } else if (location.hash === "#dramadownloader") {
      switchTab("dramadownloader");
    } else {
      await loadCatalog();
    }
  }
}

$("loginForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value })
    });
    $("password").value = "";
    $("error").textContent = "";
    await auth();
  } catch (e) {
    $("error").textContent = e.message;
  }
};

document.querySelectorAll("[data-tab]").forEach(b => {
  b.onclick = () => switchTab(b.dataset.tab);
});

$("headerConnectDrive").onclick = () => {
  if (driveConnected()) switchTab("manager");
  else handleConnectDrive();
};

const PAGE_SIZE = 10;
const libraryState = {
  generation: 0,
  feed: "home",
  cursor: "",
  allFetched: [],
  fetchedIDs: new Set(),
  buffer: [],
  movies: [],
  seen: new Set(),
  visited: new Set(),
  serverHasMore: false,
  blocked: false,
  groups: [],
  choice: {},
  pending: false,
  ending: ""
};

function switchFeed() {
  $("count").disabled = $("feed").value !== "home";
  $("count").classList.toggle("hidden", $("feed").value !== "home");
  $("categoryFilters").classList.toggle("hidden", $("feed").value !== "categories");
  loadCatalog();
}

function resetLibrary() {
  const s = libraryState;
  s.generation++;
  s.feed = $("feed").value;
  s.cursor = "";
  s.allFetched = [];
  s.fetchedIDs = new Set();
  s.buffer = [];
  s.movies = [];
  s.seen = new Set();
  s.visited = new Set();
  s.serverHasMore = true;
  s.blocked = false;
  s.groups = [];
  s.ending = "";
  s.choice = {};
  s.rankingUpdatedAt = null;
  movies = [];
  $("detail").classList.add("hidden");
  $("detail").replaceChildren();
  $("categoryFilters").replaceChildren();
}

function libraryURL() {
  const s = libraryState,
    params = new URLSearchParams({ feed: s.feed, cursor: s.cursor });
  if (s.feed === "home") {
    params.set("count", $("count").value);
    params.set("total", String(s.allFetched.length));
    params.set("loaded", s.allFetched.slice(-20).map(m => m.id).join(","));
  }
  if (s.feed === "hot" || s.feed === "ranking") params.set("count", "10");
  if (s.feed === "categories") params.set("filters", JSON.stringify(s.choice));
  return "/library?" + params.toString();
}

function updateLibraryUI() {
  const s = libraryState,
    label = {
      home: "Đề xuất",
      hot: "Top phim hot · VN",
      ranking: "Bảng xếp hạng mới nhất · VN",
      new: "Tác phẩm mới · VN (7 ngày)",
      categories: "Thể loại"
    }[s.feed];
  $("catalogStatus").textContent =
    label +
    " · " +
    s.movies.length +
    " phim đang hiển thị" +
    (s.buffer.length ? " · " + s.buffer.length + " phim mới đang chờ" : "") +
    (s.ending
      ? " · " + s.ending
      : s.blocked
        ? " · trang chủ sử dụng ID đã tải để tiếp tục"
        : s.serverHasMore
          ? " · có thể tải thêm"
          : " · đã hết dữ liệu");
  if (s.rankingUpdatedAt && (s.feed === "hot" || s.feed === "ranking"))
    $("catalogStatus").textContent +=
      " · API cập nhật: " +
      new Date(s.rankingUpdatedAt * 1000).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
  const more = $("loadMore");
  more.textContent = "Tải thêm 10 phim";
  more.classList.toggle("hidden", !s.buffer.length && (!s.serverHasMore || Boolean(s.ending)));
  more.disabled = s.pending;
  renderMovies();
}

function renderFilters() {
  const wrap = $("categoryFilters");
  wrap.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Bộ lọc chính thức từ PineDrama";
  wrap.append(heading);
  for (const group of libraryState.groups) {
    const label = document.createElement("label");
    label.textContent = group.title + " ";
    const select = document.createElement("select");
    for (const option of group.options) {
      const item = document.createElement("option");
      item.value = option.id;
      item.textContent = option.title;
      select.append(item);
    }
    select.value = libraryState.choice[group.key] || "all";
    select.onchange = () => {
      if (libraryState.pending) {
        select.value = libraryState.choice[group.key] || "all";
        return;
      }
      libraryState.choice[group.key] = select.value;
      libraryState.generation++;
      libraryState.cursor = "";
      libraryState.allFetched = [];
      libraryState.fetchedIDs = new Set();
      libraryState.buffer = [];
      libraryState.movies = [];
      libraryState.seen = new Set();
      libraryState.visited = new Set();
      libraryState.ending = "";
      libraryState.serverHasMore = true;
      movies = [];
      fetchLibraryPage(false);
    };
    label.append(select);
    label.style.display = "inline-flex";
    label.style.alignItems = "center";
    label.style.gap = "8px";
    label.style.margin = "6px 10px 6px 0";
    wrap.append(label);
  }
}

async function loadCatalog() {
  if (libraryState.pending) return;
  resetLibrary();
  await fetchLibraryPage(false);
}

function consumeBuffer(max) {
  const s = libraryState;
  let added = 0;
  while (s.buffer.length && added < max) {
    const item = s.buffer.shift();
    if (s.seen.has(item.id)) continue;
    s.seen.add(item.id);
    s.movies.push(item);
    added++;
  }
  movies = s.movies;
  return added;
}

async function fetchLibraryPage(append) {
  const s = libraryState;
  if (s.pending) return;
  s.pending = true;
  const generation = s.generation;
  $("refresh").disabled = true;
  $("loadMore").disabled = true;
  $("feed").disabled = true;
  $("count").disabled = true;
  $("categoryFilters")
    .querySelectorAll("select")
    .forEach(x => (x.disabled = true));
  let added = 0,
    upstream = 0,
    unchanged = 0,
    reason = "";
  try {
    status("Đang " + (append ? "tải thêm 10 phim mới" : "lấy 10 phim đầu tiên") + " từ PineDrama...");
    added += consumeBuffer(PAGE_SIZE);
    while (added < PAGE_SIZE && s.serverHasMore !== false && upstream < 6 && unchanged < 2 && !s.ending) {
      const before = s.allFetched.length,
        oldCursor = s.cursor;
      const data = await api(libraryURL());
      if (s.generation !== generation) return;
      upstream++;
      if (s.feed === "categories" && Array.isArray(data.categoryGroups)) {
        s.groups = data.categoryGroups;
        renderFilters();
      }
      if (Number.isSafeInteger(data.rankingUpdatedAt)) s.rankingUpdatedAt = data.rankingUpdatedAt;
      const list = data.movies;
      if (!Array.isArray(list)) throw Error("PineDrama không trả danh sách phim hợp lệ");
      let unique = 0;
      for (const item of list) {
        if (!item || typeof item.id !== "string" || !item.title) continue;
        if (!s.fetchedIDs.has(item.id)) {
          s.fetchedIDs.add(item.id);
          s.allFetched.push(item);
          s.buffer.push(item);
          unique++;
        }
      }
      s.serverHasMore = Boolean(data.serverHasMore);
      s.blocked = Boolean(data.blockedByEmptyCursor);
      const next = data.nextCursor || "";
      if (s.feed !== "home") {
        if (s.serverHasMore && (!next || next === oldCursor || s.visited.has(next))) {
          s.ending = "Cursor không tiến tới; dừng tải an toàn";
        } else {
          if (next) s.visited.add(next);
          s.cursor = next;
        }
      } else if (s.allFetched.length >= 5000) {
        s.ending = "Đã đạt giới hạn phiên";
      }
      unchanged = unique === 0 ? unchanged + 1 : 0;
      added += consumeBuffer(PAGE_SIZE - added);
      if (!s.serverHasMore && s.buffer.length === 0) break;
      if (s.allFetched.length === before && unchanged >= 2) {
        reason = "API lặp lại phim cũ, chưa có thêm phim mới";
        break;
      }
    }
    if (s.generation !== generation) return;
    if (added < PAGE_SIZE) {
      const note =
        reason ||
        (!s.serverHasMore
          ? "PineDrama đã hết dữ liệu"
          : upstream >= 6
            ? "Đã kiểm tra 6 trang nhưng chưa đủ phim mới"
            : s.ending || "");
      if (note) {
        s.ending = s.buffer.length ? "" : note;
        status("Hiển thị " + added + "/10 phim mới. " + note, added === 0);
      } else status("Đã bổ sung " + added + " phim mới");
    } else status("Đã bổ sung đúng 10 phim chưa từng hiển thị");
    if (!s.serverHasMore && s.buffer.length === 0 && !s.ending) s.ending = "Hết phim trong mục này";
  } catch (error) {
    if (s.generation === generation) {
      status("Lỗi lấy danh sách: " + error.message, true);
    }
  } finally {
    s.pending = false;
    $("refresh").disabled = false;
    $("feed").disabled = false;
    $("count").disabled = s.feed !== "home";
    $("categoryFilters")
      .querySelectorAll("select")
      .forEach(x => (x.disabled = false));
    updateLibraryUI();
  }
}

function formatHeat(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1e9) return (n / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + "T";
  if (n >= 1e6) return (n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + "Tr";
  return n.toLocaleString("vi-VN");
}

function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (!b || b <= 0) return "0 MB";
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

function summarizeEpisodeRanges(nums) {
  if (!Array.isArray(nums) || !nums.length) return "Chưa có tập nào";
  const sorted = [...new Set(nums.map(Number))].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0],
    prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = prev = sorted[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  return "Tập " + ranges.join(", ");
}

function renderMovies() {
  const q = $("search").value.toLocaleLowerCase("vi");
  const list = movies.filter(m => m.title.toLocaleLowerCase("vi").includes(q) || String(m.id).includes(q));
  $("movies").replaceChildren();
  const ranking = libraryState.feed === "hot" || libraryState.feed === "ranking";
  $("movies").classList.toggle("ranked", ranking);
  list.forEach((m, idx) => {
    const b = document.createElement("button");
    b.className = "movie";
    if (ranking) {
      const rankEl = document.createElement("span");
      rankEl.className = "rank-index";
      rankEl.textContent = String(idx + 1);
      b.append(rankEl);
    }
    const cover = document.createElement("div");
    cover.className = "cover";
    if (m.poster) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = m.poster;
      img.alt = m.title;
      cover.append(img);
    } else cover.textContent = "🎬";
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("strong");
    name.textContent = m.title;
    const small = document.createElement("small");
    const heat = m.heatScore != null ? " · 🔥 " + formatHeat(m.heatScore) + " điểm hot" : "";
    small.textContent =
      (m.episodeCount ?? "?") +
      " tập" +
      (ranking ? heat : m.viewCount != null ? " · " + m.viewCount.toLocaleString("vi-VN") + " lượt xem" : "") +
      ` · ID: ${m.id}`;
    info.append(name, small);
    b.append(cover, info);
    b.onclick = () => openMovie(m);
    $("movies").append(b);
  });
}

async function openMovie(m) {
  selected = m;
  ["catalog", "dramadownloader", "manager", "drive"].forEach(x => {
    const node = $(x);
    if (node) node.classList.add("hidden");
  });
  $("detail").classList.remove("hidden");
  await openMovieDetail(m, {
    api,
    clientID: effectiveClientId,
    container: $("detail"),
    onDriveUpdated: () => updateDriveConnectionUI(),
    onBack: () => {
      switchTab(lastActiveTab || (m.source === "dramabox" ? "dramadownloader" : "catalog"));
    },
    onOpenManager: focusId => {
      switchTab("manager");
      if (focusId) $("managerSearch").value = String(focusId);
    }
  });
}

// ==================== DRAMADOWNLOADER -> DRIVE TAB (DRAMABOX CATALOG) ====================
const ddState = {
  feed: "hot",
  subType: "",
  categoryId: "all",
  page: 1,
  query: "",
  movies: [],
  seenIds: new Set(),
  serverHasMore: false,
  categories: [],
  subTabs: [],
  pending: false
};

function renderDramaBoxSubFilters() {
  const wrap = $("ddSubFilters");
  if (!wrap) return;
  wrap.replaceChildren();
  if (!ddState.subTabs.length) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  for (const tab of ddState.subTabs) {
    const b = document.createElement("button");
    b.textContent = tab.title;
    b.classList.toggle("active", (ddState.subType || ddState.subTabs[0]?.id) === tab.id);
    b.onclick = () => {
      if (ddState.pending) return;
      ddState.subType = tab.id;
      ddState.page = 1;
      loadDramaBoxCatalog(false);
    };
    wrap.append(b);
  }
}

function renderDramaBoxCategories() {
  const panel = $("ddCategoryPanel");
  const chips = $("ddCategoryChips");
  if (!panel || !chips) return;
  if (ddState.feed !== "categories" || !ddState.categories.length) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  chips.replaceChildren();
  for (const cat of ddState.categories) {
    const id = String(cat.id);
    const b = document.createElement("button");
    b.textContent = cat.name;
    b.classList.toggle("active", String(ddState.categoryId || "all") === id);
    if (String(ddState.categoryId || "all") === id && $("ddCategoryActiveLabel")) {
      $("ddCategoryActiveLabel").textContent = cat.name;
    }
    b.onclick = () => {
      if (ddState.pending) return;
      ddState.categoryId = id;
      ddState.page = 1;
      loadDramaBoxCatalog(false);
    };
    chips.append(b);
  }
}

function renderDramaBoxMovies() {
  const grid = $("ddMovies");
  if (!grid) return;
  grid.replaceChildren();
  const isRanking = ddState.feed === "ranking";
  grid.classList.toggle("ranked", isRanking);

  ddState.movies.forEach((m, idx) => {
    const b = document.createElement("button");
    b.className = "movie";
    if (isRanking) {
      const rankEl = document.createElement("span");
      rankEl.className = "rank-index";
      rankEl.textContent = String(m.rankNumber || idx + 1);
      b.append(rankEl);
    }
    const cover = document.createElement("div");
    cover.className = "cover";
    if (m.poster) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = m.poster;
      img.alt = m.title;
      cover.append(img);
    } else {
      cover.textContent = "🎬";
    }
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("strong");
    name.textContent = m.title;
    const small = document.createElement("small");
    const heat = m.heatScore != null ? " · 🔥 " + formatHeat(m.heatScore) : "";
    const statusBadge = m.isUpcoming ? " · ⏳ Sắp ra mắt" : "";
    const genreShort = m.genres ? " · " + m.genres.split("·").slice(0, 2).map(s => s.trim()).join(", ") : "";
    small.textContent =
      (m.episodeCount ?? "?") +
      " tập" +
      heat +
      statusBadge +
      genreShort +
      ` · ID: ${m.id}`;
    info.append(name, small);
    b.append(cover, info);
    b.onclick = () =>
      openMovie({
        ...m,
        source: "dramabox",
        platform: "dramabox"
      });
    grid.append(b);
  });
}

async function loadDramaBoxCatalog(append = false) {
  if (ddState.pending) return;
  ddState.pending = true;
  if (!append) {
    ddState.page = 1;
    ddState.movies = [];
    ddState.seenIds = new Set();
  }
  if ($("ddRefresh")) $("ddRefresh").disabled = true;
  if ($("ddSearchBtn")) $("ddSearchBtn").disabled = true;
  if ($("ddLoadMore")) $("ddLoadMore").disabled = true;
  if ($("ddFeed")) $("ddFeed").disabled = true;

  const feedLabels = {
    hot: "Phim Hot (Đề xuất)",
    new: ddState.subType === "upcoming" ? "Phim Mới · Sắp ra mắt" : "Phim Mới · Đã ra mắt",
    ranking:
      ddState.subType === "search"
        ? "BXH · Bảng Tìm Kiếm Hot"
        : ddState.subType === "new"
          ? "BXH · Bảng Phim Mới"
          : "BXH · Bảng Phim Hot",
    categories: "Danh Mục Thể Loại",
    search: `Tìm kiếm "${ddState.query}"`
  };

  try {
    $("ddStatus").textContent = `Đang tải danh sách ${feedLabels[ddState.feed] || "DramaBox"} (Trang ${ddState.page})...`;
    const params = new URLSearchParams({
      feed: ddState.feed,
      page: String(ddState.page),
      lang: "vi"
    });
    if (ddState.subType) params.set("subType", ddState.subType);
    if (ddState.feed === "categories" && ddState.categoryId) params.set("categoryId", ddState.categoryId);
    if (ddState.feed === "search" && ddState.query) {
      params.set("query", ddState.query);
      params.set("q", ddState.query);
    }

    const data = await api("/dramabox/library?" + params.toString());
    if (Array.isArray(data.subTabs)) {
      ddState.subTabs = data.subTabs;
      if (!ddState.subType && data.subTabs[0]) ddState.subType = data.subTabs[0].id;
    } else {
      ddState.subTabs = [];
    }
    if (Array.isArray(data.categories) && data.categories.length) {
      ddState.categories = data.categories;
    }

    for (const item of data.movies || []) {
      if (!item || !item.id || ddState.seenIds.has(item.id)) continue;
      ddState.seenIds.add(item.id);
      ddState.movies.push({
        ...item,
        source: "dramabox",
        platform: "dramabox"
      });
    }
    ddState.serverHasMore = Boolean(data.serverHasMore);

    renderDramaBoxSubFilters();
    renderDramaBoxCategories();
    renderDramaBoxMovies();

    $("ddStatus").textContent =
      `${feedLabels[ddState.feed] || "DramaBox"} · Đang hiển thị ${ddState.movies.length} bộ phim` +
      (ddState.serverHasMore ? " · Có thể tải thêm" : " · Đã hiển thị toàn bộ danh sách trang này");

    if ($("ddLoadMore")) {
      $("ddLoadMore").classList.toggle("hidden", !ddState.serverHasMore);
      $("ddLoadMore").disabled = false;
    }
  } catch (e) {
    $("ddStatus").textContent = "Lỗi tải danh sách DramaBox: " + e.message;
  } finally {
    ddState.pending = false;
    if ($("ddRefresh")) $("ddRefresh").disabled = false;
    if ($("ddSearchBtn")) $("ddSearchBtn").disabled = false;
    if ($("ddFeed")) $("ddFeed").disabled = false;
  }
}

function extractDramaBoxBookId(raw) {
  const s = String(raw || "").trim();
  const m =
    /[?&](?:bookId|book_id|id|bid|series_id)=(\d{5,19})\b/i.exec(s) ||
    /\/(?:movie|drama|detail|ep|video|play)[\/-](\d{5,19})(?:[\/?_#-]|$)/i.exec(s) ||
    /dramabox:(\d{5,19})/i.exec(s) ||
    /\b(4[12]00\d{7})\b/.exec(s) ||
    /^(\d{8,16})$/.exec(s);
  return m ? m[1] : null;
}

async function resolveAndOpenDramaBoxTarget(rawTarget, statusNode = null, usePython = false) {
  const target = String(rawTarget || "").trim();
  if (!target) {
    if (statusNode) statusNode.textContent = "Vui lòng dán link phim DramaBox hoặc nhập Book ID.";
    return;
  }
  if (statusNode) {
    statusNode.textContent = usePython
      ? "Đang lấy danh sách tập qua DramaDownloader Python Extractor..."
      : "Đang phân giải link / Book ID DramaBox và lấy danh sách tập...";
  }
  try {
    if (usePython) {
      const payload = await api("/dramadownloader-python", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      if (!payload?.series) throw Error("Không nhận được dữ liệu series từ Python");
      if ($("ddManifestJson")) $("ddManifestJson").value = JSON.stringify(payload.series, null, 2);
      const rawId = String(payload.series.series_id || payload.series.id || "").split(":").pop();
      if (statusNode) {
        statusNode.textContent = `Đã lấy ${payload.series.episodes?.length || 0} tập cho "${payload.series.name || rawId}" ✓`;
      }
      await openMovie({
        id: rawId,
        source: "dramabox",
        platform: "dramabox",
        title: payload.series.name || `Phim DramaBox #${rawId}`,
        description: payload.series.description || payload.series.intro || "",
        genres: payload.series.genres || "",
        poster: payload.series.poster || payload.series.cover_url || null,
        episodeCount: payload.series.episode_count || payload.series.episodes?.length || null
      });
      return;
    }

    const resolved = await api("/dramabox/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target })
    });
    const movieObj = resolved.series || resolved.movie || {};
    const bookId = String(resolved.id || movieObj.id || extractDramaBoxBookId(target));
    if (statusNode) {
      statusNode.textContent = `Đã tìm thấy "${movieObj.title || bookId}" (${resolved.episodes?.length || 0} tập) ✓`;
    }
    await openMovie({
      id: bookId,
      source: "dramabox",
      platform: "dramabox",
      title: movieObj.title || `Phim DramaBox #${bookId}`,
      description: movieObj.description || "",
      genres: movieObj.genres || "",
      poster: movieObj.poster || null,
      episodeCount: resolved.episodes?.length || movieObj.episodeCount || null
    });
  } catch (e) {
    if (statusNode) statusNode.textContent = "Lỗi mở link/ID: " + e.message;
    else status("Lỗi mở link/ID: " + e.message, true);
  }
}

if ($("ddDirectLinkOpenBtn")) {
  $("ddDirectLinkOpenBtn").onclick = async () => {
    $("ddDirectLinkOpenBtn").disabled = true;
    try {
      await resolveAndOpenDramaBoxTarget($("ddDirectLinkInput")?.value, $("ddDirectLinkStatus"), false);
    } finally {
      $("ddDirectLinkOpenBtn").disabled = false;
    }
  };
}

if ($("ddDirectLinkPythonBtn")) {
  $("ddDirectLinkPythonBtn").onclick = async () => {
    $("ddDirectLinkPythonBtn").disabled = true;
    try {
      await resolveAndOpenDramaBoxTarget($("ddDirectLinkInput")?.value, $("ddDirectLinkStatus"), true);
    } finally {
      $("ddDirectLinkPythonBtn").disabled = false;
    }
  };
}

if ($("ddDirectLinkInput")) {
  $("ddDirectLinkInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("ddDirectLinkOpenBtn")?.click();
    }
  });
}

if ($("ddFeed")) {
  $("ddFeed").onchange = () => {
    ddState.feed = $("ddFeed").value;
    ddState.subType = ddState.feed === "new" ? "released" : ddState.feed === "ranking" ? "hot" : "";
    ddState.query = "";
    loadDramaBoxCatalog(false);
  };
}

if ($("ddRefresh")) {
  $("ddRefresh").onclick = () => loadDramaBoxCatalog(false);
}

if ($("ddLoadMore")) {
  $("ddLoadMore").onclick = () => {
    if (ddState.pending || !ddState.serverHasMore) return;
    ddState.page += 1;
    loadDramaBoxCatalog(true);
  };
}

async function handleDramaBoxSearchOrOpen() {
  const raw = ($("ddSearch")?.value || "").trim();
  if (!raw) {
    ddState.feed = $("ddFeed")?.value || "hot";
    ddState.query = "";
    await loadDramaBoxCatalog(false);
    return;
  }
  const directBookId = extractDramaBoxBookId(raw);
  if (/^https?:\/\//i.test(raw) || (directBookId && /^\d{8,16}$/.test(raw))) {
    await resolveAndOpenDramaBoxTarget(raw, $("ddDirectLinkStatus"), false);
    return;
  }
  ddState.feed = "search";
  ddState.subType = "";
  ddState.query = raw;
  await loadDramaBoxCatalog(false);
}

if ($("ddSearchBtn")) {
  $("ddSearchBtn").onclick = handleDramaBoxSearchOrOpen;
}
if ($("ddSearch")) {
  $("ddSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleDramaBoxSearchOrOpen();
    }
  });
}

if ($("ddOpenDirectByIdBtn")) {
  $("ddOpenDirectByIdBtn").onclick = () =>
    resolveAndOpenDramaBoxTarget($("ddPythonTarget")?.value, $("ddPythonStatus"), false);
}

if ($("ddPythonInspectBtn")) {
  $("ddPythonInspectBtn").onclick = async () => {
    $("ddPythonInspectBtn").disabled = true;
    try {
      await resolveAndOpenDramaBoxTarget($("ddPythonTarget")?.value, $("ddPythonStatus"), true);
    } finally {
      $("ddPythonInspectBtn").disabled = false;
    }
  };
}

if ($("ddManifestFile")) {
  $("ddManifestFile").onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    $("ddManifestJson").value = await f.text();
  };
}

if ($("ddParseJsonBtn")) {
  $("ddParseJsonBtn").onclick = async () => {
    try {
      const raw = ($("ddManifestJson")?.value || "").trim();
      if (!raw) throw Error("Chưa dán hoặc chọn file JSON");
      const parsed = JSON.parse(raw);
      const s = parsed.data?.series || parsed.series || parsed;
      const rawId = String(s.series_id || s.id || "").split(":").pop().trim();
      if (!rawId) throw Error("Không tìm thấy series_id trong JSON");
      await openMovie({
        id: rawId,
        source: "dramabox",
        platform: "dramabox",
        title: s.name || s.title || `Phim #${rawId}`,
        description: s.intro || s.description || "",
        poster: s.cover_url || s.poster || null,
        episodeCount: Array.isArray(s.episodes) ? s.episodes.length : null
      });
    } catch (e) {
      $("ddPythonStatus").textContent = "Lỗi JSON: " + e.message;
    }
  };
}

// ==================== DRIVE MANAGER TAB ====================
async function fetchEpisodesForManagedItem(item, refresh = false) {
  const source = inferSourceById(item.id, item.source || item.platform);
  if (source === "dramabox") {
    return api(`/dramabox/series/${encodeURIComponent(item.id)}/episodes${refresh ? "?refresh=1" : ""}`);
  }
  return api(`/series/${encodeURIComponent(item.id)}/episodes${refresh ? "?refresh=1" : ""}`);
}

async function loadDriveManager() {
  if (!driveConnected()) {
    updateDriveConnectionUI();
    $("managerStatus").textContent = "Chưa kết nối Google Drive. Hãy nhấn 'Kết nối Google Drive' để xem danh sách phim.";
    $("managerList").replaceChildren();
    return;
  }
  if (managerBusy) return;
  managerBusy = true;
  $("managerRefreshBtn").disabled = true;
  try {
    $("managerStatus").textContent = "Đang đồng bộ danh sách thư mục phim từ Google Drive (PineDrama-Library)...";
    managedItems = await listManagedSeriesOnDrive(info => {
      $("managerStatus").textContent = `Đang đọc thư mục phim ${info.current}/${info.total} (ID: ${info.folderName})...`;
    });
    updateDriveConnectionUI();
    renderDriveManager();
  } catch (e) {
    $("managerStatus").textContent = "Lỗi tải danh sách từ Google Drive: " + e.message;
  } finally {
    managerBusy = false;
    $("managerRefreshBtn").disabled = false;
  }
}

function renderDriveManager() {
  const listEl = $("managerList");
  listEl.replaceChildren();
  const q = ($("managerSearch").value || "").trim().toLocaleLowerCase("vi");
  const filter = $("managerFilter").value;

  const totalFolders = managedItems.length;
  const totalUploadedEps = managedItems.reduce((acc, x) => acc + x.uploadedCount, 0);
  const totalBytes = managedItems.reduce((acc, x) => acc + x.totalSizeBytes, 0);
  const rootId = getRootFolderId();

  $("managerStatus").innerHTML =
    `Tổng cộng <b>${totalFolders}</b> bộ phim trên Drive · <b>${totalUploadedEps}</b> tập MP4 (${formatBytes(
      totalBytes
    )})` +
    (rootId
      ? ` · <a class="drive-link" href="https://drive.google.com/drive/folders/${rootId}" target="_blank" rel="noopener">Mở PineDrama-Library trên Google Drive ↗</a>`
      : "");

  const filtered = managedItems.filter(item => {
    const src = inferSourceById(item.id, item.source || item.platform);
    if (q && !item.title.toLocaleLowerCase("vi").includes(q) && !String(item.id).includes(q)) return false;
    if (filter === "complete" && !item.isComplete) return false;
    if (filter === "updating" && item.isComplete) return false;
    if (filter === "pinedrama" && src !== "pinedrama") return false;
    if (filter === "dramabox" && src !== "dramabox") return false;
    return true;
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "panel muted";
    empty.textContent = totalFolders
      ? "Không có bộ phim nào khớp bộ lọc tìm kiếm hiện tại."
      : "Thư mục PineDrama-Library trên Google Drive chưa có bộ phim nào. Hãy chọn một phim từ Kho phim hoặc DramaDownloader → Drive để tải lên Drive.";
    listEl.append(empty);
    return;
  }

  for (const item of filtered) {
    const src = inferSourceById(item.id, item.source || item.platform);
    item.source = src;
    item.platform = src;
    const isDramaBox = src === "dramabox";

    const card = document.createElement("div");
    card.className = "manager-card";

    const posterBox = document.createElement("div");
    posterBox.className = "manager-poster";
    if (item.poster) {
      const img = document.createElement("img");
      img.src = item.poster;
      img.alt = item.title;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      posterBox.append(img);
    } else {
      posterBox.textContent = "🎬";
    }

    const body = document.createElement("div");
    body.className = "manager-body";

    const head = document.createElement("div");
    head.className = "manager-head";

    const titleWrap = document.createElement("div");
    const titleEl = document.createElement("h3");
    titleEl.className = "manager-title";
    titleEl.textContent = item.title;
    const idLine = document.createElement("div");
    idLine.className = "manager-meta";
    idLine.innerHTML =
      `<span class="source-tag ${isDramaBox ? "dramabox" : ""}">${isDramaBox ? "DramaBox" : "PineDrama"}</span> ` +
      `<span>Thư mục ID: <code>${item.id}</code></span> · <a class="drive-link" href="${item.folderUrl}" target="_blank" rel="noopener">Mở thư mục Drive ↗</a>`;
    titleWrap.append(titleEl, idLine);

    const badge = document.createElement("span");
    const totalEp = item.episodeCount || 0;
    if (item.isComplete) {
      badge.className = "badge complete";
      badge.textContent = `Đủ bộ (${item.uploadedCount}/${totalEp} tập)`;
    } else if (item.uploadedCount > 0) {
      badge.className = "badge updating";
      badge.textContent = `Đang cập nhật (${item.uploadedCount}/${totalEp || "?"} tập)`;
    } else {
      badge.className = "badge empty";
      badge.textContent = `Chưa có video (0/${totalEp || "?"} tập)`;
    }
    head.append(titleWrap, badge);

    const bar = document.createElement("div");
    bar.className = "manager-bar";
    const fill = document.createElement("div");
    fill.className = "manager-bar-fill";
    const pct = totalEp > 0 ? Math.min(100, Math.round((item.uploadedCount / totalEp) * 100)) : item.uploadedCount > 0 ? 50 : 0;
    fill.style.width = pct + "%";
    bar.append(fill);

    const epSummary = document.createElement("div");
    epSummary.className = "manager-meta";
    const rangeStr = summarizeEpisodeRanges(item.uploadedEpisodes);
    const missingHint =
      item.nextMissingEpisode && totalEp && item.nextMissingEpisode <= totalEp
        ? ` · Cần tải tiếp: Tập ${item.nextMissingEpisode} → ${totalEp}`
        : "";
    epSummary.textContent = `Đã có trên Drive: ${rangeStr} (${formatBytes(item.totalSizeBytes)})${missingHint}`;

    // Controls for direct downloading inside Manager (Mode 1: All, Mode 2: From Ep -> To Ep)
    const controls = document.createElement("div");
    controls.className = "manager-controls";

    const dlAllBtn = document.createElement("button");
    dlAllBtn.className = "btn-sm primary";
    dlAllBtn.textContent = `Tải toàn bộ (1 → ${totalEp || "Hết"})`;

    const rangeBox = document.createElement("div");
    rangeBox.className = "manager-range-box";
    const fromIn = document.createElement("input");
    fromIn.type = "number";
    fromIn.min = "1";
    fromIn.max = String(totalEp || 5000);
    fromIn.value = String(item.nextMissingEpisode || 1);
    const toIn = document.createElement("input");
    toIn.type = "number";
    toIn.min = "1";
    toIn.max = String(totalEp || 5000);
    toIn.value = String(totalEp || Math.max(1, item.uploadedCount));
    const dlRangeBtn = document.createElement("button");
    dlRangeBtn.className = "btn-sm primary";
    dlRangeBtn.textContent = "Tải khoảng tập";
    rangeBox.append(
      document.createTextNode("Từ tập"),
      fromIn,
      document.createTextNode("đến"),
      toIn,
      dlRangeBtn
    );

    const checkUpdateBtn = document.createElement("button");
    checkUpdateBtn.className = "btn-sm detail-secondary";
    checkUpdateBtn.textContent = "Đồng bộ & Kiểm tra tập mới";

    const openDetailBtn = document.createElement("button");
    openDetailBtn.className = "btn-sm detail-secondary";
    openDetailBtn.textContent = "Xem chi tiết & Phát";

    const toggleFilesBtn = document.createElement("button");
    toggleFilesBtn.className = "btn-sm detail-secondary";
    toggleFilesBtn.textContent = `Tệp MP4 (${item.uploadedCount})`;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-sm danger";
    deleteBtn.textContent = "Xóa thư mục";

    const cardStatus = document.createElement("div");
    cardStatus.className = "detail-status";
    cardStatus.style.marginTop = "8px";

    const filesDrawer = document.createElement("div");
    filesDrawer.className = "manager-files hidden";

    controls.append(dlAllBtn, rangeBox, checkUpdateBtn, openDetailBtn, toggleFilesBtn, deleteBtn);

    const runManagerTransfer = async (mode, fromEpisode, toEpisode) => {
      dlAllBtn.disabled = true;
      dlRangeBtn.disabled = true;
      checkUpdateBtn.disabled = true;
      try {
        cardStatus.textContent = `Đang lấy danh sách tập mới nhất từ ${isDramaBox ? "DramaBox" : "PineDrama"}...`;
        const pl = await fetchEpisodesForManagedItem(item, true);
        if (pl.series) {
          if (pl.series.title) item.title = pl.series.title;
          if (pl.series.poster) item.poster = pl.series.poster;
          if (pl.series.description) item.description = pl.series.description;
          if (pl.series.genres) item.genres = pl.series.genres;
        }
        const episodes = pl.episodes || [];
        if (!episodes.length) throw Error("Nguồn phim không trả về danh sách tập");
        item.episodeCount = episodes.length;
        toIn.max = String(episodes.length);
        if (mode === "all") toEpisode = episodes.length;

        const res = await uploadSeriesEpisodesToDrive(
          item,
          episodes,
          { mode, fromEpisode, toEpisode, skipExisting: true },
          info => {
            const pText =
              info.phase === "existing"
                ? "đã có trên Drive (bỏ qua)"
                : info.phase === "done"
                  ? "hoàn tất ✓"
                  : `đang tải ngầm lên Drive (${info.percent}%)`;
            cardStatus.textContent = `[${info.index + 1}/${info.total}] Tập ${info.episode}: ${pText}`;
          }
        );
        const addedCount = res.report.filter(r => !r.skipped).length;
        const skippedCount = res.report.filter(r => r.skipped).length;
        cardStatus.textContent = `Hoàn tất! Tải mới ${addedCount} tập, bỏ qua ${skippedCount} tập đã có trong thư mục ID ${item.id}.`;
        await loadDriveManager();
      } catch (e) {
        cardStatus.textContent = "Lỗi tải: " + e.message;
      } finally {
        dlAllBtn.disabled = false;
        dlRangeBtn.disabled = false;
        checkUpdateBtn.disabled = false;
      }
    };

    dlAllBtn.onclick = () => runManagerTransfer("all", 1, item.episodeCount || 1);
    dlRangeBtn.onclick = () => runManagerTransfer("range", Number(fromIn.value), Number(toIn.value));

    checkUpdateBtn.onclick = async () => {
      checkUpdateBtn.disabled = true;
      try {
        cardStatus.textContent = `Đang đồng bộ thông tin và kiểm tra tập mới trên ${isDramaBox ? "DramaBox" : "PineDrama"}...`;
        const pl = await fetchEpisodesForManagedItem(item, true);
        if (pl.series) {
          if (pl.series.title) {
            item.title = pl.series.title;
            titleEl.textContent = item.title;
          }
          if (pl.series.poster && !item.poster) item.poster = pl.series.poster;
          if (pl.series.description) item.description = pl.series.description;
          if (pl.series.genres) item.genres = pl.series.genres;
        }
        const liveCount = pl.episodes?.length || 0;
        const prevCount = item.episodeCount || 0;
        item.episodeCount = liveCount;
        await saveSeriesMetadata(item, pl.episodes || [], item.uploadedEpisodes, item.folderId);
        toIn.max = String(liveCount);
        toIn.value = String(liveCount);
        let firstMissing = 1;
        const upSet = new Set(item.uploadedEpisodes);
        while (firstMissing <= liveCount && upSet.has(firstMissing)) firstMissing++;
        if (firstMissing <= liveCount) {
          fromIn.value = String(firstMissing);
          cardStatus.textContent =
            liveCount > prevCount
              ? `Đã đồng bộ movie.json! Phim có cập nhật mới: ${liveCount} tập (trước đó ${prevCount} tập). Đã điền sẵn Từ tập ${firstMissing} đến ${liveCount}!`
              : `Đã đồng bộ movie.json! Phim hiện có ${liveCount} tập (Còn thiếu từ tập ${firstMissing} đến ${liveCount}).`;
        } else {
          cardStatus.textContent = `Đã đồng bộ movie.json! Phim hiện có ${liveCount} tập và đã tải đủ 100% trên Google Drive!`;
        }
        dlAllBtn.textContent = `Tải toàn bộ (1 → ${liveCount})`;
      } catch (e) {
        cardStatus.textContent = "Không kiểm tra được tập mới: " + e.message;
      } finally {
        checkUpdateBtn.disabled = false;
      }
    };

    openDetailBtn.onclick = () => openMovie(item);

    toggleFilesBtn.onclick = () => {
      filesDrawer.classList.toggle("hidden");
      if (!filesDrawer.classList.contains("hidden")) {
        filesDrawer.replaceChildren();
        if (!item.uploadedFiles.length) {
          filesDrawer.textContent = "Chưa có tệp video MP4 nào trong thư mục này.";
          return;
        }
        for (const f of item.uploadedFiles) {
          const r = document.createElement("div");
          r.className = "manager-file-row";
          r.innerHTML = `<span><b>${f.name}</b> (Tập ${f.episode}) · ${formatBytes(
            f.size
          )}</span><span><a class="drive-link" href="${f.webViewLink}" target="_blank" rel="noopener">Mở trên Drive ↗</a></span>`;
          filesDrawer.append(r);
        }
      }
    };

    deleteBtn.onclick = async () => {
      if (!confirm(`Bạn có chắc muốn chuyển thư mục phim "${item.title}" (ID: ${item.id}) vào thùng rác Google Drive?`))
        return;
      deleteBtn.disabled = true;
      try {
        await deleteDriveFileOrFolder(item.folderId);
        managedItems = managedItems.filter(x => x.folderId !== item.folderId);
        renderDriveManager();
      } catch (e) {
        cardStatus.textContent = "Lỗi xóa thư mục: " + e.message;
        deleteBtn.disabled = false;
      }
    };

    body.append(head, bar, epSummary, controls, cardStatus, filesDrawer);
    card.append(posterBox, body);
    listEl.append(card);
  }
}

$("managerConnectBtn").onclick = handleConnectDrive;
$("managerRefreshBtn").onclick = loadDriveManager;
$("managerSearch").oninput = renderDriveManager;
$("managerFilter").onchange = renderDriveManager;

if ($("managerSyncMetaBtn")) {
  $("managerSyncMetaBtn").onclick = async () => {
    if (!driveConnected()) {
      await handleConnectDrive();
      return;
    }
    if (!managedItems.length) {
      await loadDriveManager();
    }
    $("managerSyncMetaBtn").disabled = true;
    try {
      let synced = 0;
      for (let i = 0; i < managedItems.length; i++) {
        const item = managedItems[i];
        $("managerStatus").textContent = `Đang đồng bộ movie.json (${i + 1}/${managedItems.length}): ${item.title} (${item.id})...`;
        try {
          const pl = await fetchEpisodesForManagedItem(item, false);
          if (pl.series) {
            if (pl.series.title) item.title = pl.series.title;
            if (pl.series.poster && !item.poster) item.poster = pl.series.poster;
            if (pl.series.description) item.description = pl.series.description;
            if (pl.series.genres) item.genres = pl.series.genres;
          }
          if (Array.isArray(pl.episodes) && pl.episodes.length) {
            item.episodeCount = pl.episodes.length;
            await saveSeriesMetadata(item, pl.episodes, item.uploadedEpisodes, item.folderId);
            synced++;
          }
        } catch {}
      }
      await loadDriveManager();
      status(`Đã đồng bộ xong dữ liệu movie.json cho ${synced}/${managedItems.length} bộ phim trên Google Drive!`);
    } finally {
      $("managerSyncMetaBtn").disabled = false;
    }
  };
}

$("managerOpenById").onclick = async () => {
  const rawInput = ($("managerQuickId").value || "").trim();
  const extractedBookId = extractDramaBoxBookId(rawInput);
  const rawId = extractedBookId || rawInput;
  if (!/^[a-zA-Z0-9_-]{2,90}$/.test(rawId)) {
    status("Vui lòng nhập ID phim hợp lệ (PineDrama Collection ID hoặc DramaBox Book ID).", true);
    return;
  }
  const existing =
    movies.find(m => m.id === rawId) ||
    ddState.movies.find(m => m.id === rawId) ||
    managedItems.find(m => m.id === rawId);
  if (existing) {
    await openMovie(existing);
    return;
  }
  const guessedSource = inferSourceById(rawId);
  try {
    status(`Đang kiểm tra phim ID ${rawId} (${guessedSource === "dramabox" ? "DramaBox" : "PineDrama"})...`);
    if (guessedSource === "dramabox") {
      const pl = await api(`/dramabox/series/${encodeURIComponent(rawId)}/episodes`);
      await openMovie({
        id: rawId,
        source: "dramabox",
        platform: "dramabox",
        title: pl.series?.title || `Phim DramaBox #${rawId}`,
        description: pl.series?.description || "",
        genres: pl.series?.genres || "",
        poster: pl.series?.poster || null,
        episodeCount: pl.episodes?.length || null
      });
    } else {
      const pl = await api(`/series/${encodeURIComponent(rawId)}/episodes`);
      await openMovie({
        id: rawId,
        source: "pinedrama",
        platform: "pinedrama",
        title: `Phim PineDrama #${rawId}`,
        episodeCount: pl.episodes?.length || null,
        description: "Mở trực tiếp theo Collection ID để xem và tải lên Google Drive."
      });
    }
  } catch (e) {
    status("Không tìm thấy hoặc không tải được phim ID " + rawId + ": " + e.message, true);
  }
};

// ==================== GOOGLE DRIVE CONFIG TAB ====================
$("googleConnect").onclick = handleConnectDrive;
$("googleDisconnect").onclick = () => {
  disconnectDrive();
  updateDriveConnectionUI();
  status("Đã ngắt kết nối phiên Google Drive.");
};
$("saveClientId").onclick = () => {
  const val = ($("customClientId").value || "").trim();
  if (val) {
    localStorage.setItem("pws_google_client_id", val);
    status("Đã lưu Google OAuth Client ID. Nhấn 'Kết nối Google Drive' để đăng nhập.");
  } else {
    localStorage.removeItem("pws_google_client_id");
    status("Đã xóa Client ID tùy chỉnh.");
  }
};
$("applyAccessToken").onclick = async () => {
  const raw = ($("manualAccessToken").value || "").trim();
  if (!raw) return;
  try {
    await setDriveToken(raw);
    $("manualAccessToken").value = "";
    updateDriveConnectionUI();
    status("Đã liên kết Google Drive bằng Access Token và tạo thư mục PineDrama-Library!");
  } catch (e) {
    status("Lỗi Access Token: " + e.message, true);
  }
};

$("driveUpload").onclick = async () => {
  const files = [...$("driveFiles").files];
  if (!files.length) return;
  $("driveUpload").disabled = true;
  try {
    for (const file of files) {
      $("uploadStatus").textContent = "Đang tải: " + file.name;
      await uploadToDrive(file, pct => ($("uploadStatus").textContent = "Đang tải " + file.name + ": " + pct + "%"));
      $("uploadStatus").textContent = "Đã tải lên Drive: " + file.name;
    }
    $("driveFiles").value = "";
  } catch (e) {
    $("uploadStatus").textContent = "Lỗi: " + e.message;
  } finally {
    $("driveUpload").disabled = false;
  }
};

$("refresh").onclick = loadCatalog;
$("search").oninput = renderMovies;
$("count").onchange = loadCatalog;
$("feed").onchange = switchFeed;
$("loadMore").onclick = () => fetchLibraryPage(true);
$("logout").onclick = async () => {
  await api("/logout", { method: "POST" });
  location.reload();
};

auth().catch(e => ($("error").textContent = e.message));
