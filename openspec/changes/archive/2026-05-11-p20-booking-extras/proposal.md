# P20 Booking 表單擴充 — 補上 4 個必要欄位

## Why

P19 driver/trip modal 設計顯示「乘客電話 / 航班 / 航廈 / 備註」等欄位，但 booking 表單從未收集這些資訊：
- `contactPhone`：driver 看不到乘客電話 → P19 暫顯示「請透過 LINE 聯絡」placeholder
- `flightNumber` / `terminal`：接送機 driver 不知道哪班機哪航廈
- `notes`：乘客特殊需求無管道告訴 driver

P19 已 ship driver 端可顯示這些資訊（fallback 處理），但實際資料來源缺失，等於 driver 端 UI 是「裝飾」。本 spec 補齊資料寫入鏈。

## What Changes

### 新增 4 個 booking 表單欄位

| 欄位 | 必填 | 顯示條件 | 驗證 |
|------|------|---------|------|
| `contactPhone` | ✅ 必填 | 永遠顯示 | 09xxxxxxxx 格式（10 碼，0 開頭） |
| `flightNumber` | optional | orderType in `[airport-pickup, airport-dropoff]` 才顯示 | 1-10 字英數 |
| `terminal` | optional | orderType in `[airport-pickup, airport-dropoff]` 才顯示 | 下拉選單：T1 / T2 |
| `notes` | optional | 永遠顯示 | textarea，limit 200 字 |

### 修改範圍

- **server**：`server/routes/nuxt-api/orders/index.post.ts` 接收 4 欄位 + Firestore 寫入
- **client booking 表單**：`app/pages/booking/index.vue` 加 4 欄位 UI + 驗證
- **client API type**：`app/protocol/fetch-api/api/order/type.d.ts` `CreateOrderParams` 加欄位
- **i18n**：`i18n/locales/{zh,en,ja}.js` 三檔對應 label / placeholder / 錯誤訊息

### 既有資料兼容

- 4 個欄位在 Firestore order doc 都是 nullable（舊訂單 `contactPhone=undefined` 仍能讀）
- driver/trip modal 已有 `if value` 判斷，舊訂單顯示「—」即可
- assigned.get.ts 已 spread 完整欄位 + null fallback，本 spec 不需動 server read 端

## Capabilities

### Modified Capabilities

- `passenger-booking`：表單擴充 4 欄位
- `order-data-model`：Firestore order doc schema 加 contactPhone / flightNumber / terminal / notes
- `driver-trip-mission`（P19）：modal 顯示這些欄位的 fallback 文案不再需要（有真實資料就顯示）

## Impact

- 既有訂單**不影響**：欄位 nullable
- 既有 driver/trip modal **不需改**：已有 `if value` 判斷
- 風險：表單 UI 變動，需測試 4 步驟 form 不破壞既有 booking flow
