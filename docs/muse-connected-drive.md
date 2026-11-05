# Muse đã kết nối Google Drive — caption 80 tập bằng một lệnh

## Chế độ mặc định mới

**Muse + Google Drive** được chọn mặc định trong Anpi Drama. Website không gửi video qua Gemini API. Muse dùng tài khoản Drive đã được bạn kết nối **trong chính giao diện Muse**, nếu phiên Muse đó thực sự có khả năng xem/đọc MP4 qua connector.

**Quan trọng:** Anpi Drama KHÔNG truy cập tài khoản Muse, không thể điều khiển Muse ở chế độ chat trực tiếp, không thể xác nhận Muse đã xem video hoặc đã xóa tệp trong workspace. Đây là cơ chế tạo lệnh chính xác để bạn dán sang phiên Muse đã có quyền truy cập, rồi kiểm tra JSON mà Muse xuất ra. Repo `muse2api` chỉ hỗ trợ API chat/video, không chứng minh rằng nó kế thừa connector Google Drive của phiên Muse; tránh coi đó là tính năng đã được xác minh.

## Các bước sử dụng

1. Trong Anpi Drama → **Facebook Reels / Muse**, kết nối Drive và Fanpage rồi chọn phim và các tập (ví dụ 80 tập).
2. Chọn **Muse – Drive đã kết nối**, nguồn **Muse tự xem MP4 từ Drive đã kết nối**, cách kết nối **Dùng Muse đã kết nối Google Drive**.
3. Nhập tên chiến dịch, Fanpage, ngày và giờ đăng, số tập/ngày, văn phong. Nhấn **Tạo một lệnh Muse cho tất cả tập**.
4. Nhấn **Sao chép lệnh** và gửi nguyên văn vào Muse của bạn đã kết nối Drive. Prompt bao gồm link Drive folder, ID, danh sách EPxxx.mp4 và lịch chính xác; **không chứa API key/OAuth token**.
5. Muse được yêu cầu tự mở đúng video, phân tích nội dung có thể xác nhận (với summary và evidence), viết caption, xuất `anpi-reels-plan.json` gồm mọi tập đã xem; những video không đọc được phải nằm trong `skipped`.
6. Muse được yêu cầu xóa **chỉ các bản sao MP4, audio, khung hình, file trung gian do chính tác vụ tải về workspace** sau khi đã xuất JSON; không được đụng vào video gốc trên Drive hoặc output JSON. Cần tự báo cáo `cleanup.status`, nhưng bạn vẫn phải kiểm tra workspace nếu có thể.
7. Tải file `anpi-reels-plan.json` do Muse xuất, chọn trong ô **Hoặc chọn file JSON** của Anpi Drama (hoặc dán JSON thủ công), nhấn **Nhập kết quả Muse vào bảng**.
8. Bảng Excel hiển thị từng tập, giờ VN, summary/evidence, caption. Chỉ khi đủ tất cả tập đã chọn và lịch hợp lệ nút **Duyệt và lưu chiến dịch** mới sáng. Muse không tự đăng Facebook.

## Một prompt cho 80 tập, không nhất thiết một khối JSON

Bạn ra **một lệnh duy nhất**, Muse được yêu cầu chạy lần lượt đến hết. Để tránh giới hạn độ dài trả lời, prompt ưu tiên Muse tạo file JSON tải về; nếu không có khả năng tạo file, yêu cầu xuất liên tiếp từng nhóm 10–20 tập mà không cần nhắc prompt mới. Anpi Drama có thể nhập các JSON nhóm theo thứ tự và cho phép các nhóm thiếu số tập do video không truy cập được; sẽ không tự điền caption giả.

Định dạng mẫu (giờ UTC; giữ nguyên từ prompt):

```json
{
  "items": [{
    "episode": 1,
    "scheduledAt": "2026-12-20T12:00:00.000Z",
    "caption": "Caption từ nội dung video thật. #PhimNgan",
    "summary": "Tóm tắt một diễn biến đã xác nhận từ video",
    "evidence": "00:10–00:20: lời thoại hoặc chi tiết hình ảnh đã xem"
  }],
  "skipped": [{"episode": 2,"reason": "Không thể mở tệp MP4 qua connector"}],
  "cleanup": {"status": "completed","deletedTempFiles": 1,"remainingTempFiles": 0}
}
```

`cleanup.status=completed` là **Muse tự báo cáo**, không phải xác minh độc lập của Anpi Drama. Không coi caption/summary/evidence là chân lý nếu Muse không thật sự có quyền xem video.

## Ngừng worker Gemini cũ

Để tránh tiếp tục sử dụng quota/chi phí Gemini, workflow `Analyze Drive Videos with Gemini` đã **bỏ lịch cron tự động** và chỉ chạy nếu người dùng chủ động bật `ENABLE_GEMINI_VIDEO_WORKER=true` trong GitHub Actions Variables và chạy bằng tay.

Nếu bạn đã tạo batch Gemini 10 tập trước đó, mục **Xem hàng đợi Gemini cũ** → **Hủy hàng đợi Gemini cũ** sẽ đặt trạng thái `cancelled` trong Supabase, không xóa dữ liệu Drive hay caption đã tạo. Hành động này không dừng ngay một workflow đang chạy tại thời điểm bạn nhấn nút.

Dòng Gemini còn lại trên website là tùy chọn tạo caption **chỉ từ tên phim và metadata**, có thể vẫn phát sinh phí API. Không nhầm đây với chế độ Muse đã kết nối Drive.
