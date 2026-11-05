# Anpi Drama — Reels + Muse planning

This revision embeds **Facebook Reels / Muse** into the existing home-page tabs. The legacy `/reels.html` redirects to `/#reels`. Existing catalog, Drive Manager, Meta/Google OAuth callbacks, Supabase campaigns, and Meta worker remain in place. User-facing brand: **Anpi Drama Studio**. The upstream movie source and `PineDrama-Library` Google Drive folder name are intentionally unchanged to avoid breaking existing media.

## Step 1 — Connect Page and Google Drive

Log in to `https://YOUR-PRODUCTION-DOMAIN/#reels`. Connect Google Drive and Meta, then select the Page and a Drive series. Only files following `EP001.mp4` etc. are eligible. When Drive contains duplicate episode filenames, the selection UI shows one item per episode. It does not delete or rename your existing files.

## Step 2 — Prepare Muse plan from selected video episodes

In section **3. Muse lập chiến dịch và caption**, enter:
- Campaign name, Fanpage, movie title;
- Vietnam-local starting date and first time, episodes per day and spacing;
- Caption style/instructions.
- Select **Muse2API tự động** (self-hosted gateway) or **Sao chép lệnh / dán phản hồi Muse** (manual).

Muse receives only movie title, EP file names, episode numbers, proposed time slots, and style guidance. **No video bytes, bearer tokens, Google refresh tokens, or private Drive URLs are sent to Muse.** Muse cannot actually watch the scenes in this mode, so generic captions are safer than inventing plot details. Scheduling slots are calculated by Anpi Drama according to your settings; Muse must return matching per-episode timestamps, and you can manually edit each approved item.

### Automatic mode (Muse2API)

The repository [www222fff/muse2api](https://github.com/www222fff/muse2api) advertises an OpenAI-compatible `POST /v1/chat/completions` gateway with model alias `muse-chat`. Its README **explicitly says browser/direct drivers still need live testing** with a real Muse account; the mock driver passing tests is not proof of live service compatibility. Check account and platform terms before using a third-party bridge.

Host a private HTTPS gateway **outside Vercel Hobby**, since the Muse browser driver uses persistent Chromium/CDP. Configure on Vercel:

| Name | Value |
|---|---|
| `MUSE2API_BASE_URL` | HTTPS URL of trusted gateway, e.g. `https://muse-gateway.example.com/v1` |
| `MUSE2API_API_KEY` | Gateway's bearer key. Never paste into browser or commit |
| `MUSE2API_MODEL` | `muse-chat` |

Redeploy Vercel. The back-end sends a non-streaming chat-completions request and only accepts properly shaped JSON. Requests are sequential in 8-episode batches so the UI can show progress; Vercel function timeout can still be an issue if Muse is slow.

**Do not use an unknown public proxy or copy Muse browser cookies into Anpi Drama**. Keep Muse credentials inside your own gateway and restrict access by HTTPS + a strong bearer key. A bridge may rely on private web protocols and could stop working.

### Manual mode (without gateway)

1. Select episodes in Step 2.
2. Enter settings in Step 3, select the manual mode and click **Tạo lệnh gửi Muse**.
3. Click **Sao chép lệnh**. Paste into the Muse chat you control.
4. Ask Muse to return **only JSON**, then paste the entire answer into **Dán JSON Muse trả về**.
5. Click **Đọc và kiểm tra JSON**. The server verifies exact episode list and expected timestamps.
6. For more than eight episodes, repeat on the next batch. Each response is a draft, not a publishing instruction.
7. Check/edit scheduled time and caption for each episode, then click **Duyệt và lưu chiến dịch**.

Sample response:

```json
{
  "items": [
    {
      "episode": 1,
      "scheduledAt": "2026-12-20T12:00:00.000Z",
      "caption": "Tập 1: Câu chuyện bắt đầu, cùng đón xem diễn biến tiếp theo. #PhimNgan #Tap1"
    }
  ]
}
```

Dates are ISO-8601 UTC; 12:00 UTC corresponds to 19:00 in Vietnam.

## Step 3 — Publishing

Only after approval are one-row-per-episode jobs inserted into Supabase. GitHub Actions polls every five minutes and publishes due Reels via Meta. Timing is **best effort**, not guaranteed exact. Muse is used for editorial planning, not to call Meta itself.

## Security and operational notes

- Session is protected by Anpi Drama's signed login cookie and existing CSRF cross-site filtering.
- Backend revalidates Drive file membership, Page access, episode IDs, caption lengths, timestamp format, uniqueness, chronological ordering and future time window before saving.
- UI draft previews are local/in-memory and reset if selection or schedule settings change. Refreshing the page discards unapproved drafts.
- Existing Supabase schema is sufficient: no SQL migration is needed for Muse drafts. Do not automatically publish unreviewed AI output.
- Only add `MUSE2API_*` variables if you have deployed a trustworthy gateway. The manual mode works without one.
- Different Muse2API projects offer different protocol variants. This integration targets OpenAI-compatible `/v1/chat/completions`, not Muse's undocumented browser endpoints. Muse2Tele uses a Telegram+FoxProfile browser automation stack and does **not** offer the same API as a drop-in replacement.
- If Vercel returns 504 from automatic generation, use manual mode or shorten the batch. Never claim a campaign was saved until the database confirms it.
- Video copyright and Meta Page permissions remain the operator's responsibility.

Relevant code: `src/muse-planner.mjs`, `src/reels-api.mjs`, `public/reels.js`, `public/index.html`, `scripts/reels-worker.mjs`.
