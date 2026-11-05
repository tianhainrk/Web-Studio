# Anpi Drama — Gemini tự phân tích video và tạo caption hàng loạt

## Mục tiêu

Chọn 1–300 tập trên Google Drive, nhập **một hướng dẫn chung** rồi nhấn **Phân tích MP4 và tạo caption cho toàn bộ tập**. Mỗi tập được đọc từ video MP4 thực tế và Gemini tạo `caption` cùng `summary` để bạn kiểm tra. Chỉ khi **Duyệt và lưu chiến dịch** thì nội dung mới được chuyển vào hàng đợi đăng Meta.

**Lưu ý kỹ thuật:** Một thao tác và một *hướng dẫn chung* không đồng nghĩa với một request Gemini duy nhất: Gemini chỉ nhận tối đa 10 video trong mỗi request. Worker xử lý từng video để tránh bộ nhớ/timeout, lưu tiến độ vào Supabase và tiếp tục sau khi đóng web.

## Thiết lập lần đầu

1. Supabase → Project đang dùng → SQL Editor → chạy đầy đủ [supabase/gemini-video.sql](../supabase/gemini-video.sql). SQL này bổ sung hai bảng `reel_ai_batches`, `reel_ai_items` và RPC `claim_reel_ai_item`. Không xóa/đổi bảng Reels hoặc Drive hiện tại. Cả hai bảng bật RLS và không cho client sử dụng trực tiếp.
2. Vào GitHub repository → Settings → Secrets and variables → Actions → Secrets, thêm **`GEMINI_API_KEY`** (API key từ Google AI Studio). Các secrets đã có cũng phải tồn tại: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REELS_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Trong Actions → Variables, tùy chọn `GEMINI_MODEL=gemini-2.5-flash`.
3. Vercel Production vẫn cần `GEMINI_API_KEY` để chạy chế độ caption metadata nhanh, và các biến kết nối Drive/Supabase như trước. Redeploy nhánh `main`.
4. GitHub Actions → **Analyze Drive Videos with Gemini** → Run workflow để xác nhận secrets/database đã đủ. Không có tác vụ thì log `No Gemini video jobs to analyze` là bình thường.
5. Website → tab **Facebook Reels / Muse** → chọn phim → chọn các tập → chọn **Gemini AI (ưu tiên)** và **Đọc nội dung từng MP4 (Gemini)** → nhập 1 hướng dẫn tạo caption → nhấn tạo. Website sẽ trả `batchId`, bảng tiến độ và tiếp tục cập nhật khi mở trang.
6. Đóng trình duyệt không dừng hàng đợi Supabase/GitHub Actions. Khi trở lại, chọn cùng phim và nhấn **Khôi phục tiến trình Gemini** để xem kết quả. Khi API lỗi, có thể nhấn **Thử lại tập lỗi**.
7. Khi tất cả tập đều có caption, xem phần **Nội dung trong video**, chỉnh sửa giờ/caption trong bảng Excel và nhấn **Duyệt và lưu chiến dịch**. Trước bước này chưa có lệnh đăng Meta.

## Giới hạn vận hành

- Worker hiện xử lý **một MP4 mỗi lượt chạy**, cron kiểm tra khoảng 5 phút/lần (GitHub không bảo đảm lịch chính xác). Với 80 video có thể mất nhiều giờ. Mục tiêu là tính bền vững; không phải xử lý 80 MP4 trong một Gemini request.
- Video tối đa 512 MiB, tệp phải là `video/mp4`, nằm trong thư mục Drive đã chọn và có quyền truy cập với `drive.file`.
- Worker chuyển byte video qua GitHub Actions trực tiếp từ Drive sang **Gemini Files API** (không công khai URL Drive), chờ file ACTIVE, tạo caption dựa trên hình ảnh/âm thanh, rồi cố xóa tệp tạm trên Gemini. Phải có API quota/billing phù hợp; Google AI Pro không tự bảo đảm quota API.
- Caption AI là **bản nháp cần duyệt**. Mô tả của Gemini vẫn có khả năng sai và cần xác nhận nguồn/video thực tế.
- Lỗi tạm thời thử tối đa 3 lần trước khi đánh dấu `failed`. Nút thử lại yêu cầu người dùng thao tác. Bản nháp đã hoàn thành được lưu trong Supabase.
- Hãy bắt đầu với 1–2 video có quyền sử dụng trước khi xếp hàng đợi 80 tập; chuyển file MP4 thực tế qua Gemini có thể làm phát sinh phí API và ảnh hưởng quyền riêng tư.
- Cơ chế `drive.file` không tự mở mọi thư mục Drive cũ được tạo bằng OAuth client khác.
- Nếu Vercel báo bảng `reel_ai_items` không tồn tại, cần chạy đúng SQL ở bước 1. Nếu Actions báo thiếu Gemini key, thêm secret tại GitHub thay vì chỉ thêm ở Vercel.
