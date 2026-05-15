# P19 Driver Trip Mission — 司機任務頁 + 五階段狀態流 + 自動定位

## Why

P18 收尾後盤點 driver 端缺口：
1. **沒有「我被指派的訂單」頁面**：搶單在 `/driver/pending`，但接單後沒地方看自己的任務清單與行程進度
2. **訂單狀態粒度太粗**：`confirmed → in_transit → completed` 中間缺「出發 / 到點」兩個關鍵節點，admin 無法在 war-room 即時看到司機目前進度
3. **司機定位機制錯位**：依賴司機在 `/driver/trip` 手動按「上線」才啟動 GPS；P18 暴露問題後，使用者要求改為「**登入 driver 端就自動授權 + 持續上傳**」，且不再有手動上下線按鈕
4. **war-room 邏輯瑕疵**：marker 沒清理會 leak、stale 資料不過濾（5 分鐘沒更新仍顯示在線）、靜止司機 heading=null 會被當成指北
5. **driver/trip onMounted race**（部分由 P18 hotfix v2 解決，但本 spec 也會驗證）

## What Changes

### 訂單狀態流（新增 2 個狀態值）

| status | 觸發 | 司機 UI 按鈕 |
|--------|------|------|
| `pending` | 乘客送出 | (driver 看不到) |
| `confirmed` | 司機搶單 / admin 指派 | 「前往上車點」 |
| `en_route` | 司機按「前往上車點」 | 「已到達上車點」 |
| `arrived_pickup` | 司機按「已到達上車點」 | 「乘客已上車」 |
| `in_transit` | 司機按「乘客已上車」 | 「乘客已下車（完成）」 |
| `completed` | 司機按「乘客已下車」 | (從列表移除) |
| `cancelled` | 乘客 / admin 取消 | (driver 看不到) |

### Driver Status 重新設計（**重要決策，需 Brain AI 確認**）

P18 設計：driver 在 `/driver/trip` 手動按「上線/下線」切 status。
P19 改：司機登入 driver 端即自動 online；登出 / 關 LIFF 時 60 秒後自動 offline。

| status | 語意 | 寫入時機 |
|--------|------|---------|
| `online` | driver 在線且未在執行訂單（含「已接單但未出發」） | location.put 第一次寫；訂單由 `in_transit → completed` 後 server 切回（如無其他執行中訂單） |
| `busy` | driver 正在「執行」訂單（出發中 / 到點 / 載客中） | 訂單由 `confirmed → en_route` 時 server 自動切（**不是接單時**） |
| `offline` | **不寫入 Firestore**；war-room 端看 `lastActiveAt > 600s (10 分鐘) ago` 推導 | 自動推導（無 explicit write） |

> **busy 觸發點重要決策**：使用者指定 `busy` 不從「接單」開始，而是司機按「出發」（confirmed → en_route）那一刻才切。confirmed 階段 driver 是「已接單待出發」，仍視為 online 並有 active assigned order 顯示在 war-room。

→ `drivers.status` Firestore 欄位只會是 `online` 或 `busy`；war-room 客戶端依 `lastActiveAt` 推導 `offline`。

### 自動定位（driver 端 layout 層級）

- 進入 `/driver/*` 任何路徑 → driver layout `onMounted` 跑 `_RequestGeoPermissionFlow()`
- 流程：
  1. `getCurrentPosition()` 觸發瀏覽器 / LINE WebView 授權彈框
  2. 通過 → 啟動 `watchPosition` + 上傳 loop
  3. 拒絕 → 顯示 blocking modal「司機端需要位置權限以執行任務追蹤」+「重試授權」按鈕
  4. 連續拒絕 2 次 / 5 秒沒回應 → 強制 `navigateTo('/home')`
- 上傳節流：
  - 第一次座標必傳
  - 後續：距前次 < 5m 不上傳；無位置變化 60 秒沒上傳 → 強制傳一次（war-room alive ping）
  - 訂單狀態變更（前往/到點/上車/下車）即使 0m 也立即上傳
  - accuracy > 50m 的座標不上傳（cold start 期間先收斂再回報）
- unmount 時 `clearWatch` 防 leak（但實際上司機在 driver 端整段期間都不會 unmount，除非離開 `/driver/*`）

### War-room polish

| 項目 | 修法 |
|------|------|
| markerMap leak | unmount 時遍歷 `setMap(null) + clear()` |
| stale 資料 | client filter `lastActiveAt < now - 60s` 推導為 offline |
| heading 靜止指北 | heading=null 時改畫圓點，有值才畫箭頭 |
| 沒有狀態 filter | UI 加「上線 / 任務中 / 離線 / 全部」radio filter |
| 任務中顯示訂單 | busy driver 在側邊面板顯示訂單號（後 6 碼）+ 當前 order status（出發中 / 到點 / 載客中） |
| 不顯示 accuracy 給司機 | UI 不顯示，但 location 物件含 accuracy 欄位（war-room 後續可用） |

