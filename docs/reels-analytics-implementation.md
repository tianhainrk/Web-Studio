# Reels Analytics — implementation and production activation

**Design reference:** the previously approved \`anpi_reels_analytics_demo.html\`. The \`public/reels-analytics.html\` page retains its original DOM layout, \`public/reels-analytics.css\` is copied directly from the original stylesheet, and \`public/reels-analytics.js\` replaces ALL simulated data with API responses. This is embedded as a same-origin iframe in the existing \`/#reels\` tab, so original CSS does not affect posting/Drive pages.

**Default release gate:** OFF. Merge, if approved, does not run Analytics or alter posting until explicitly enabled. Never enable before the migration and Meta permission probes.

## What was implemented

- OAuth adds **read_insights** only when \`REELS_ANALYTICS_ENABLED=true\`, preserving current posting scopes while disabled.
- Additive Supabase migration: \`supabase/reels-analytics.sql\` (RLS, snapshots, Page daily, sync runs, sync requests, safe atomic claim).
- Per-Page probing: \`src/reels-analytics-meta.mjs\` (Page daily metric list, video plays, separate counts for likes/comments/shares; record unsupported/missing-permission/no-data; never assume Video ID is Post ID).
- Worker: \`src/reels-analytics-worker.mjs\`, triggered by \`.github/workflows/reels-analytics.yml\` at 3-hour intervals or manually. Worker is separate from the Reels upload/Meta publish worker and never updates jobs/campaigns.
- API:
  - \`GET /api/reels/analytics/capabilities?pageId=<id>&probe=1\`: bounded live Page+single Reel probe. **Runs only when authenticated and feature flag is on.** No secret returned.
  - \`GET /api/reels/analytics/dashboard?pageId=all&period=30\`: overview, trends, per-Page totals, top Reels, heatmap and sync status.
  - \`GET /api/reels/analytics/summary\`, \`/trend?metric=views|likes|comments|shares\`, \`/pages\`, \`/reels?cursor=0&limit=12&search=EP001\`, \`/reels/:id\`, \`/best-times\`, \`/recommendations\`.
  - \`POST /api/reels/analytics/sync\` with \`{"pageId":"all"}\` or exact Page ID: enqueue a bounded refresh. Maximum one manual enqueue per Page per 15 minutes. If \`GITHUB_REELS_WORKFLOW_TOKEN\` is already configured, the server requests \`workflow_dispatch\`; otherwise run GitHub manually or wait for scheduled sync.
- Dashboard: Page segment (all/each Page), 7/30/90-day period, five KPI, live trend, real heatmap only when sample size is sufficient, Page comparison, paginated searchable Reels, top list, detail popup, mobile cards, manual sync feedback.
- Muse scheduling: when Analytics is on and has enough 24h samples, the prepared Muse command includes verified higher-performing Page slots with sample size. Never modifies an existing campaign or overrides the **>=10 episodes/day** rule.

## One-time activation sequence

1. **Backup your Supabase database** and identify the Supabase project corresponding to the currently deployed Anpi Drama Vercel \`SUPABASE_URL\`. In SQL Editor of THAT project, run \`supabase/reels-analytics.sql\`. Do not run a different project's SQL.
2. Deploy the code to a Vercel preview for review. Keep \`REELS_ANALYTICS_ENABLED\` omitted or false in Production until permission testing passes.
3. For a staging/preview setup, set \`REELS_ANALYTICS_ENABLED=true\` in Vercel Environment Variables, then redeploy. The feature-specific Analytics tab will become visible. It should initially show **no data** rather than mock values.
4. In Meta Developers, ensure the app/user has **read_insights** permission and that the accounts have Page ANALYZE permissions. Reconnect Meta from Anpi Drama to grant the new scope. The two Pages must be tested independently; Meta App Review / Advanced Access may be needed depending on use case and Page ownership.
5. Run \`/api/reels/analytics/capabilities?pageId=PAGE_ID&probe=1\` from a browser already signed in to the Studio for **each Page**. Check \`pageMetrics\`, \`videoMetrics\`, \`identityStatus\` and distinguish \`supported\`, \`unsupported\`, \`missing_permission\`, \`no_data\`, \`error\`. Some Graph video fields may be unavailable for a Reel; counts should then remain null, not zero.
6. On GitHub → Settings → Secrets and variables → Actions → Variables, set \`REELS_ANALYTICS_ENABLED=true\`. Existing **secrets** \`SUPABASE_URL\`, \`SUPABASE_SERVICE_ROLE_KEY\`, and \`REELS_ENCRYPTION_KEY\` must also exist in Actions. Open Actions → **Sync Facebook Reels Analytics** → Run workflow (main, after merge).
7. Read Analytics Sync workflow logs and \`reel_analytics_sync_runs\`. Verify the resulting \`reel_analytics_posts\`, \`reel_analytics_snapshots\`, \`reel_analytics_page_daily\` rows. Check that both Pages have their own snapshots and don't mix Video IDs.
8. Check several real Reels against the Meta Business Suite. Compare **same metric/time window**, document disagreements and API delays. Check desktop 1440px and mobile 390px/360px.
9. Only after two-Page probes and QA pass, enable the flag in Production and activate GitHub Analytics workflow. Keep the publishing worker unchanged.

## Correct metric definitions (critical)

- **Reels KPIs filtered by 7/30/90 days**: sum of currently known **lifetime** metrics from the Reels published during the date range. This is *not* the number of views that occurred during the selected period. The UI explicitly states this definition.
- **Page daily views chart**: \`page_media_view\` returned by Meta on each calendar day. Includes non-Reel content; it is labeled as Page content views.
- **Likes and shares daily chart**: differences between consecutive days' Reel snapshots only. If one day's data is missing, it remains **null**, never invented.
- **Followers**: daily follows from \`page_daily_follows_unique\`, only on days Meta returned this metric. If unsupported, show \`—\`.
- **Posting-hour heatmap**: median lifetime Reel views measured approximately 24h after publication, grouped per Page, Vietnam weekday and 2-hour bins. Requires **at least three videos per bin**; otherwise display "Chưa đủ mẫu". Early snapshots can be missing. No assumption of a proven golden hour.
- **Published date** currently uses the Anpi Drama \`scheduled_at\` as a proxy if Meta actual publish time is unavailable; this is labeled "Lịch xuất bản dự kiến".

## Operational safety

- No raw tokens or customer comments are stored in Analytics tables.
- RLS denies client access; only server-side service role reads/writes. All Analytics routes are behind the existing Studio password session.
- Manual sync never downloads MP4, posts to Facebook, or changes a publishing job. It schedules API metric reads only.
- \`REELS_ANALYTICS_ENABLED\` is the rollback switch. Disable it in Vercel, and disable the Actions variable to stop Analytics without stopping actual Reels publishing.
- A missing SQL migration returns an explicit setup warning instead of showing fabricated counters.
- \`source=anpi_schedule\` means the actual Meta publish timestamp was not confirmed.
- The dashboard currently analyzes **Reels published through Anpi Drama**. Discovery of all externally uploaded Page posts is outside the initial release until Meta Page/Posts permissions have been verified.

## Release gate

The code and isolated tests can be merged without activating the feature, but the plan's full Production acceptance criteria **cannot be verified by repository CI alone**. Live Meta API probes and Supabase migration require your connected Meta/Supabase environments. Do not label the feature as production-verified until the above validations succeed.
