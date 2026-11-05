# Anpi Drama — Gemini-first Reels campaigns

## What's new

- Section 3 defaults to **Gemini AI**, with Muse AI as secondary provider.
- Choosing a movie / Collection ID automatically loads the available numbered MP4 episodes. No extra "Xem tập" click is required. Use "Tải lại tập" if files have changed.
- Each selected episode appears as a separate review card, with filename, Vietnam-local posting time, editable caption, and caption length.
- The review summary shows **Tập đã chọn / Đã có caption / Tập còn thiếu**.
- Automated generation processes every selected episode in successive batches of at most **8** (for example, 8 + 2 when selecting 10). A failed request leaves existing drafts in the browser session; press Generate again to continue with the missing episodes.
- **Muse JSON manual import** supports a complete response for all 10 selected episodes in one paste, or multiple consecutive responses. The server validates episode membership, order, per-episode time windows, and captions.
- **Duyệt và lưu chiến dịch** becomes usable only after every selected episode has valid caption/time. You still need an eligible Fanpage and campaign name. Publishing begins only after explicit approval.

## Gemini configuration

The existing `GEMINI_API_KEY` Vercel environment variable is used on the server only. Set `GEMINI_MODEL` to a supported generateContent model, e.g. `gemini-2.5-flash`, and redeploy.

Gemini generates JSON with `responseMimeType: application/json` and a strict `items[]` schema. The API checks the response and retains no Google Drive access credentials in the prompt. All video files remain on Drive during caption planning.

**Important:** This revision uses film title, episode number, filenames, and schedule information. It **does not** download or view MP4 content or recognize dialogue; captions must not claim video events they haven't analyzed. Video understanding would require an additional Drive-to-Gemini Files API worker and separate billing/permission review.

## Try 10 episodes

1. Sign in and open tab **Facebook Reels / Muse**.
2. Confirm Meta Page and Drive connections.
3. Select a movie / Collection ID, allow the episode list to populate, and choose episodes 1–10.
4. In section 3 select **Gemini AI (ưu tiên)**, choose date, time, posts/day and spacing. Click **Tạo caption và lịch cho tất cả tập bằng Gemini**.
5. Watch the progress reach 8/10 then 10/10. If quota or temporary API errors occur, retry to process the remaining episodes.
6. Review each card's time and caption, then click **Duyệt và lưu chiến dịch**. Jobs go to Supabase; publishing runs via GitHub Actions/Meta.

If using Muse manual mode, choose **Muse AI → Sao chép lệnh và dán JSON**, generate a prompt, paste the returned JSON containing 10 items, and click **Nhập và kiểm tra toàn bộ JSON**. The button enables after all 10 are valid.

## If approval remains disabled

Inspect the progress and review message:
- `8/10`: only 8 drafts have been received. Generate the remaining 2, or paste a full 10-item Muse JSON.
- `caption hoặc lịch chưa hợp lệ`: check empty captions, timestamps or increasing episode order.
- Missing Fanpage or campaign name: connect/select a Page and set a campaign name before saving.

Actual Meta publishing, Gemini quota and Google Drive permissions must be checked with your configured accounts; unit tests are not end-to-end publishing tests.
