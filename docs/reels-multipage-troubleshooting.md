# Hai Fanpage có chiến dịch nhưng chỉ một Page đăng Reels

## Những gì xác minh được

Lần chạy **2026-11-06 lúc khoảng 08:16 (giờ Việt Nam)** gửi thành công một video sang Meta và lượt worker kế tiếp báo `reels worker jobs 0 failed 0`. Log **không chứa đủ dữ liệu để khẳng định** Page thứ hai đã bị Meta từ chối. Các nguyên nhân còn khả thi: chưa đến giờ, chiến dịch không active, Page tạm tắt, bài bị failed, bài đang uploading/processing hoặc worker GitHub chạy không đủ đều.

Hai Page sử dụng token page riêng, được lấy từ `reel_pages` theo từng `page_id`. Lịch trong `reel_jobs` cũng có `page_id` riêng. Tuy nhiên, RPC cũ `claim_reel_jobs` chỉ xếp theo `scheduled_at`. Khi một Page có nhiều video trễ giờ hơn Page kia, nó có thể được ưu tiên liên tục. Worker giới hạn 3 video/lượt, và GitHub Actions Cron không bảo đảm đúng phút, nên tình trạng này càng dễ nhận thấy.

## Những thay đổi trong mã nguồn

- **Trạng thái các Page:** dashboard Reels → **Trạng thái các Page**, hoặc mở **Kết nối**, nhấn **Kiểm tra**. Danh sách có cả hai Page với: tổng chiến dịch, bài quá hạn nhưng đủ điều kiện, bài chưa đến giờ, uploading/processing, đã đăng, bài lỗi và lý do được xác định.
- **Kiểm tra quyền Meta:** mỗi Page có nút riêng, dùng chính token Page đã mã hóa trong Supabase để gọi `/{pageId}?fields=id,name`. Không lộ token trong trình duyệt.
- **Worker logs:** ghi Page ID và job ID mỗi khi nhận bài (không ghi token/caption). Vào GitHub Actions → **Process Facebook Reels Queue** → run mới nhất để biết Page nào thực sự được xử lý.
- **Hàng đợi công bằng:** SQL mới ưu tiên nhận một bài đến hạn từ mỗi Page trước khi nhận bài thứ hai từ một Page. Hàm vẫn dùng PostgreSQL `FOR UPDATE SKIP LOCKED` và trả đúng cấu trúc cũ, nên không phải sửa lại campaign hoặc job đã lưu.

## Bước bắt buộc để cập nhật database

Mã nguồn GitHub **không tự thay đổi RPC đang tồn tại trong Supabase**. Bạn cần thực hiện một lần:

1. Mở đúng dự án Supabase mà Anpi Drama đang dùng → SQL Editor.
2. Mở [supabase/reels-multipage-fair-queue.sql](../supabase/reels-multipage-fair-queue.sql) và chạy nguyên nội dung.
3. SQL chỉ thay function `public.claim_reel_jobs(integer)` và thêm index; **không xóa** các bảng, chiến dịch, video hoặc lịch đăng.
4. Vào web đã deploy mới → tab Reels → Trạng thái các Page → Kiểm tra, xem cả hai Page.
5. Nếu Page thứ hai có **Đến hạn** > 0 và **Fanpage active**, chạy GitHub Actions → **Process Facebook Reels Queue** → Run workflow trên `main` hoặc thiết lập Supabase Cron như [hướng dẫn](./reels-publishing-recovery.md). Worker nhận và upload tối đa 3 bài/lượt.
6. Nếu UI báo chiến dịch inactive/Page đang tắt, bật Page hay mở lại chiến dịch theo ý muốn. Nếu Failed, xem Chi tiết; **không tự thử lại khi chưa rõ Meta đã đăng video hay chưa**. Nếu uploading treo quá 35 phút, kiểm tra Meta Video ID và log trước khi sửa trạng thái. Nếu processing, chờ worker đối soát.
7. Nếu Meta check không thành công, kết nối lại đúng Meta account có quản trị Page và cấp quyền `pages_manage_posts` cùng các quyền Page khác.

Lưu ý: `reel_jobs` giữ unique `(page_id,file_id)`, nên cùng một file MP4 đăng trên **hai Page khác nhau** là hợp lệ. Không cần nhân đôi video trong Google Drive.

## Giới hạn

- Chưa xác minh trực tiếp trạng thái trong Supabase Production hoặc Meta cho Page thứ hai vì GitHub Logs không có snapshot database và tài khoản này không kết nối Supabase vào ChatGPT.
- Diagnostics hiện đọc tối đa 3000 jobs và 500 campaigns. Nếu quá giới hạn, UI báo thống kê có thể chưa đầy đủ.
- Worker Meta có thể trả upload thành công rồi vẫn cần thời gian processing và đối soát. Chỉ trạng thái `published` được hệ thống xem là đã hoàn thành.
