# QUY TRÌNH VÀ PHƯƠNG PHÁP ĐO LƯỜNG KIỂM CHỨNG HIỆU NĂNG
## BENCHMARK METHODOLOGY & LATENCY VERIFICATION PROTOCOL
### Hệ thống Quản trị Ticket IT HelpDesk

---

## 1. MỤC TIÊU VÀ PHẠM VI ĐO LƯỜNG (OBJECTIVES & SCOPE)

Mục tiêu của tài liệu này là chuẩn hóa phương pháp đo lường định lượng hiệu năng của hệ thống IT HelpDesk, nhằm kiểm chứng việc cắt giảm độ trễ từ mức hiện tại (**200ms – 3.850ms**) xuống mức tức thì (**< 16ms – 50ms**) cho người dùng cuối.

Hệ thống đo kiểm được thiết kế theo mô hình 3 tầng toàn diện:
1. **Tier A - Micro-Benchmark Backend & Database Engine**: Đo kiểm trực tiếp độ trễ mạng vật lý (RTT), thời gian thực thi câu lệnh SQL tuần tự so với Batching (`client.batch`), và thời gian phản hồi của bộ nhớ đệm RAM (LRU Cache) bằng Node.js script tự động với các chỉ số phân vị thống kê ($p_{50}, p_{90}, p_{95}, p_{99}$, Min, Max, Trung bình).
2. **Tier B - Stress Test Tải Đồng thời (Autocannon Load Testing)**: Đánh giá thông lượng (Throughput - req/sec) và độ trễ dưới áp lực nhiều kết nối đồng thời (Concurrency: 1, 10, 20, 50 connections).
3. **Tier C - Browser User Timing & Optimistic UI Rubric**: Chuẩn hóa phương pháp đo lường độ trễ cảm nhận thực tế của người dùng trên trình duyệt (Perceived Response Time) bằng chuẩn W3C User Timing API (`performance.mark` / `measure`) kết hợp với Chrome DevTools Network Throttling.

---

## 2. TIER A: TIÊU CHUẨN MICRO-BENCHMARK BACKEND & STATISTICAL METRICS

### 2.1 Các chỉ số thống kê bắt buộc (Statistical Percentiles)
Để tránh sai lệch do hiện tượng đỉnh nhọn đột biến (latency spikes) hoặc kết nối lạnh (cold start), mọi phép đo định lượng phải thu thập tối thiểu 20 – 100 lần lặp (iterations) và tính toán đầy đủ các chỉ số:
- **Min / Max**: Độ trễ thấp nhất và cao nhất ghi nhận được trong chu kỳ đo.
- **Average (Mean)**: Độ trễ trung bình cộng: $\bar{x} = \frac{1}{N}\sum_{i=1}^{N} x_i$.
- **p50 (Median)**: Điểm phân vị 50% — phản ánh trải nghiệm điển hình của người dùng thông thường.
- **p90 / p95**: Điểm phân vị 90% và 95% — phản ánh trải nghiệm của người dùng trong điều kiện mạng biến động.
- **p99 (Tail Latency)**: Điểm phân vị 99% — phát hiện các trường hợp nghẽn cổ chai tồi tệ nhất do dọn rác RAM (Garbage Collection) hoặc trễ mạng xuyên lục địa.

### 2.2 Các kịch bản đo lường trong `scripts/benchmark_latency.js`
Script thực thi tự động (`scripts/benchmark_latency.js`) bao gồm 5 kịch bản cốt lõi:
1. **Scenario 1: Raw Physical Network RTT**: Đo thời gian ping câu lệnh `SELECT 1` gửi trực tiếp đến cụm máy chủ Turso Cloud (Frankfurt/Singapore).
2. **Scenario 2: Sequential Queries vs Batched Queries**:
   - Baseline: Chạy tuần tự 3 câu lệnh SQL (`SELECT ticket` -> `SELECT attachments` -> `SELECT history`) tương ứng với `getTicketById` hiện tại.
   - Optimized: Chạy 1 lệnh `client.batch` gom cả 3 câu truy vấn trong một HTTP request duy nhất.
