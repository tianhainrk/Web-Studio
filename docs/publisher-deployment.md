# PineDrama-Web-Studio v2 — Publisher deployment and verification

**Status:** development / deployment intentionally deferred. Do not connect production Pages or upload media until the checklist below is complete. The original Studio and Google Drive Manager remain available.

## 1. Required infrastructure

- **GitHub:** tianhainrk/PineDrama-Web-Studio, development branch feature/ai-fanpage-publisher-v2.
- **Hosting:** Vercel Hobby may host the UI and API for personal, noncommercial use. Hobby is **not guaranteed** to support continuous large-scale media relaying; it has fair-use and function limits. 400 × 100 MB equals up to 40 GB per week; approximately 160 GB per four weeks before retries. The upload processor uses individual bounded requests, but throughput and plan legality require real verification.
- **Database:** Supabase Postgres with the SQL in sql/publisher-schema.sql. No RLS policy grants anon access.
- **AI:** one or both of Gemini and Meta Muse Model API.
- **Facebook:** Meta developer app with Page management and publishing permissions. Some permissions may require App Review/Business Verification.
- **Google Drive:** server-side OAuth client with access to the Drive library, plus the existing client-side Drive Manager for selecting MP4 files.

## 2. Environment variables

Copy .env.example into your local development environment; enter secret values in **Vercel Environment Variables**, never in Git or in a public URL.

Core existing values:
- STUDIO_PASSWORD: at least 12 characters.
- SESSION_SECRET: random secret at least 32 characters.
- GOOGLE_CLIENT_ID: OAuth web client ID.

New values:
- STUDIO_PUBLIC_URL: full HTTPS origin, e.g. https://new-project.vercel.app
- SUPABASE_URL: https://your-project.supabase.co
- SUPABASE_SERVICE_ROLE_KEY: service-role secret, server-only
- PUBLISHER_ENCRYPTION_KEY: 32 random bytes encoded in base64; **do not rotate without a migration** or previous credentials become unreadable
- META_APP_ID and META_APP_SECRET
- META_GRAPH_VERSION, default v24.0, verify actual supported version
- GOOGLE_CLIENT_SECRET (web OAuth client secret)
- GEMINI_API_KEY and optionally GEMINI_MODEL
- MUSE_API_KEY and optionally MUSE_MODEL

Generate encryption secret locally:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"

If your Muse quota is only available through a web interface and **does not include Model API access**, the Muse option will not work until a valid Model API key is provided.

## 3. OAuth redirect configuration

Set the exact callback URLs at the corresponding provider console, using your final production HTTPS origin:

    https://YOUR-SITE/api/publisher/oauth/meta/callback
    https://YOUR-SITE/api/publisher/oauth/google/callback

Meta: Facebook Login for Business / Facebook Login configuration, domain and required Page permissions. Request the Page publishing permissions needed by the Page Videos API; permissions are app/account specific. Confirm available Pages appear and that granted tasks support content creation.

Google: OAuth web client with Drive API enabled and the Drive read-only scope; verification/consent screen rules may apply. Existing browser Drive and the server background Drive connection are separate.

The Studio password session cookie must exist when starting and completing OAuth (OAuth state is bound to the session). Credentials are encrypted with AES-256-GCM in Supabase; client JavaScript only sees connected status, Page IDs and display names.

## 4. Launch checklist

1. Run sql/publisher-schema.sql in a dedicated Supabase project.
2. Configure server variables and all callback URLs; connect Google Drive **to backend** and Meta Pages in the new publisher tab.
3. Confirm Drive Manager can see source MP4s under PineDrama-Library and backend Drive OAuth can fetch their metadata and byte ranges.
4. Create **one test campaign** with one Page, **one authorized video** around five minutes, and a schedule at least 30–60 minutes in the future.
5. Generate caption using Gemini or Muse, review the text, acknowledge redistribution rights and approve the video and campaign.
6. Start upload from the website, observe chunk progress, and verify that Facebook accepts \`upload_phase=finish\` and the requested schedule. **Do not equate an accepted video_id with a published post**.
7. Wait for the scheduled date, verify actual publication and whether it is displayed as a Reel on that particular Page. Meta video API and Facebook UI may differ in formatting.
8. Test expired token, rejected upload, dropped connection and ambiguous Meta responses. Never auto-retry an uncertain finish response.
9. Expand to several Pages and video files, record transfer volume and Function usage before starting hundreds of uploads.
10. Only then merge the draft PR and deploy; the user specifically requested to do deployment personally after the project is finished.

## 5. Day-to-day workflow

- In AI Fanpage Publisher choose campaign name, provider, tone, date, time window, daily pace and stagger.
- Add or remove Page-to-movie assignments. Page IDs come from linked Meta Pages. Select actual uploaded MP4 files from Drive; choose episode ranges.
- Preview full local-Vietnam schedule; review every assignment and rights indicator.
- Save the campaign in Supabase. Generate captions individually or batch (five requests per batch); edit and approve all captions.
- After explicitly approving the campaign, start the browser-driven uploader. It sends one source MP4 chunk to Meta at a time and saves offsets in the database.
- **Keep the browser open for upload preparation.** Closing it will not cancel schedules already accepted by Meta, but it stops new upload requests. Reopening the saved campaign can continue rows in \`uploading\` state.
- Once Meta confirms \`scheduled\`, Facebook is expected to publish later without the personal device running; actual Page Video scheduling must pass the live integration test above.
- Use Reconcile to check API publishing status. The system never treats local time passing as proof of publication.

## 6. Safety and limitations

- You must have the rights to redistribute every uploaded video. Captions and a personal Drive copy do not grant redistribution rights.
- This is not an anonymous Facebook scraper, and no automation bypasses Meta policy or app review.
- No logo, watermark, transcoding or copy of the source MP4 is produced.
- The current resumable uploader is an implementation against the Page Video API, **not a guarantee** that Meta accepts every supported content type, file length or scheduling combination. Graph parameters may need adjustments following live API responses.
- If a transfer or finish returns an ambiguous error, the job moves to \`needs_reconcile\`. Avoid blind retries: Meta could have accepted the chunk or created a scheduled video. Use the Meta Page dashboard and the video ID to resolve it.
- Store no server refresh tokens or Page access tokens in browser localStorage.
- Current client-side original Drive Manager still has its independent OAuth session logic; the new publisher server OAuth does not change legacy behavior.
- The new implementation does not support automated editing/cancellation of a schedule that Meta already accepted. A Page admin should manage it in Facebook first.
- The stored campaign page supports 5,000 drafts maximum per campaign and 50 assignments per preview; split larger workloads.
- Local browser draft settings are optional conveniences; persistent uploaded campaign rows are in Supabase.

## 7. Validation commands

    npm test
    node --check api/index.mjs
    node --check src/reels/publisher-storage.mjs
    node --check src/reels/publisher-ai.mjs
    node --check src/reels/publisher-oauth.mjs
    node --check src/reels/publisher-video.mjs
    node --check src/reels/publisher-routes.mjs
    node --check public/fanpage-publisher-admin.js

GitHub Actions runs these tests and syntax checks on development pull requests.

## 8. Future improvements

- A batch uploader in an appropriate hosting plan/external worker to handle large media transfer without keeping a browser open.
- A server-controlled lease/recovery design for uncertain uploads, combined with reconciliation against Meta's actual upload session state.
- Scheduled-post editing and cancellation via verified Meta endpoints.
- Service monitoring, alerting and recurring quota reporting.
