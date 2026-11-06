# Anpi Drama Studio — YouTube Shorts & TikTok (v1)

This is an **additive, opt-in** module. Existing Facebook Reels tables, Meta workflows and posting behavior are unchanged.

## Provider matrix

| Provider | Integration | Limitations |
| --- | --- | --- |
| YouTube Shorts | Google OAuth (youtube.upload, youtube.readonly); select Drive EPxxx.mp4; resumable upload; visibility and status reconciliation | Google Data API quota, channel eligibility, video dimensions/duration, copyright and content checks. YouTube determines Shorts classification, not this app. |
| TikTok | Login Kit OAuth (user.info.basic, video.publish); creator_info privacy query; Direct Post PULL_FROM_URL; publish status reconciliation | Requires Content Posting API approval; unaudited apps are private-only; video URL must be hosted on a verified HTTPS domain / URL prefix, not Drive API URLs. |

## Before enabling

1. Deploy `supabase/multiplatform-publishing.sql` to the **same** Supabase project (additive tables: `multi_publish_accounts` and `multi_publish_jobs`).
2. In Vercel Production set `MULTIPLATFORM_ENABLED=true`. Existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` can be used for YouTube if the same OAuth client is approved for YouTube scopes.
3. Register exactly `https://anpinime-dramavideo.vercel.app/api/reels/multi/oauth/youtube/callback` in Google Cloud OAuth Web Client. Enable **YouTube Data API v3** and add scopes `youtube.upload` and `youtube.readonly` to OAuth consent.
4. Create a TikTok Developer app, add Login Kit and Content Posting API (Direct Post), request scopes `user.info.basic`, `video.publish`, and register callback `https://anpinime-dramavideo.vercel.app/api/reels/multi/oauth/tiktok/callback`. Set Vercel secrets `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
5. For TikTok media already hosted in a private Drive, create a dedicated HTTPS storage domain and **verify its ownership with TikTok**. Set `TIKTOK_VERIFIED_MEDIA_HOST` to its hostname (example: `video.example.com`). Files must be reachable over HTTPS without redirects for TikTok to pull. No direct Drive URL is offered as a workaround.
6. Vercel `TIKTOK_PUBLIC_POSTING_APPROVED` remains false until TikTok has completed the necessary audit for public posting. Only `SELF_ONLY` queue entries are accepted beforehand. Each account's creator_info must also permit the selected privacy mode.
7. Keep the GitHub Actions **repository variable** `MULTIPLATFORM_PUBLISH_ENABLED` unset/false until the end-to-end dry run, OAuth and copyright review succeed. Then set to true. Add GitHub Actions secrets `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`, and repository vars `TIKTOK_VERIFIED_MEDIA_HOST` and `TIKTOK_PUBLIC_POSTING_APPROVED`. Reuse existing Google/Supabase/REELS_ENCRYPTION_KEY Actions secrets.
8. Optionally set Vercel `MULTIPLATFORM_PUBLISH_ENABLED=true` only to indicate the worker is enabled in the UI; GitHub repo variable independently controls execution.

## How to use

Anpi Drama main tabs → **YouTube Shorts · TikTok** → connect account(s) → select a Drive folder and episode → enter title/caption, Vietnam time, visibility, TikTok verified video URL (if TikTok selected), confirm distribution rights and explicit post consent → schedule.

A single submit creates **one independent job per selected channel**. Failures are isolated. A duplicate job for the same account/video/time is rejected by a database uniqueness constraint. Only queued jobs can be cancelled; unclear/ambiguous upload failures are marked `needs_review` and are **never automatically retried**. Do not manually retry an uncertain job before checking the remote account for duplicates.

Worker: `.github/workflows/multiplatform-worker.yml` runs on best-effort 5-minute GitHub schedule or manual workflow_dispatch; requires the repository variable. The YouTube upload metadata includes `selfDeclaredMadeForKids=false`, so upload only videos that are **not made for children**. TikTok uploads use PULL_FROM_URL and honor returned creator privacy options.

**Current limitations:** No transcoding, ffprobe inspection, duration/9:16 validator or analytics for the new providers yet. YouTube may not classify a given MP4 as a Short. TikTok publish status and YouTube upload status are reconciled on subsequent worker runs. GitHub Actions cron is best-effort and cannot guarantee second-accurate publication. TikTok public posting requires app audit and user permission. The module is gated and is not proof of a successful real provider upload until a user connects accounts, verifies scopes and tests with authorized videos.

Sources:
- https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
