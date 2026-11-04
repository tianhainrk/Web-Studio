import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLicensedManifest,
  selectEpisodesForTransfer,
  formatEpisodeFileName,
  parseEpisodeFileName
} from "../public/drive-transfer.js";

const urls = Array.from({ length: 3 }, (_, i) => ({
  episode: i + 1,
  url: "https://media.example.com/ep" + (i + 1) + ".mp4"
}));

const sampleEpisodes = Array.from({ length: 10 }, (_, i) => ({
  id: String(7698688703505468000n + BigInt(i + 1)),
  seriesId: "7698688530096116744",
  number: i + 1,
  locked: false
}));

test("licensed transfer requires a full consecutive manifest", () => {
  const result = validateLicensedManifest(urls, 3);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(x => x.episode), [1, 2, 3]);
});

test("reordering manifest still produces canonical episode order", () => {
  const result = validateLicensedManifest(urls.slice().reverse(), 3);
  assert.deepEqual(result.map(x => x.episode), [1, 2, 3]);
});

test("duplicate, missing, or extra episodes are rejected", () => {
  assert.throws(() => validateLicensedManifest([urls[0], urls[0], urls[1]], 3));
  assert.throws(() => validateLicensedManifest(urls.slice(1), 3));
  assert.throws(() => validateLicensedManifest([...urls, ...urls], 3));
});

test("remote URLs must be public HTTPS and cannot be HLS playlists", () => {
  for (const href of [
    "http://media.example.com/ep.mp4",
    "https://localhost/ep.mp4",
    "https://192.168.1.1/ep.mp4",
    "https://media.example.com/playlist.m3u8"
  ]) {
    assert.throws(() => validateLicensedManifest([{ episode: 1, url: href }], 1), href);
  }
});

test("mode 'all' selects all episodes in ascending order", () => {
  const reversed = sampleEpisodes.slice().reverse();
  const selected = selectEpisodesForTransfer(reversed, { mode: "all" });
  assert.equal(selected.length, 10);
  assert.deepEqual(selected.map(e => e.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("mode 'range' selects exact fromEpisode..toEpisode range for ongoing series", () => {
  const selected = selectEpisodesForTransfer(sampleEpisodes, {
    mode: "range",
    fromEpisode: 4,
    toEpisode: 8
  });
  assert.deepEqual(selected.map(e => e.number), [4, 5, 6, 7, 8]);

  const single = selectEpisodesForTransfer(sampleEpisodes, {
    mode: "range",
    fromEpisode: 10,
    toEpisode: 10
  });
  assert.deepEqual(single.map(e => e.number), [10]);
});

test("mode 'range' rejects out-of-bounds or inverted episode ranges", () => {
  assert.throws(() => selectEpisodesForTransfer(sampleEpisodes, { mode: "range", fromEpisode: 6, toEpisode: 3 }));
  assert.throws(() => selectEpisodesForTransfer(sampleEpisodes, { mode: "range", fromEpisode: 0, toEpisode: 5 }));
  assert.throws(() => selectEpisodesForTransfer(sampleEpisodes, { mode: "range", fromEpisode: 1, toEpisode: 11 }));
  assert.throws(() => selectEpisodesForTransfer(sampleEpisodes, { mode: "invalid" }));
});

test("episode file naming and parsing follow EPxxx.mp4 convention", () => {
  assert.equal(formatEpisodeFileName(1), "EP001.mp4");
  assert.equal(formatEpisodeFileName(25), "EP025.mp4");
  assert.equal(formatEpisodeFileName(120), "EP120.mp4");
  assert.equal(parseEpisodeFileName("EP001.mp4"), 1);
  assert.equal(parseEpisodeFileName("EP025.mp4"), 25);
  assert.equal(parseEpisodeFileName("EP120.mp4"), 120);
  assert.equal(parseEpisodeFileName("movie.json"), null);
});