3. **Scenario 3: Status Update Transaction Lifecycle**:
   - Baseline: Mô phỏng 10 chặng RTT tuần tự (luồng cập nhật trạng thái cũ).
   - Optimized: Mô phỏng 1 chặng RTT sử dụng `client.batch` ghi kết hợp đọc dữ liệu.
4. **Scenario 4: Backend LRU In-Memory Cache**:
   - Đo thời gian phản hồi khi Cache Miss (truy vấn DB) so với Cache Hit (trích xuất tức thì từ RAM Node.js).
5. **Scenario 5: Local Embedded Replica vs Cloud Remote**:
   - So sánh thời gian đọc từ tệp SQLite cục bộ (`< 1ms`) so với đọc qua mạng Cloud (`~215ms` hoặc `~30ms`).

---

## 3. TIER B: QUY TRÌNH STRESS TEST TẢI ĐỒNG THỜI (AUTOCANNON LOAD TEST)

Để đánh giá mức độ chịu tải và nguy cơ nghẽn hàng đợi (`txQueue`), hệ thống sử dụng công cụ chuẩn công nghiệp `autocannon`.

### 3.1 Kịch bản kiểm thử tải danh sách Ticket (`GET /api/tickets`)
```bash
# Kịch bản kiểm thử thông lượng 20 kết nối đồng thời trong 10 giây
npx autocannon -c 20 -d 10 -p 1 http://localhost:3000/api/tickets
```
- **Tiêu chuẩn chấp thuận (Acceptance Criteria)**:
  - *Hiện trạng (Baseline)*: ~15 – 30 req/sec, độ trễ trung bình ~600 – 700ms.
  - *Sau khi tối ưu (LRU Cache + Batching)*: **> 2.500 req/sec**, độ trễ trung bình **< 5ms**, 0% lỗi socket timeout.

### 3.2 Kịch bản kiểm thử Dashboard Metrics (`GET /api/dashboard/metrics`)
```bash
npx autocannon -c 20 -d 10 -p 1 http://localhost:3000/api/dashboard/metrics
```
- **Tiêu chuẩn chấp thuận**:
  - *Hiện trạng*: ~30 – 50 req/sec, độ trễ trung bình ~250 – 400ms.
  - *Sau khi tối ưu (LRU Cache)*:
    - **Single-instance Express (Node.js đơn luồng trên Windows)**: Đạt **> 2.000 – 2.500 req/sec**, độ trễ $p_{99}$ **< 3ms**.
    - **Multi-core Cluster / PM2 Workers**: Đạt **> 4.000 req/sec**, độ trễ $p_{99}$ **< 3ms** khi tải được dàn đều qua các CPU cores.

---

## 4. TIER C: PHƯƠNG PHÁP ĐO LƯỜNG ĐỘ TRỄ CẢM NHẬN TRÊN TRÌNH DUYỆT (USER TIMING RUBRIC)

Độ trễ cảm nhận của người dùng (Perceived Latency) là khoảng thời gian từ thời điểm người dùng click chuột/nhấn phím đến thời điểm mắt người dùng nhìn thấy sự thay đổi trực quan trên màn hình (đổi màu badge, nhảy số dashboard, mở modal).

### 4.1 Mô phỏng độ trễ mạng thực tế trên Chrome DevTools
Để loại trừ yếu tố sai lệch khi chạy backend trên `localhost`, kiểm thử viên bắt buộc phải thiết lập bộ lọc giả lập mạng:
1. Mở Chrome DevTools (F12) -> Thẻ **Network**.
2. Tại mục Throttling, chọn **Add Custom Profile...**:
   - **Profile Name**: `Turso Cloud Frankfurt WAN`
   - **Download**: 25 Mbps
   - **Upload**: 10 Mbps
   - **Latency (RTT)**: **250 ms**

