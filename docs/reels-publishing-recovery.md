# Facebook Reels — sửa lỗi Meta upload và bảo đảm worker được đánh thức

## Lỗi đã xác định từ log ngày 06/11/2026

EP001 dự kiến 07:00 (giờ Việt Nam), nhưng workflow Github Actions gần nhất trước giờ đăng chạy **06:52** và báo `reels worker jobs 0`. Các sự kiện schedule GitHub bị trì hoãn, thậm chí bị bỏ qua. Re-run thủ công lúc khoảng **08:04** lấy EP001 nhưng bị Meta từ chối binary upload:

`Meta upload HTTP 400: Invalid Header format: expected either both Content-Length and X-Entity-...`

Sửa worker: gửi `Content-Length` và `X-Entity-Length` theo đúng kích thước MP4, bên cạnh `file_size`, `offset`; chỉ xử lý tối đa ba bài quá hạn mỗi lượt chạy. Lỗi đã qua bước nhận phiên upload Meta, nhưng **chưa từng gọi finish/publish**. Bài lỗi như trên có thể đưa về queue an toàn bằng nút **Thử đăng lại**.

Mã nguồn/CI có thể xác minh cú pháp và header nhưng chưa chứng minh upload thành công khi chưa thử với Meta thật sau sửa.

## Khôi phục EP001 ngay sau deploy

1. Vercel → Deployments → Production, bảo đảm chứa commit đã sửa.
2. Mở `https://anpinime-dramavideo.vercel.app/#reels` → **Làm mới** → chọn Page → ngày 06/11 → EP001 (hiện trạng thái **Lỗi** sau lần worker thất bại).
3. Nhấn **Chi tiết → Thử đăng lại**. Chỉ các lỗi 400 xảy ra *trước* bước phát hành mới có nút này; lỗi không rõ kết quả phải **Đối soát Meta** trước để tránh đăng trùng.
4. Nếu hiển thị `Đã đưa về hàng đợi` mà chưa có worker chạy, vào GitHub → Actions → **Process Facebook Reels Queue** → **Run workflow** (branch `main`). Nếu Vercel đã có token dispatch ở phần dưới, nút thử lại tự yêu cầu GitHub Actions chạy.
5. Mở log GitHub và cập nhật website. Worker sẽ chuyển bài từ `queued` sang `processing`; sau khi Meta báo hoàn tất, trạng thái thành `published`. Nếu video không hợp lệ/thiếu quyền Meta, lỗi mới sẽ hiển thị trong popup.
6. Tuyệt đối không tạo lại chiến dịch hoặc tự đăng thêm cùng một tập trước khi kiểm tra Meta nếu kết quả chưa rõ.

## Tùy chọn: tự chạy gần đúng giờ qua Supabase Cron

**GitHub Actions schedule không có SLA về thời điểm chạy**. Để đạt nhịp kiểm tra khoảng 2 phút, thêm Supabase Cron. Cron chỉ yêu cầu **đánh thức GitHub Actions khi có bài đến hạn hoặc đang cần đối soát**. Video luôn truyền từ Google Drive qua GitHub runner sang Meta; Vercel không xử lý file MP4.

Cần cấu hình một lần:

1. Tạo GitHub **fine-grained Personal Access Token** giới hạn riêng repository `tianhainrk/PineDrama-Web-Studio`, quyền **Actions: Read and write**, với hạn dùng phù hợp. Chỉ lưu token trong **Vercel Environment Variables**, tuyệt đối không đưa token vào frontend, GitHub code, SQL hoặc câu chat.
2. Thêm biến môi trường Production cho Vercel:
   - `GITHUB_REELS_WORKFLOW_TOKEN` = token vừa tạo.
   - `REELS_CRON_SECRET` = khóa ngẫu nhiên dài tối thiểu 32 ký tự, khác với token GitHub.
   - `GITHUB_REELS_REPOSITORY` = `tianhainrk/PineDrama-Web-Studio` (có thể bỏ nếu giữ repo mặc định).
   Redeploy Production để Vercel nhận biến mới.
3. Trong Supabase → Database → Extensions, bật **pg_cron** và **pg_net**, sử dụng **Vault**.
4. Supabase → SQL Editor, chỉ chạy trên project Supabase của Anpi Drama:
   ```sql
   select vault.create_secret('REPLACE_WITH_YOUR_REELS_CRON_SECRET', 'anpi_reels_cron_secret');
   ```
   Thay literal bằng đúng `REELS_CRON_SECRET` trong Vercel. Không chia sẻ bí mật này và không commit câu SQL đã thay giá trị lên GitHub.
5. Chạy [supabase/reels-worker-cron.sql](../supabase/reels-worker-cron.sql). Lịch `*/2 * * * *` gọi `POST https://anpinime-dramavideo.vercel.app/api/reels/cron`; Vercel kiểm tra shared secret và query Supabase xem có bài đến giờ hay đang `processing`. Nếu không có, trả 200 và **không gọi GitHub**; nếu có, gọi Github workflow_dispatch bằng token trên Vercel.
6. Kiểm tra Supabase → Integrations → Cron → History và GitHub Actions → Process Facebook Reels Queue. Nếu muốn dừng, dùng `select cron.unschedule('anpi-reels-dispatch');`.

**Lưu ý bảo mật:** pg_net lưu tạm header request trong bảng hàng đợi. Secret này chỉ được quyền đánh thức workflow (không có quyền đọc Meta/Google token), nhưng cần giới hạn quyền đọc DB theo nguyên tắc tối thiểu. Mọi truy cập endpoint cron đều phải có secret; API đăng ký vẫn yêu cầu cookie đăng nhập.

Nếu không muốn cấu hình Supabase Cron, website vẫn chạy lịch GitHub Actions fallback (sau khi chuyển cron lệch phút cao điểm), nhưng **không bảo đảm đúng giờ**. Nút Thử đăng lại hoạt động ở chế độ queued dù chưa có token dispatch; khi đó bạn phải chạy workflow thủ công nếu lịch GitHub chưa kích hoạt.

## Cần giám sát

- Một lần GitHub Actions thành công về mặt CI **không chứng minh** video đã lên Facebook. Xem `reel delivered to Meta` trong log; đợi worker đối soát trạng thái `published`.
- Upload có thể thất bại do Meta từ chối định dạng/thời lượng MP4, token Page hoặc hạn mức đăng. Các lỗi này không được tự động thử lại nếu không biết trạng thái phía Meta.
- Mỗi lượt worker xử lý tối đa **3 bài quá giờ** để giảm tình trạng nghẽn khi lịch đăng ít nhất 10 tập/ngày.
