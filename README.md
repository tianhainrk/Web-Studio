# PineDrama Web Studio

## Facebook Reels Studio (opt-in feature)

The independent Reels manager is available at `/reels.html` after Vercel deployment and admin sign-in. It adds Meta/Google OAuth, Fanpage selection, Drive episode ranges, campaign scheduling, Gemini caption drafts, encrypted token storage, Supabase audit/duplicate protection and a GitHub Actions worker. No automatic publishing occurs until you configure Supabase, Google OAuth, Meta app permissions and GitHub Actions secrets. MuseAI is only an experimental provider adapter until a supported caption API is verified.

**Setup:** [Facebook Reels Studio deployment guide](docs/facebook-reels-studio.md).


Private, standalone browser dashboard for PineDrama metadata and playback, based on the verified AnPinime **feature/ai-drama** provider. The AnPinime repository is read-only and not modified.

## Included
- Vietnamese responsive catalog / search; request count 12, 24 or 50; show server's empty-cursor pagination limitation explicitly.
- Full episode panel, exact episode ID checks, stream resolution using the existing \`src/provider.mjs\` JSON/protobuf decoder. Locked, preview and token-requiring video is rejected.
- Video player using the browser's native player. Some MP4/HLS streams may fail because of codec, expired URLs, CDN restrictions, browser CORS, or host-side requirements. No bypass or DRM extraction.
- Password-protected admin page and session cookies. For production, add rate limiting upstream (e.g. Vercel Firewall).
- Google Drive OAuth in-browser with \`drive.file\` scope; create/use \`PineDrama-Library\` folder, upload user-selected **authorized** video via resumable chunks directly to Google (without Vercel function size limits).
- Reels Manager **draft queue only**, kept in browser session. Real Facebook automated publishing is not enabled; requires separately authorized Meta Page API, licensed media and persistent job storage.

## Vercel deployment
1. Import this private GitHub repository at https://vercel.com/new.
2. Set Framework Preset **Other**, Root Directory \`/\`, Output Directory \`public\`.
3. Configure \`STUDIO_PASSWORD\` (>=12 chars), \`SESSION_SECRET\` (>=32 random chars) and optionally \`GOOGLE_CLIENT_ID\` in **Environment Variables**.
4. Deploy. Open \`/api/health\` for configuration state, then open the root site and log in.
5. For Drive, enable **Google Drive API**, create a Google Cloud **Web application** OAuth client, configure the exact Vercel HTTPS domain under **Authorized JavaScript Origins**, set up consent screen and add Drive \`drive.file\` scope. Tokens remain in browser memory; signing in again is needed after refresh.
6. Secure access: Vercel Firewall/rate limiting recommended. Do not place passwords, Meta tokens or Google client secrets in Git.

## Local development
Node.js 20+: \`npm run dev\`; local auth needs \`STUDIO_PASSWORD\` and \`SESSION_SECRET\` environment variables. A secure-cookie session requires HTTPS, so use Vercel's HTTPS deployment for real sign-in.

## Limitations
- The home recommendation feed reports has_more=true with an empty cursor, continued with the native loaded-ID contract. Ranking/new scenes are verified native routes, but the public API ranking does not yet match the signed-in original app screenshot.
- This tool does not download PineDrama media in bulk or upload protected content to Drive; the Drive flow handles files supplied by the user with appropriate rights.
- Browser uploads need an OAuth login and a valid Google account quota. Upload retries across browser restarts and persistent publishing jobs are future work.
- This repository has no credentials or bundled copyrighted video.

## Native library expansion (2026-11-02)

The web now exposes the confirmed PineDrama scene routes: Home (scene 1), Top Hot (6), Latest Ranking (7), New Works (8) and category-filter POST. Home has an empty server cursor and continues via the last 20 **actual** loaded collection IDs, the count accumulated in this browser session, and `drama_request_type=load_more`. Other feeds use the **actual** server cursors. The UI deduplicates on exact 64-bit string IDs and stops if no new results or the server cursor stops advancing. The reported results are not evidence of an exhaustive library. Browser reloads reset paging state. Source evidence: AnPinime `Tools/pinedrama-analysis.md` and `Tools/evidence/2026-11-02-pinedrama-library/` (read-only).

If your Vercel project is connected to `main`, these commits should trigger a new deployment. Run `npm test` and confirm GitHub Actions green before relying on production. Click a movie card to open its full episode list and player. Google Drive still requires its own OAuth client; the draft Reels queue is not an automated publisher.

## Detail view, ranking source and Drive import

The new film detail screen shows title, poster, description, categories, server-reported view count, collection ID, declared episode count, verified full episode selector and player. This is metadata from PineDrama's API, not a local bundled film list.

**Vietnam Top Hot ranking source — FIXED 2026-11-02.** The true country selector is the native request parameter `carrier_region=VN` (not `region=VN` or `sys_region=VN`). Verified through isolated bounded live probes on the same `mini_drama_center/v1/?scene=6&count=10` endpoint: adding only `carrier_region=VN` switches the first titles to **Trọng Sinh Gả Cho Chồng Kiếp Trước** (collection ID `7698688530096116744`, heat_score `1644505122`) and **Bí Mật Của Vợ Cũ Tỷ Phú** (ID `7700125451435381767`, heat_score `882003506`). `op_region`, `residence`, `region`, `sys_region`, or x-tt-region headers alone did not select the Vietnam ranking. The change applies to the independent web provider, not the AnPinime repository. The server's `drama_rankings_update_tsp` supplies the hourly refresh time (not the fetch time). `heat_score` is a popularity score and MUST NOT be presented as actual `num_watched` video views. Rankings can change by the hour, so a screenshot from 11:00 need not match an API response updated at 12:00. Set `PINE_CARRIER_REGION=VN` to specify the regional ranking explicitly (default VN).

**Google Drive & Drive Manager (`PineDrama-Library/<collection-id>`):**
- Movies are organized strictly by Collection ID under `PineDrama-Library/<collection-id>/` containing `movie.json` and `EP001.mp4`, `EP002.mp4`, ...
- Replaced legacy Reels and Settings tabs with **Manager (Drive)** (`#manager`) to manage all series folders stored on Google Drive, inspect uploaded episodes (`EPxxx.mp4`), check for newly released episodes from PineDrama, and trigger transfers directly.
- Supports **2 download modes** in both Movie Detail and Manager:
  1. **Tải toàn bộ (`mode = "all"`):** Transfers episodes `1..N` (automatically skipping episodes already present on Drive).
  2. **Tải theo khoảng tập (`mode = "range"`, từ tập X đến tập Y):** Transfers only the selected episode range `[fromEpisode..toEpisode]`, ideal for ongoing/updating series.

## Verified Vietnamese "Tác phẩm mới" (New Works, 7 days) API — 2026-11-02

Native app asset `TikTokPineDramaImpl.bundle/tiktok_short_drama_center_lynx.zip` calls `GET /tiktok/md/mini_drama_center/v1/` for the New Works 7-day feed using **`scene=8`, `category_id=0`, `count=12`, `carrier_region=VN`** and the **actual server cursor**. `recent_days=7` is *not* sent on this GET (that is a category-filter POST field). The New Works route is different from the **Latest Ranking**, which uses `scene=7` and ranks popular recently released titles.

A read-only native API probe compared VN carrier against no-carrier and US-carrier profiles: the 12 VN New Works IDs differed from all 12 baseline IDs; setting `op_region=VN`, `residence=VN`, `country=VN` or `store_region=VN` did not switch the feed. A second request with the actual `cursor=1:24` returned another 12 previously unseen titles and a new cursor `1:49`. The server has not supplied item-level release timestamps in this checked response; 7-day scope is grounded in the shipped PineDrama UI text, not inferred from collection IDs. The implementation preserves native ordering without sorting by `heat_score` or `num_watched`.