### 4.2 Cài đặt cọc mốc đo lường bằng User Timing API (`performance.mark`)
Trong mã nguồn giao diện (`public/js/modal.js` và `public/js/tickets.js`), tích hợp các điểm đo kiểm. Để đo lường chính xác thời điểm trình duyệt hoàn tất rasterization và paint lên màn hình (thay vì chỉ tính toán layout/style trước khi vẽ), áp dụng mẫu hình double-rAF (`requestAnimationFrame(() => requestAnimationFrame(...))`):

```javascript
// Khi người dùng bấm nút chuyển trạng thái:
function onStatusButtonClick(nextStatus) {
  // 1. Đánh dấu mốc bắt đầu thao tác
  performance.mark('status-click-start');

  // 2. Thực hiện cập nhật Optimistic UI (đổi màu badge, cập nhật DOM)
  updateBadgeOptimistically(nextStatus);

  // 3. Đo thời gian ngay sau khi trình duyệt render và paint khung hình hoàn chỉnh (Double-rAF)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      performance.mark('status-ui-rendered');
      performance.measure('Perceived_UI_Latency', 'status-click-start', 'status-ui-rendered');
      
      const uiMeasure = performance.getEntriesByName('Perceived_UI_Latency').pop();
      console.log(`[PERF BENCHMARK] Perceived UI Latency: ${uiMeasure.duration.toFixed(2)} ms`);
    });
  });

  // 4. Đo thời gian đồng bộ mạng hoàn tất
  fetch(`/api/tickets/${ticketId}/status`, { method: 'PATCH', ... })
    .then(() => {
      performance.mark('status-network-complete');
      performance.measure('Network_Sync_Latency', 'status-click-start', 'status-network-complete');
      
      const netMeasure = performance.getEntriesByName('Network_Sync_Latency').pop();
      console.log(`[PERF BENCHMARK] Network Sync Latency: ${netMeasure.duration.toFixed(2)} ms`);
    });
}
```

### 4.3 Thang điểm đánh giá độ mượt mà (Performance Rubric)

| Thao tác người dùng | Ngưỡng Kém (Unacceptable) | Ngưỡng Chấp nhận được (Acceptable) | Ngưỡng Hoàn hảo (Optimistic SLA) |
|---|---|---|---|
| **Mở Modal Chi tiết Ticket** | > 300 ms (Chờ mạng) | 100 – 200 ms | **< 16 ms** (Hiển thị ngay từ AppStore) |
| **Cập nhật Badge Trạng thái** | > 500 ms (Chờ mạng) | 100 – 250 ms | **< 16.6 ms** (Đổi màu ngay trong 1 frame) |
| **Đóng Form & Tạo Ticket mới**| > 1.000 ms (Đơ form) | 200 – 400 ms | **< 16 ms** (Đóng form ngay, chèn dòng pending) |
| **Chuyển Tab Dashboard ↔ List**| > 400 ms (Fetch lại) | 100 – 200 ms | **< 5 ms** (Chuyển view tức thì từ RAM) |

---

## 5. HƯỚNG DẪN THỰC THI SCRIPT BENCHMARK TỰ ĐỘNG

Script đo lường được đặt tại `scripts/benchmark_latency.js`.

### Cách chạy script:
```bash
# Hiển thị tài liệu hướng dẫn và danh sách tham số CLI
node scripts/benchmark_latency.js --help

# Chạy đo kiểm toàn bộ các kịch bản với Turso Cloud
node scripts/benchmark_latency.js

# Chạy đo kiểm ngoại tuyến mô phỏng cục bộ (không cần internet)
node scripts/benchmark_latency.js --iterations=1 --offline
```

### Tùy chọn tham số:
- `--iterations=N`: Số lần lặp đo kiểm (mặc định: 20 lần).
- `--offline`: Chạy mô phỏng đo kiểm với cơ sở dữ liệu in-memory cục bộ khi không có kết nối internet ra Turso Cloud.
- `--json`: Xuất kết quả dưới định dạng JSON phục vụ CI/CD hoặc vẽ đồ thị.
- `--output=FILE`: Lưu ma trận kết quả benchmark dưới dạng tệp JSON theo đường dẫn chỉ định.
- `--help`, `-h`: Hiển thị hướng dẫn sử dụng và thoát cleanly với exit code 0.

