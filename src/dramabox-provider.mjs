// DramaBox catalog, search, ranking, categories & episode stream provider
// Powered by the same upstream aggregators as DramaDownloader (webfic + goodbos).

export const DRAMABOX_FEEDS = Object.freeze(["hot", "new", "ranking", "categories", "search"]);

const GOODBOS_BASE = "https://dramabox.goodbos.online";
const GOODBOS_TOKEN = process.env.GOODBOS_TOKEN || "6EB57533425BC1D78ADA1F80354161D4";
const WEBFIC_BASE = "https://www.webfic.com/webfic";
const TIMEOUT_MS = 15000;

const categoriesCache = new Map();
const seriesCache = new Map();
const fullCatalogCache = new Map();

export function validDramaBoxId(raw) {
  const s = String(raw ?? "").trim();
  if (/^[1-9]\d{4,18}$/.test(s)) return s;
  const m =
    s.match(/[?&](?:bookId|book_id|id|bid|series_id)=(\d{5,19})\b/i) ||
    s.match(/\/(?:movie|drama|detail|ep|video|play)[\/-](\d{5,19})(?:[\/?_#-]|$)/i) ||
    s.match(/dramabox:(\d{5,19})/i) ||
    s.match(/\b(4[12]00\d{7})\b/);
  return m ? m[1] : null;
}

export function normalizeVietnameseSearchText(str) {
  return String(str || "")
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/\(lồng tiếng\)|\[lồng tiếng\]/gi, " lồng tiếng ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripVietnameseTones(str) {
  return normalizeVietnameseSearchText(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCompactNumber(val) {
  if (typeof val === "number" && Number.isFinite(val)) return Math.round(val);
  if (typeof val !== "string") return null;
  const s = val.trim().toUpperCase();
  if (!s) return null;
  const m = /^([\d.,]+)\s*([KMBT]|TR)?$/i.exec(s);
  if (!m) {
    const digits = Number(s.replace(/[^\d]/g, ""));
    return Number.isFinite(digits) && digits > 0 ? digits : null;
  }
  const num = Number(m[1].replace(/,/g, "."));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] || "").toUpperCase();
  if (unit === "K") return Math.round(num * 1e3);
  if (unit === "M" || unit === "TR") return Math.round(num * 1e6);
  if (unit === "B" || unit === "T") return Math.round(num * 1e9);
  return Math.round(num);
}

export const parseHeatScore = parseCompactNumber;

function cleanPosterUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function normalizeDramaBoxMovie(raw, index = null) {
  if (!raw || typeof raw !== "object") return null;
  const id = validDramaBoxId(raw.bookId ?? raw.action ?? raw.id);
  const title = String(raw.bookName || raw.name || raw.title || "").trim();
  if (!id || !title) return null;

  const poster = cleanPosterUrl(raw.cover || raw.coverWap || raw.bookCover);
  const episodeCount = Number(raw.chapterCount ?? raw.totalChapterNum ?? raw.episodeCount ?? 0) || null;
  const description = String(raw.introduction || raw.desc || "").trim();

  let tags = [];
  if (Array.isArray(raw.tags) && raw.tags.length) {
    tags = raw.tags.map(t => (typeof t === "string" ? t.trim() : t?.tagName || "")).filter(Boolean);
  } else if (Array.isArray(raw.tagV3s) && raw.tagV3s.length) {
    tags = raw.tagV3s.map(t => t?.tagName || "").filter(Boolean);
  } else if (Array.isArray(raw.typeTwoNames) && raw.typeTwoNames.length) {
    tags = raw.typeTwoNames.map(String).filter(Boolean);
  } else if (Array.isArray(raw.labels) && raw.labels.length) {
    tags = raw.labels.map(String).filter(Boolean);
  }

  const viewsText = String(raw.playCount || raw.viewCountDisplay || "").trim() || null;
  const viewCount =
    typeof raw.viewCount === "number" && raw.viewCount > 0
      ? raw.viewCount
      : parseCompactNumber(viewsText);

  const hotCode = raw.rankVo?.hotCode ? String(raw.rankVo.hotCode).trim() : null;
  const heatScore = parseCompactNumber(hotCode) ?? (typeof raw.followCount === "number" ? raw.followCount : null);
  const badgeText =
    raw.corner?.name ||
    raw.rankVo?.recCopy ||
    (raw.lastUpdateTimeDisplay && raw.lastUpdateTimeDisplay !== "Completed" ? raw.lastUpdateTimeDisplay : null);

  const rankNumber = raw.rankVo?.sort ?? (index != null ? index + 1 : null);
  return {
    id,
    source: "dramabox",
    platform: "dramabox",
    title,
    poster,
    episodeCount,
    description,
    genres: tags.join(" · "),
    tags,
    viewCount,
    viewsText,
    heatScore,
    hotCode,
    rankSort: rankNumber,
    rankNumber,
    badgeText,
    shelfTime: raw.shelfTime || raw.bookShelfTime || raw.firstShelfTime || null,
    status: raw.status || null
  };
}

async function fetchGoodbos(path, params = {}) {
  const url = new URL("/api/dramabox/" + path.replace(/^\/+/, ""), GOODBOS_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "okhttp/4.10.0",
      "Accept": "application/json",
      "x-token": GOODBOS_TOKEN
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw Error(`Goodbos HTTP ${res.status}`);
  return res.json();
}

async function fetchWebfic(path, body = {}, lang = "vi") {
  const url = `${WEBFIC_BASE}/${path.replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "pline": "DRAMABOX",
      "language": lang
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw Error(`Webfic HTTP ${res.status}`);
  return res.json();
}

function dedupeMovies(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const m = item?.id && item?.source === "dramabox" ? item : normalizeDramaBoxMovie(item, out.length);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

export async function fetchDramaBoxCategories(lang = "vi") {
  const cached = categoriesCache.get(lang);
  if (cached && Date.now() - cached.time < 600000) return cached.value;

  const baseCategories = [
    { id: "all", name: "Tất cả thể loại", title: "Tất cả thể loại" },
    { id: "dubbed_hot", name: "🎙️ Lồng tiếng Việt (Phổ biến)", title: "🎙️ Lồng tiếng Việt (Phổ biến)" },
    { id: "dubbed_new", name: "🎙️ Lồng tiếng Việt (Mới nhất)", title: "🎙️ Lồng tiếng Việt (Mới nhất)" }
  ];

  try {
    const res = await fetchWebfic("home/browse", { typeTwoId: 0, pageNo: 1, pageSize: 12 }, lang);
    const types = Array.isArray(res?.data?.types) ? res.data.types : [];
    const seen = new Set(baseCategories.map(c => c.id));
    for (const t of types) {
      const id = String(t?.id ?? "").trim();
      const title = String(t?.name ?? "").trim();
      if (!id || !title || id === "0" || seen.has(id)) continue;
      seen.add(id);
      baseCategories.push({ id, name: title, title });
    }
    categoriesCache.set(lang, { time: Date.now(), value: baseCategories });
  } catch {}
  return baseCategories;
}

export async function getFullDramaBoxCatalogIndex(lang = "vi") {
  const cached = fullCatalogCache.get(lang);
  if (cached && Date.now() - cached.time < 600000) return cached.value;

  const tasks = [
    ...[1, 2, 3, 4].map(pageNo =>
      fetchWebfic("home/browse", { typeTwoId: 0, pageNo, pageSize: 100 }, lang)
        .then(r => (Array.isArray(r?.data?.bookList) ? r.data.bookList : []))
        .catch(() => [])
    ),
    fetchWebfic("home/index", {}, lang)
      .then(r => {
        const out = [];
        for (const sec of Array.isArray(r?.data) ? r.data : []) {
          if (Array.isArray(sec?.items)) out.push(...sec.items);
        }
        return out;
      })
      .catch(() => []),
    fetchGoodbos("foryou", { lang }).catch(() => []),
    fetchGoodbos("trending", { lang }).catch(() => []),
    fetchGoodbos("latest", { lang }).catch(() => []),
    fetchGoodbos("populersearch", { lang }).catch(() => []),
    fetchGoodbos("dubbed", { classify: "terpopuler", page: 1, lang }).catch(() => []),
    fetchGoodbos("dubbed", { classify: "terpopuler", page: 2, lang }).catch(() => []),
    fetchGoodbos("dubbed", { classify: "terbaru", page: 1, lang }).catch(() => []),
    fetchGoodbos("dubbed", { classify: "terbaru", page: 2, lang }).catch(() => []),
    fetchGoodbos("browse", { page: 1, lang })
      .then(r => (Array.isArray(r?.items) ? r.items : []))
      .catch(() => [])
  ];

  const groups = await Promise.all(tasks);
  const raw = [];
  for (const g of groups) {
    if (Array.isArray(g)) raw.push(...g);
  }
  const movies = dedupeMovies(raw);
  if (movies.length > 0) {
    fullCatalogCache.set(lang, { time: Date.now(), value: movies });
  }
  return movies;
}

export async function discoverDramaBoxLibrary({
  feed = "hot",
  subType = "",
  categoryId = "0",
  page = 1,
  query = "",
  lang = "vi"
} = {}) {
  const pageNo = Math.max(1, Math.min(500, Number(page) || 1));

  // 1. SEARCH FEED
  if (feed === "search" || (query && query.trim().length > 0)) {
    const q = String(query || "").trim();
    if (!q) return { movies: [], page: 1, serverHasMore: false };

    const directId = validDramaBoxId(q);
    const wantsDubbed = /lồng\s*tiếng|long\s*tieng|thuyết\s*minh|dubbed/i.test(q);
    const cleanedQuery = q
      .replace(/\(lồng\s*tiếng\)|\[lồng\s*tiếng\]|lồng\s*tiếng/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const searchQueries = new Set([cleanedQuery || q]);
    if (cleanedQuery.includes(":")) {
      for (const part of cleanedQuery.split(":")) {
        const p = part.trim();
        if (p.length >= 3) searchQueries.add(p);
      }
    }

    const tasks = [
      getFullDramaBoxCatalogIndex(lang).catch(() => []),
      ...[...searchQueries].slice(0, 3).map(sq => fetchGoodbos("search", { query: sq, lang }).catch(() => []))
    ];

    if (directId && pageNo === 1) {
      tasks.unshift(
        Promise.all([
          fetchGoodbos("detail", { bookId: directId, lang }).catch(() => null),
          fetchWebfic("book/detail", { bookId: directId }, lang).catch(() => null),
          fetchGoodbos("allepisode", { bookId: directId }).catch(() => null)
        ]).then(([gbDet, wfDet, eps]) => {
          const wfBook = wfDet?.data?.book || {};
          const gbBook = gbDet && typeof gbDet === "object" && !Array.isArray(gbDet) ? gbDet : {};
          const epLen = Array.isArray(eps) ? eps.length : 0;
          if (!gbBook.bookName && !wfBook.bookName && !epLen) return null;
          return {
            bookId: directId,
            bookName: gbBook.bookName || wfBook.bookName || `Phim DramaBox #${directId}`,
            cover: gbBook.coverWap || gbBook.cover || wfBook.cover || null,
            chapterCount: epLen || gbBook.chapterCount || wfBook.chapterCount || null,
            introduction: gbBook.introduction || wfBook.introduction || "",
            tags: gbBook.tags || wfBook.tags || wfBook.typeTwoNames || []
          };
        })
      );
    }

    const results = await Promise.all(tasks);
    const rawItems = [];
    for (const r of results) {
      if (!r) continue;
      if (Array.isArray(r)) rawItems.push(...r);
      else if (r?.bookId || r?.id) rawItems.push(r);
    }
    const candidates = dedupeMovies(rawItems);

    const normFull = normalizeVietnameseSearchText(q);
    const normCore = normalizeVietnameseSearchText(cleanedQuery || q);
    const stripCore = stripVietnameseTones(cleanedQuery || q);
    const coreTokens = normCore.split(" ").filter(t => t.length >= 2);
    const stripTokens = stripCore.split(" ").filter(t => t.length >= 2);

    const scored = [];
    for (const m of candidates) {
      if (directId && m.id === directId) {
        scored.push({ movie: m, score: 2000 });
        continue;
      }
      const titleNorm = normalizeVietnameseSearchText(m.title);
      const titleCore = normalizeVietnameseSearchText(
        m.title.replace(/\(lồng\s*tiếng\)|\[lồng\s*tiếng\]/gi, " ")
      );
      const titleStrip = stripVietnameseTones(m.title);
      const isMovieDubbed = /lồng\s*tiếng|dubbed/i.test(m.title);

      let score = 0;
      if (normFull && titleNorm === normFull) {
        score = 1200;
      } else if (normCore && titleCore === normCore) {
        score = 1000;
      } else if (normCore && titleCore.includes(normCore)) {
        score = 850;
      } else if (stripCore && titleStrip.includes(stripCore)) {
        score = 750;
      } else if (coreTokens.length > 0) {
        const matchedExact = coreTokens.filter(tk => titleCore.includes(tk)).length;
        const matchedStrip = stripTokens.filter(tk => titleStrip.includes(tk)).length;
        const ratio = Math.max(matchedExact / coreTokens.length, matchedStrip / Math.max(1, stripTokens.length));
        if (matchedExact === coreTokens.length) {
          score = 600;
        } else if (matchedStrip === stripTokens.length) {
          score = 500;
        } else if (ratio >= 0.6 && matchedStrip >= 2) {
          score = Math.round(ratio * 350);
        } else if (coreTokens.length === 1 && matchedStrip === 1) {
          score = 300;
        }
      }

      if (score > 0) {
        if (wantsDubbed && isMovieDubbed) score += 120;
        else if (!wantsDubbed && !isMovieDubbed) score += 15;
        scored.push({ movie: m, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const movies = scored.map(x => x.movie);

    return {
      feed: "search",
      query: q,
      movies,
      page: 1,
      serverHasMore: false
    };
  }

  // 2. RANKING FEED (3 charts: Bảng phim hot, Bảng tìm kiếm hot, Bảng phim mới)
  if (feed === "ranking") {
    const rankChart = ["hot", "search", "new"].includes(subType) ? subType : "hot";
    const endpointMap = {
      hot: "trending",
      search: "populersearch",
      new: "latest"
    };
    let rawList = [];
    try {
      const data = await fetchGoodbos(endpointMap[rankChart], { lang });
      if (Array.isArray(data)) rawList = data;
    } catch {}

    if (!rawList.length) {
      const fallback = await fetchWebfic("home/index", {}, lang).catch(() => null);
      const sections = Array.isArray(fallback?.data) ? fallback.data : [];
      for (const sec of sections) {
        if (Array.isArray(sec?.items)) rawList.push(...sec.items);
      }
    }

    const movies = dedupeMovies(rawList).map((m, idx) => ({
      ...m,
      rankSort: idx + 1,
      rankNumber: idx + 1
    }));

    return {
      feed: "ranking",
      subType: rankChart,
      subTabs: [
        { id: "hot", title: "🔥 Bảng Phim Hot" },
        { id: "search", title: "🔍 Bảng Tìm Kiếm Hot" },
        { id: "new", title: "🆕 Bảng Phim Mới" }
      ],
      movies,
      page: 1,
      serverHasMore: false
    };
  }

  // 3. NEW FEED (Đã ra mắt & Sắp ra mắt)
  if (feed === "new") {
    const mode = subType === "upcoming" ? "upcoming" : "released";
    const newSubTabs = [
      { id: "released", title: "✅ Đã ra mắt" },
      { id: "upcoming", title: "⏳ Sắp ra mắt" }
    ];
    if (mode === "upcoming") {
      const [latestRes, browseRes, webficRes] = await Promise.all([
        pageNo === 1 ? fetchGoodbos("latest", { lang }).catch(() => []) : Promise.resolve([]),
        fetchGoodbos("browse", { page: pageNo, lang }).catch(() => null),
        fetchWebfic("home/browse", { typeTwoId: 0, pageNo: pageNo + 1, pageSize: 24 }, lang).catch(() => null)
      ]);
      const combined = [];
      if (Array.isArray(latestRes)) combined.push(...latestRes);
      if (Array.isArray(browseRes?.items)) combined.push(...browseRes.items);
      if (Array.isArray(webficRes?.data?.bookList)) {
        const upcomingWebfic = webficRes.data.bookList.filter(
          b => b.lastUpdateTimeDisplay !== "Completed" || Number(b.bookId) >= 42000025000
        );
        combined.push(...(upcomingWebfic.length ? upcomingWebfic : webficRes.data.bookList));
      }
      const movies = dedupeMovies(combined).map(m => ({
        ...m,
        isUpcoming: true,
        badgeText: m.badgeText || "Sắp ra mắt / Mới"
      }));
      return {
        feed: "new",
        subType: "upcoming",
        subTabs: newSubTabs,
        movies,
        page: pageNo,
        serverHasMore: movies.length > 0 && pageNo < 30
      };
    }

    // mode === "released" (Đã ra mắt)
    const [latestList, dubbedNew, webficBrowse] = await Promise.all([
      pageNo === 1 ? fetchGoodbos("latest", { lang }).catch(() => []) : Promise.resolve([]),
      fetchGoodbos("dubbed", { classify: "terbaru", page: pageNo, lang }).catch(() => []),
      fetchWebfic("home/browse", { typeTwoId: 0, pageNo, pageSize: 20 }, lang).catch(() => null)
    ]);
    const raw = [];
    if (Array.isArray(latestList)) raw.push(...latestList);
    if (Array.isArray(dubbedNew)) raw.push(...dubbedNew);
    if (Array.isArray(webficBrowse?.data?.bookList)) raw.push(...webficBrowse.data.bookList);
    const movies = dedupeMovies(raw);
    const totalPages = Number(webficBrowse?.data?.pages || 50);
    return {
      feed: "new",
      subType: "released",
      subTabs: newSubTabs,
      movies,
      page: pageNo,
      serverHasMore: pageNo < totalPages && movies.length > 0
    };
  }

  // 4. CATEGORIES FEED (Danh mục thể loại như trong app)
  if (feed === "categories") {
    const categories = await fetchDramaBoxCategories(lang);
    const catId = String(categoryId || "0").trim();

    if (catId === "dubbed_hot" || catId === "dubbed_new") {
      const classify = catId === "dubbed_hot" ? "terpopuler" : "terbaru";
      const list = await fetchGoodbos("dubbed", { classify, page: pageNo, lang }).catch(() => []);
      const movies = dedupeMovies(Array.isArray(list) ? list : []);
      return {
        feed: "categories",
        categoryId: catId,
        categories,
        movies,
        page: pageNo,
        serverHasMore: movies.length >= 10
      };
    }

    const typeTwoId = /^\d+$/.test(catId) ? Number(catId) : 0;
    const res = await fetchWebfic("home/browse", { typeTwoId, pageNo, pageSize: 24 }, lang);
    const bookList = Array.isArray(res?.data?.bookList) ? res.data.bookList : [];
    const totalPages = Number(res?.data?.pages || 1);
    const total = Number(res?.data?.total || bookList.length);
    const movies = dedupeMovies(bookList);

    return {
      feed: "categories",
      categoryId: catId,
      categories,
      movies,
      page: pageNo,
      totalPages,
      total,
      serverHasMore: pageNo < totalPages && movies.length > 0
    };
  }

  // 5. DEFAULT: HOT / HOME FEED (Phim Hot & Đề xuất)
  if (pageNo === 1) {
    const [forYou, homeIndex, browse1] = await Promise.all([
      fetchGoodbos("foryou", { lang }).catch(() => []),
      fetchWebfic("home/index", {}, lang).catch(() => null),
      fetchGoodbos("browse", { page: 1, lang }).catch(() => null)
    ]);
    const raw = [];
    if (Array.isArray(forYou)) raw.push(...forYou);
    if (Array.isArray(homeIndex?.data)) {
      for (const sec of homeIndex.data) {
        if (Array.isArray(sec?.items)) raw.push(...sec.items);
      }
    }
    if (Array.isArray(browse1?.items)) raw.push(...browse1.items);
    const movies = dedupeMovies(raw);
    return {
      feed: "hot",
      movies,
      page: 1,
      serverHasMore: true
    };
  }

  const [browsePage, webficPage] = await Promise.all([
    fetchGoodbos("browse", { page: pageNo, lang }).catch(() => null),
    fetchWebfic("home/browse", { typeTwoId: 0, pageNo, pageSize: 20 }, lang).catch(() => null)
  ]);
  const raw = [];
  if (Array.isArray(browsePage?.items)) raw.push(...browsePage.items);
  if (Array.isArray(webficPage?.data?.bookList)) raw.push(...webficPage.data.bookList);
  const movies = dedupeMovies(raw);
  return {
    feed: "hot",
    movies,
    page: pageNo,
    serverHasMore: Boolean(browsePage?.hasNext) || movies.length >= 15
  };
}

export async function getDramaBoxSeriesPlaylist(rawBookId, { lang = "vi", refresh = false } = {}) {
  const bookId = validDramaBoxId(rawBookId);
  if (!bookId) throw Error("Book ID DramaBox không hợp lệ");

  const cacheKey = `${bookId}:${lang}`;
  if (!refresh && seriesCache.has(cacheKey)) {
    const cached = seriesCache.get(cacheKey);
    if (Date.now() - cached.time < 120000) return cached.value;
  }

  const [allEpisodesRaw, detailGoodbos, detailWebfic] = await Promise.all([
    fetchGoodbos("allepisode", { bookId }).catch(() => null),
    fetchGoodbos("detail", { bookId, lang }).catch(() => null),
    fetchWebfic("book/detail", { bookId }, lang).catch(() => null)
  ]);

  const wfBook = detailWebfic?.data?.book || {};
  const gbBook = detailGoodbos && typeof detailGoodbos === "object" && !Array.isArray(detailGoodbos) ? detailGoodbos : {};

  const movieMeta = normalizeDramaBoxMovie({
    bookId,
    bookName: gbBook.bookName || wfBook.bookName || `DramaBox #${bookId}`,
    cover: gbBook.coverWap || gbBook.cover || wfBook.cover,
    chapterCount:
      (Array.isArray(allEpisodesRaw) && allEpisodesRaw.length) ||
      gbBook.chapterCount ||
      wfBook.chapterCount ||
      0,
    introduction: gbBook.introduction || wfBook.introduction || "",
    tags: gbBook.tags || wfBook.tags || wfBook.typeTwoNames || [],
    playCount: gbBook.playCount || wfBook.viewCountDisplay || null,
    viewCount: wfBook.viewCount || null
  });

  if (!Array.isArray(allEpisodesRaw) || !allEpisodesRaw.length) {
    throw Error("Không lấy được danh sách tập từ DramaBox cho phim ID " + bookId);
  }

  const seenNums = new Set();
  const episodes = [];
  for (let i = 0; i < allEpisodesRaw.length; i++) {
    const item = allEpisodesRaw[i];
    if (!item || typeof item !== "object") continue;
    const epNum = Number.isInteger(item.chapterIndex) ? item.chapterIndex + 1 : i + 1;
    if (epNum < 1 || epNum > 5000 || seenNums.has(epNum)) continue;
    seenNums.add(epNum);

    const url1080 = cleanPosterUrl(item.videoUrl1080);
    const url720 = cleanPosterUrl(item.videoUrl720 || item.videoUrl);
    const url540 = cleanPosterUrl(item.videoUrl540);
    const bestUrl = url1080 || url720 || url540 || null;

    episodes.push({
      id: String(item.chapterId || epNum),
      seriesId: bookId,
      number: epNum,
      title: String(item.chapterName || `Tập ${epNum}`).trim(),
      locked: !Boolean(bestUrl),
      isCharge: Number(item.isCharge || 0),
      url: bestUrl,
      qualities: {
        "1080p": url1080,
        "720p": url720,
        "540p": url540
      }
    });
  }

  episodes.sort((a, b) => a.number - b.number);
  if (movieMeta) movieMeta.episodeCount = episodes.length;

  const resolvedMeta = movieMeta || {
    id: bookId,
    source: "dramabox",
    platform: "dramabox",
    title: `DramaBox #${bookId}`,
    episodeCount: episodes.length
  };
  const result = {
    id: bookId,
    source: "dramabox",
    platform: "dramabox",
    movie: resolvedMeta,
    series: resolvedMeta,
    episodes
  };

  seriesCache.set(cacheKey, { time: Date.now(), value: result });
  return result;
}

export async function resolveDramaBoxTarget(rawTarget, { lang = "vi" } = {}) {
  const input = String(rawTarget ?? "").trim();
  if (!input) throw Error("Vui lòng nhập link phim hoặc Book ID DramaBox");

  // 1. Direct Book ID extraction from input or URL
  let bookId = validDramaBoxId(input);

  // 2. If input contains a shortlink / share URL without an explicit bookId, follow redirects to inspect Location
  if (!bookId) {
    const urlMatch = input.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch) {
      let currentUrl = urlMatch[0];
      for (let hop = 0; hop < 5; hop++) {
        bookId = validDramaBoxId(currentUrl);
        if (bookId) break;
        try {
          const parsed = new URL(currentUrl);
          if (parsed.protocol !== "https:") break;
          const res = await fetch(currentUrl, {
            method: "GET",
            redirect: "manual",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            },
            signal: AbortSignal.timeout(8000)
          });
          const loc = res.headers.get("location");
          if (loc) {
            currentUrl = new URL(loc, currentUrl).href;
            bookId = validDramaBoxId(currentUrl);
            if (bookId) break;
            continue;
          }
          const html = await res.text().catch(() => "");
          bookId = validDramaBoxId(html);
          break;
        } catch {
          break;
        }
      }
    }
  }

  // 3. If still no Book ID, try extracting slug from URL or using input as title query
  if (!bookId) {
    let queryCandidate = input.replace(/https?:\/\/[^\s"'<>]+/gi, " ").trim();
    if (!queryCandidate) {
      try {
        const u = new URL(input.match(/https?:\/\/[^\s"'<>]+/i)?.[0] || "");
        const segs = u.pathname.split("/").filter(Boolean);
        const lastSeg = segs[segs.length - 1] || "";
        queryCandidate = lastSeg.replace(/[-_]+/g, " ").trim();
      } catch {}
    }
    if (queryCandidate) {
      const searchRes = await discoverDramaBoxLibrary({ feed: "search", query: queryCandidate, lang });
      if (searchRes.movies?.length) {
        bookId = searchRes.movies[0].id;
      }
    }
  }

  if (!bookId) {
    throw Error("Không nhận diện được Book ID từ link/nội dung đã nhập. Hãy kiểm tra lại link hoặc nhập trực tiếp Book ID.");
  }

  return getDramaBoxSeriesPlaylist(bookId, { lang });
}
