# Anpi Drama Reels — giao diện quản lý theo Fanpage (V2)

Trang: `/#reels`. Reels vẫn là một tab trong ứng dụng chính, không mở `reels.html`.

## Giao diện mới

- **Fanpage đang xem:** đổi Page qua dropdown. Dashboard tính chỉ số và xem các chiến dịch/bài đăng của đúng Page đó, không trộn lẫn Page khác.
- **Tổng quan:** số bài có lịch hôm nay, bài đã đăng hôm nay, bài đang chờ, bài lỗi; lịch 7 ngày và danh sách bài sắp đăng.
- **Lịch đăng:** chọn ngày, xem từng bài theo giờ Việt Nam; mở popup để sửa giờ/caption nếu trạng thái vẫn queued, hủy lịch hoặc đối soát Meta.
- **Chiến dịch:** danh sách ngắn theo Page, chọn để mở lịch liên quan.
- **Kết nối:** popup riêng cho OAuth Drive/Meta, bật/tắt Page và nhật ký.
- **+ Chiến dịch:** popup 3 bước. Bước 1 chọn phim/tập; bước 2 **chỉ có bốn trường hiển thị**: AI thực hiện, Fanpage sẽ đăng, Ngày bắt đầu, Nguồn nội dung cho caption; bước 3 nhập JSON, xem lịch/caption tối đa 12 hàng/trang, sửa qua popup và duyệt.

Không thay đổi các bảng Supabase hiện có, không tự đăng trước khi duyệt. Meta worker và OAuth cũ vẫn hoạt động.

## AI tự chia ngày và đề xuất giờ đăng

Mặc định dùng **Muse với Google Drive đã kết nối**; Gemini chỉ là tùy chọn caption từ metadata, có thể tính phí API. Mỗi phim nhận **một prompt chung** cho toàn bộ tập được chọn.

- Nếu phim có ít nhất 10 tập, hệ thống dùng ít ngày liên tiếp nhất mà mỗi ngày có **ít nhất 10 tập** và số lượng giữa các ngày lệch nhau tối đa một. Dưới 10 tập, đăng trong một ngày là ngoại lệ.
- 71 tập → 7 ngày, lần lượt 11 / 10 / 10 / 10 / 10 / 10 / 10. 80 tập → 8 ngày, 10 tập/ngày.
- Mỗi tập có lịch cơ sở trải đều từ **07:00 đến 23:00 giờ Việt Nam**. Muse được yêu cầu đề xuất giờ trong ngày dựa trên tín hiệu người xem của Page *nếu nó thực sự truy cập được*, ưu tiên kiểm thử giờ trưa/tối nhưng giữ khoảng cách tối thiểu 15 phút.
- Không có Page Insights được đọc trực tiếp trong bản này. Muse/website **không thể biết chắc khung giờ vàng riêng của Page** và không bảo đảm tăng lượt xem. Muốn tối ưu dựa trên dữ liệu thực, cần tích hợp quyền `read_insights`, thu thập chỉ số bài đã đăng và đánh giá hiệu quả theo giờ.
- Server kiểm tra giờ trong khoảng 07:00–23:00, múi giờ, ngày, khoảng cách 15 phút và lịch tương lai trước khi chấp nhận chiến dịch. Nếu JSON Muse cũ có phân bổ ngày không đều, backend giữ caption nhưng chuẩn hóa cả ngày về lịch cân bằng để tránh va chạm.

## JSON Muse đơn giản

```json
{
  "items": [
    {
      "episode": 1,
      "scheduledAt": "2026-12-06T12:00:00.000Z",
      "caption": "Caption từ nội dung phim thực tế..."
    }
  ]
}
```

`summary` và `evidence` là **tùy chọn**. Kết quả cũ có hai trường này vẫn được nhập. Muse được yêu cầu xem video thực tế trong Drive, không bịa nếu không thể truy cập và chỉ xóa **bản sao tạm trong workspace của nhiệm vụ**, không xóa video gốc.

## Thao tác nhanh

1. Mở `/#reels` → chọn Fanpage. Thêm Page/Drive qua **Kết nối** nếu chưa có.
2. **+ Chiến dịch** → chọn thư mục phim và tập cần đăng.
3. Điền bốn trường AI → **Tạo lệnh AI cho toàn bộ tập**. Gửi vào Muse có Google Drive đã kết nối.
4. Tải file JSON Muse trả về → **Nhập JSON Muse**. Website kiểm tra đủ tập và thời gian.
5. Xem phân bổ từng ngày, mở popup chỉnh caption/giờ, nhấn **Duyệt và lưu chiến dịch**.
6. Theo dõi trong **Lịch đăng**, chỉnh bài queued, hủy hoặc đối soát Meta.

## Lưu ý vận hành

- Mục "Đã đăng hôm nay" tính theo các bài **có lịch hôm nay** đã được worker đánh dấu published; không phải mọi bài Facebook phát sinh bên ngoài Anpi Drama.
- Meta worker chạy theo cron nên giờ thực tế có thể trễ vài phút. Đăng nhiều bài mỗi ngày có thể ảnh hưởng chất lượng tiếp cận; theo dõi Page Insights để điều chỉnh chiến lược.
- Trang có thể hiển thị lịch từng Page từ Supabase. Nếu Page có hàng chục nghìn bài, cần tối ưu thêm truy vấn phân trang phía server.
- Không gửi API key, cookie Muse, Google refresh token hoặc Meta token cho AI qua prompt. Chỉ gửi folder ID/file ID đã chọn và dữ liệu lịch.