### 後端 API 改動

- 新增 `/nuxt-api/orders/assigned.get.ts`：driver 取自己被指派的 active orders（status 屬於 confirmed / en_route / arrived_pickup / in_transit）
- 修改 `/nuxt-api/orders/[orderId].patch.ts`：
  - 接受新 status 值 `en_route`, `arrived_pickup`
  - driver 自己的 active order 可改 status（按嚴格狀態機：confirmed → en_route → arrived_pickup → in_transit → completed）
  - status `confirmed` / `cancelled`（owner 取消）已存在
  - status 切換為 `en_route` 時 server 自動把 driver doc 的 status 設 busy（**不是 confirmed**）
  - status 切換為 `completed` 時 server 自動把 driver doc 的 status 設 online（query 是否仍有他張執行中訂單；無則切回 online）
- 修改 `/nuxt-api/drivers/available.get.ts`：
  - 改撈**所有 location 不為 null 的 drivers**（不限 status='online'/'busy'），讓 war-room 能切「全部」filter
  - 回傳新增 `lastActiveAt` 欄位
  - 回傳 active order 概要（busy driver 才有）：`activeOrder: { orderId, orderStatus } | null`
- 修改 `/nuxt-api/drivers/[id]/location.put.ts`：
  - 寫入時順便把 status 設 `online`（如目前不是 busy）；僅 driver 自己呼叫 → server 不主動寫 busy
  - 接受 accuracy 欄位（optional），與 location 一起寫入

### 前端改動

- 重寫 [app/pages/driver/trip/index.vue](app/pages/driver/trip/index.vue)：
  - 移除上線/下線按鈕、GPS 顯示卡（GPS watch 上移到 layout）
  - 顯示「我的任務列表」（卡片陳列 confirmed / en_route / arrived_pickup / in_transit 訂單）
  - 每張卡片底部單一主按鈕，依 status 顯示對應動作
  - 30 秒 polling refresh 列表 + visibility 切回時立即 refresh
- 新增 composable [app/composables/use-driver-geolocation.ts](app/composables/use-driver-geolocation.ts)：
  - 統一 watchPosition / 5m+60s 邏輯 / unmount cleanup
  - layout 呼叫，整 driver 端期間 share state
- 修改 [app/layouts/driver.vue](app/layouts/driver.vue)：
  - onMounted 跑授權 flow
  - 拒絕授權 modal + 重試
  - layout-level 的 GPS watch
- 修改 [app/pages/admin/war-room/index.vue](app/pages/admin/war-room/index.vue)：
  - 上述 polish 4 項
  - 狀態 filter UI

### i18n / type 對齊（P17 強制規範）

- `i18n/locales/{zh,en,ja}.js` 新增 `status.en_route`, `status.arrived_pickup` + driver/trip 各 button label
- TripStatus type 新增 `en_route` / `arrived_pickup`
- STATUS_CLS / STATUS_TAB_KEYS 對齊（passenger 端 upcoming 頁也要更新）

## Capabilities

### New Capabilities

- `driver-mission-flow`: driver 端任務頁 + 五階段狀態流；driver 操作每張訂單從接單到完成
- `driver-auto-geolocation`: driver 端自動定位（layout-level watchPosition + 5m/60s + accuracy filter）
- `war-room-status-filter`: war-room 依司機狀態（上線 / 任務中 / 離線 / 全部）篩選顯示

### Modified Capabilities

- `driver-collection`（P18 新增）：drivers.status 語意改為「online / busy」，offline 由 lastActiveAt 推導
- `order-status`：訂單狀態流從 4 階段擴充為 6 階段

## Impact

**程式碼**：
- 新增：`server/routes/nuxt-api/orders/assigned.get.ts`、`app/composables/use-driver-geolocation.ts`
- 修改：driver/trip / driver layout / war-room / orders patch / drivers available.get / location.put / i18n × 3 / order type / TripStatus enum

**資料**：
- Firestore drivers doc 新增 `location.accuracy` 欄位（optional，新資料才有）
- 既有 drivers doc 不需 migration（status='offline' 的 doc 在 driver 下次登入時會自動切 online）
- 訂單既有資料不影響（新狀態值僅新訂單會用到）

**安全**：
- `orders/[orderId].patch.ts` driver 改 status 必須驗：(a) auth 是 assignedDriverId 本人 (b) 狀態轉換符合狀態機（不可跳階段）

**風險**：
- driver 拒絕授權後被踢回 `/home`，可能造成多重身分（driver + passenger）使用者誤以為「司機端壞掉」→ modal 文案要清楚說明「請至設定開啟位置權限」
- LINE WebView 第一次彈框會中斷使用體驗（無解，物理限制）
- driver 端整段期間 watchPosition 未停 → 耗電；但 enableHighAccuracy 加 30s 上傳 + 5m threshold 已在合理區間
