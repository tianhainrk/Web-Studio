# AI Fanpage Publisher v2 — Dynamic Campaign Builder

**Development preview only.** This branch does not automatically post or schedule Facebook media. The live `main` branch remains untouched.

## Product requirement

All campaign settings are configured **in the Studio website**, not hard-coded in source:

- Add, edit or remove Page-to-movie assignments. Any supported number of Pages can be used (max 50 assignments per preview for resource safety).
- A Page may have more than one movie; the same movie may be assigned to different Pages. Duplicate Page+movie and duplicate Page+Drive-file combinations are rejected.
- Pick a movie and actual uploaded MP4 episodes from the existing Google Drive Manager, with optional first/last episode filters. **Do not assume 80 episodes.**
- Configure campaign start date, 1–90 day horizon, default 1–100 episodes per day, local publish window, and staggering. Each Page-to-movie assignment may override daily pace and day count.
- Configure AI provider (Gemini / MuseAI) and caption tone via website. API integrations and credentials will be implemented later, gated by verified provider API access.
- Preview all expected publishing timestamps in `Asia/Ho_Chi_Minh`, show per-assignment counts and status before any future action.
- Save/restore **nonsecret configuration locally in the browser** and export the preview as JSON. Multi-device persistent storage is a future database phase.
- Existing MP4 files must remain unchanged; no FFmpeg or watermarks.

## Implemented on the development branch

- `src/reels/campaign-schedule.mjs`: pure configurable UTC schedule preview; accepts variable Page assignments and existing MP4 file lists; validates count, dates, duplicate resources and rights.
- `POST /api/reels/preview`: authenticated draft-only endpoint. No Facebook or AI calls are made.
- `public/fanpage-publisher.js` + Studio `AI Fanpage Publisher` tab: dynamic Page/movie rows, Drive library chooser, editable windows, preview, browser-local save/restore and JSON export.
- `tests/reels-schedule.test.mjs`: fixed-size regression example plus variable-size and per-assignment tests.

## Configuration model (no hard-coded 5, 80 or 7)

```json
{
  "campaignName": "Chiến dịch tùy chọn",
  "aiProvider": "gemini",
  "captionTone": "natural",
  "startDate": "2026-11-10",
  "days": 10,
  "dailyLimit": 4,
  "windowStart": "09:00",
  "windowEnd": "20:00",
  "staggerMinutes": 2,
  "timezone": "Asia/Ho_Chi_Minh",
  "pages": [
    {
      "pageId": "12345678910",
      "seriesId": "my_movie",
      "episodes": [
        {
          "number": 1,
          "driveFileId": "drive_file_id_001",
          "rightsApproved": true
        }
      ]
    }
  ]
}
```

A `pages[]` element represents a Page-to-series **assignment**, not necessarily a unique Page. Individual entries may also provide `days` and `dailyLimit` overrides.

The server returns draft rows with Page ID, Series ID, episode number, Drive File ID, local date/time, UTC timestamp and rights/editorial states. None is automatically approved for publication.

## Future stages / release gates

1. **Meta OAuth and Pages:** connect actual Pages via Meta, verify privileges, and replace temporary manual Page ID entry with a selectable Page list.
2. **Gemini / Muse API:** store credentials encrypted server-side, support validated JSON caption output, retries and manual review. Muse brand/model/API credentials must be confirmed; UI selection does not imply working connection.
3. **Meta five-minute test:** with authorized footage, verify Page Video upload, scheduled publishing, and the specific Page's Reel behavior.
4. **Durable persistence:** database for campaigns, uploads and Meta IDs; resume after refresh, retries, reconciliation, locks and idempotency.
5. **Hobby compatibility:** split media transfers into bounded tasks; verify Vercel Hobby limits, else choose a compliant external transfer service without requiring a continuously running PC.
6. **Rights and approval:** block publishing without verified redistribution rights and editorial approval.
7. **Security:** no tokens in browser localStorage, HTML, query strings or task logs. CSRF protection, least-privilege OAuth and encrypted credentials.
8. **End-to-end tests:** confirm arbitrary Page/movie counts, variable episode ranges, upload correctness and acceptance of each schedule by Meta.

## Deployment

Changes are isolated in the draft Pull Request on `feature/ai-fanpage-publisher-v2`. Do not merge to `main` or enable posting until release gates are complete.
