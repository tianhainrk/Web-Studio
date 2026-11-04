import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inferSourceById } from "../public/drive-transfer.js";
import {
  parseHeatScore,
  normalizeDramaBoxMovie,
  fetchDramaBoxCategories,
  validDramaBoxId,
  discoverDramaBoxLibrary,
  resolveDramaBoxTarget
} from "../src/dramabox-provider.mjs";

test("inferSourceById distinguishes 11-digit DramaBox Book IDs from 19-digit PineDrama Collection IDs", () => {
  assert.equal(inferSourceById("42000009080"), "dramabox");
  assert.equal(inferSourceById("41000102902"), "dramabox");
  assert.equal(inferSourceById("7698688530096116744"), "pinedrama");
  assert.equal(inferSourceById("7698688530096116744", "dramabox"), "dramabox");
});

test("parseHeatScore parses Vietnamese and international heat strings accurately", () => {
  assert.equal(parseHeatScore("14.5K"), 14500);
  assert.equal(parseHeatScore("2.3M"), 2300000);
  assert.equal(parseHeatScore("1,5Tr"), 1500000);
  assert.equal(parseHeatScore(98000), 98000);
});

test("normalizeDramaBoxMovie normalizes cover, episode count, heatScore, and genres", () => {
  const movie = normalizeDramaBoxMovie(
    {
      bookId: "42000009080",
      bookName: "Ẩn Hôn Ngọt Sủng",
      coverWap: "https://hwztchapter.dramaboxdb.com/cover.jpg",
      chapterCount: 85,
      introduction: "Mô tả phim",
      tags: ["Ngọt sủng", "Tổng tài"],
      rankVo: { hotCode: "125.4K", sort: 2 }
    },
    0
  );
  assert.equal(movie.id, "42000009080");
  assert.equal(movie.source, "dramabox");
  assert.equal(movie.title, "Ẩn Hôn Ngọt Sủng");
  assert.equal(movie.episodeCount, 85);
  assert.equal(movie.heatScore, 125400);
  assert.equal(movie.rankNumber, 2);
  assert.match(movie.genres, /Ngọt sủng/);
});

test("fetchDramaBoxCategories includes Vietnamese categories and dubbed options", async () => {
  const cats = await fetchDramaBoxCategories("vi");
  assert.ok(cats.length >= 3);
  assert.ok(cats.some(c => c.id === "all"));
  assert.ok(cats.some(c => c.id === "dubbed_hot"));
});

test("index.html renders DramaDownloader -> Drive inline as a native tab, includes fallback link input, and removes autoInspect button", () => {
  const indexHtml = fs.readFileSync(path.resolve("public/index.html"), "utf8");
  assert.match(indexHtml, /data-tab="dramadownloader"/);
  assert.match(indexHtml, /id="ddDirectLinkInput"/);
  assert.match(indexHtml, /id="ddDirectLinkOpenBtn"/);
  assert.doesNotMatch(indexHtml, /<a[^>]+href="\/dramadownloader-import\.html"[^>]*>DramaDownloader/);
  assert.doesNotMatch(indexHtml, /id="autoInspect"/);

  const importHtml = fs.readFileSync(path.resolve("public/dramadownloader-import.html"), "utf8");
  assert.doesNotMatch(importHtml, /id="autoInspect"/);
  assert.doesNotMatch(importHtml, /Tự động lấy tập/);
});

test("validDramaBoxId extracts Book ID from various DramaBox URLs and share texts", () => {
  assert.equal(validDramaBoxId("42000032308"), "42000032308");
  assert.equal(validDramaBoxId("https://www.dramaboxdb.com/vi/movie/42000032308/nha-tu-tu-than"), "42000032308");
  assert.equal(validDramaBoxId("https://www.dramaboxdb.com/ep/42000032308_nha-tu/590123"), "42000032308");
  assert.equal(validDramaBoxId("https://app.dramaboxdb.com/share?bookId=42000032308&lang=vi"), "42000032308");
  assert.equal(validDramaBoxId("dramabox:42000032308"), "42000032308");
});

test("DramaBox search finds '(lồng tiếng)nhà tù tử thần: chinh phục nữ cai ngục' and resolveDramaBoxTarget resolves by link", async () => {
  const searchRes = await discoverDramaBoxLibrary({
    feed: "search",
    query: "(lồng tiếng)nhà tù tử thần: chinh phục nữ cai ngục",
    lang: "vi"
  });
  assert.ok(searchRes.movies.length >= 1);
  assert.equal(searchRes.movies[0].id, "42000032308");
  assert.match(searchRes.movies[0].title, /Nhà Tù Tử Thần/i);

  const resolved = await resolveDramaBoxTarget(
    "https://www.dramaboxdb.com/vi/movie/42000032308/nha-tu-tu-than-chinh-phuc-nu-cai-nguc"
  );
  assert.equal(resolved.id, "42000032308");
  assert.equal(resolved.episodes.length, 50);
  assert.ok(resolved.episodes[0].url);
});
