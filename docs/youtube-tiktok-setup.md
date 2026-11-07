# Anpi Drama Studio — YouTube Shorts & TikTok (v1)

This is an **additive, opt-in** module. Existing Facebook Reels tables, Meta workflows and posting behavior are unchanged.

## Provider matrix

| Provider | Integration | Limitations |
| --- | --- | --- |
| YouTube Shorts | Google OAuth (youtube.upload, youtube.readonly); select Drive EPxxx.mp4; resumable upload; visibility and status reconciliation | Google Data API quota, channel eligibility, video dimensions/duration, copyright and content checks. YouTube determines Shorts classification, not this app. |
| TikTok | Login Kit OAuth (user.info.basic, video.publish); creator_info privacy query; Direct Post FILE_UPLOAD from Drive (default) or PULL_FROM_URL (optional); publish status reconciliation | Requires Content Posting API approval; unaudited apps are private-only; optional URL mode needs a verified HTTPS domain. |

## Before enabling

1. Deploy `supabase/multiplatform-publishing.sql` to the **same** Supabase project (additive tables: `multi_publish_accounts` and `multi_publish_jobs`).
2. In Vercel Production set `MULTIPLATFORM_ENABLED=true`. Existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` can be used for YouTube if the same OAuth client is approved for YouTube scopes.
3. Register exactly `https://anpinime-dramavideo.vercel.app/api/reels/multi/oauth/youtube/callback` in Google Cloud OAuth Web Client. Enable **YouTube Data API v3** and add scopes `youtube.upload` and `youtube.readonly` to OAuth consent.
4. Create a TikTok Developer app, add Login Kit and Content Posting API (Direct Post), request scopes `user.info.basic`, `video.publish`, and register callback `https://anpinime-dramavideo.vercel.app/api/reels/multi/oauth/tiktok/callback`. Set Vercel secrets `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
5. TikTok defaults to **direct FILE_UPLOAD from the existing Drive MP4**, using sequential 10MB/whole-file byte-range uploads through the Actions runner, so no public media URL is needed. If you choose PULL_FROM_URL, create a dedicated HTTPS media domain, **verify its ownership with TikTok**, then set `TIKTOK_VERIFIED_MEDIA_HOST` to its hostname. Files must be publicly reachable over HTTPS without redirects; direct Drive URLs are not suitable for this optional mode.
6. Vercel `TIKTOK_PUBLIC_POSTING_APPROVED` remains false until TikTok has completed the necessary audit for public posting. Only `SELF_ONLY` queue entries are accepted beforehand. Each account's creator_info must also permit the selected privacy mode.
7. Keep the GitHub Actions **repository variable** `MULTIPLATFORM_PUBLISH_ENABLED` unset/false until the end-to-end dry run, OAuth and copyright review succeed. Then set to true. Add GitHub Actions secrets `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`, and repository vars `TIKTOK_VERIFIED_MEDIA_HOST` and `TIKTOK_PUBLIC_POSTING_APPROVED`. Reuse existing Google/Supabase/REELS_ENCRYPTION_KEY Actions secrets.
8. Optionally set Vercel `MULTIPLATFORM_PUBLISH_ENABLED=true` only to indicate the worker is enabled in the UI; GitHub repo variable independently controls execution.

## How to use

Anpi Drama main tabs → **YouTube Shorts · TikTok** → connect account(s) → select a Drive folder and episode → enter title/caption, Vietnam time, visibility, optional verified TikTok video URL (leave blank for direct Drive upload), confirm distribution rights and explicit post consent → schedule.

A single submit creates **one independent job per selected channel**. Failures are isolated. A duplicate job for the same account/video/time is rejected by a database uniqueness constraint. Only queued jobs can be cancelled; unclear/ambiguous upload failures are marked `needs_review` and are **never automatically retried**. Do not manually retry an uncertain job before checking the remote account for duplicates.

Worker: `.github/workflows/multiplatform-worker.yml` runs on best-effort 5-minute GitHub schedule or manual workflow_dispatch; requires the repository variable. The YouTube upload metadata includes `selfDeclaredMadeForKids=false`, so upload only videos that are **not made for children**. TikTok uploads default to FILE_UPLOAD via Google Drive HTTP Range and honor returned creator privacy options; PULL_FROM_URL is optional.

**Current limitations:** No transcoding, ffprobe inspection, duration/9:16 validator or analytics for the new providers yet. YouTube may not classify a given MP4 as a Short. TikTok publish status and YouTube upload status are reconciled on subsequent worker runs. GitHub Actions cron is best-effort and cannot guarantee second-accurate publication. TikTok public posting requires app audit and user permission. TikTok Direct Post FILE_UPLOAD follows the official media-transfer chunk constraints: https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide. The module is gated and is not proof of a successful real provider upload until a user connects accounts, verifies scopes and tests with authorized videos.

Sources:
- https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide
- https://developers.tiktok.com/docs/en/content-sharing-guidelines

## YouTube AI multi-episode campaigns (2026-11-07)

The **YouTube Shorts · TikTok** tab includes a separate Gemini campaign editor. It does not affect Facebook Reels or TikTok workflows.

1. Link the YouTube channel using Google OAuth and verify the studio Google Drive connection can read `PineDrama-Library`.
2. Select a folder and choose an episode range (1–40 existing `EPxxx.mp4` files). Select one or more linked **YouTube** accounts above the editor.
3. Choose the first publishing day/time (Vietnam UTC+7), number of episodes per day, and interval (at least 15 minutes). Gemini creates YouTube titles, descriptions and suggests safe times, processing at most 8 episodes per request.
4. Inspect every draft and edit title, description, and scheduled time before approval. Gemini drafts are **metadata-only**: the AI sees folder title, episode number, and schedule, but **not the underlying video frames or transcript**. It must not invent specific scenes or plot facts.
5. Confirm content distribution rights and explicit posting consent. Use **Duyệt và xếp lịch** to create one independently auditable job per episode per selected YouTube account. Duplicate queued combinations are skipped. If an uncertain response occurs, inspect the job list before retrying.
6. The **YouTube cần kiểm tra** panel displays failed, processing, needs_review and overdue jobs across connected accounts. Queued jobs can be edited; a remote video ID can be manually reconciled; the retry option is offered only for a failed *pre-upload* job without a remote video ID.

To run actual scheduled uploads, configure GitHub Actions secrets as documented above and explicitly enable repository variable `MULTIPLATFORM_PUBLISH_ENABLED=true`. A same-named Vercel variable only changes the UI indicator and **does not start the GitHub worker**. The worker's five-minute schedule is best-effort; it does not publish at the exact second. No upload occurs when the worker remains disabled.

YouTube classifies eligible **vertical or square** videos **at most 3 minutes long** as Shorts; uploading an EPxxx MP4 does not guarantee it becomes a Short. This flow does not transcode or validate dimensions/duration, and the user must verify every video's rights, including music, subtitles and footage. Google API scope approval and limits still apply. Per YouTube Data API revision history (2026-11-02), unverified projects are no longer restricted to private-only uploads, but individual channel/account permissions can still constrain visibility.

References:
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.google.com/youtube/data/revision_history
- https://support.google.com/youtube/answer/15424877
