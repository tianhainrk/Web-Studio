# AI Fanpage Publisher v2 — implementation status

**Repository:** tianhainrk/PineDrama-Web-Studio  
**Development branch:** feature/ai-fanpage-publisher-v2  
**Deployment:** intentionally deferred until the user deploys after live Meta verification.

## Objective

A configurable publishing workspace on the website: no hardcoded number of Pages, films, episodes or dates; no logo rendering or transcoding. All MP4 inputs are already in Drive. AI may use Gemini or Muse Model API, with provider selected in the UI. Media can be pre-uploaded and scheduled via Meta Page Video API, subject to live eligibility and endpoint testing.

## Implemented

- Existing Studio tab: **AI Fanpage Publisher**
- Dynamic Page-to-film assignments, episode start/end, daily pace overrides, campaign dates, time window and stagger.
- Existing Drive Manager library reused for MP4 selection; configuration is saved locally for convenience and persisted centrally when a campaign is created.
- Read-only schedule preview endpoint with Vietnam-local and UTC times, rights status, duplicate file checks and capacity validation.
- Supabase SQL schema + PostgREST adapter for persistent campaigns, posts and encrypted credentials.
- Meta and Google Drive OAuth code flow with HMAC-bound CSRF state, server-side storage and connection management.
- Gemini and Meta Muse caption generation with a conservative prompt and manual editable review.
- Individual and batch AI calls; explicit per-post and per-campaign editorial approval.
- Google Drive -> Meta Page Video upload in restartable chunks, bounded to a single chunk per request; status tracking and scheduler finish.
- Post scheduling acknowledgment stored in database, user-triggered reconciliation to inspect Page video publishing status and explicit scheduled video deletion.
- Dashboard showing all saved campaigns, upload status and failed/ambiguous jobs.
- Unit tests for dynamic schedules, encrypted values, OAuth state, both AI providers and a mocked Drive-to-Meta upload/publishing path.
- New test syntax checks for server and browser modules in GitHub Actions.

## Not yet verifiable without real user-controlled external configuration

1. A Meta Developer App with approved Page publishing permissions and a real connected Page.
2. A Google Cloud OAuth web client with a working Drive refresh token.
3. User-supplied API credentials for Gemini and/or Muse. The Muse selection requires **Model API** credentials, not only an end-user website quota.
4. Supabase database created and environment values configured in the future deployed website.
5. A real Meta Page API test using one authorized 5-minute MP4. Meta acceptance of scheduling and final Reel visibility cannot be inferred from mocked tests.
6. Monitoring real traffic against Vercel Hobby fair-use quotas. Heavy media forwarding might require different hosting; a personal browser is required during the pre-upload phase.

## Known deliberate safeguards

- Default is draft-only; no upload before explicit rights and editorial confirmation.
- Once an upload action might have reached Meta and its outcome is ambiguous, the job is marked for reconciliation rather than blind retry.
- No Page token, Google refresh token or model API key is exposed to browser JavaScript.
- No background job is promised after the browser is closed **before Meta has accepted the schedule**.
- Keep the development PR as a draft until the external acceptance gates succeed.

## Setup

Read [Publisher deployment and verification guide](publisher-deployment.md), then apply the SQL in [publisher-schema.sql](../sql/publisher-schema.sql). Configure .env.example values in server environment. Run npm test and the GitHub Actions workflow before any merge.
