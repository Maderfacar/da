# 管理員自動通知 + Admin Dashboard

> 日期：2026-05-17
> 狀態：提案（待 Brain AI 拍板 design.md 結尾決策點 → 開工）

## Why

目前專案所有自動通知只發給乘客或司機，**沒有任何事件會主動通知管理員**：

- 司機提交申請後，admin 不會收到通知，只能自己定期打開 `/admin/drivers` 看待審清單
- 新訂單成立、訂單狀態變更，admin 同樣無感，得自己刷 `/admin/orders`
- admin 端只能「拉」資料，系統不會「推」 —— 待辦容易被漏看，回應延遲

實證（搜尋整個 `server/`）：

- `orders/index.post.ts:271-298` 訂單成立推播寫死 `sendLinePush('passenger', ...)`，收件人是下單乘客
- `driver/apply.post.ts:205-208` 司機申請推播寫死 `sendLinePush('driver', ...)`，收件人是申請者本人
- 沒有 admin OA channel、沒有 admin 收件人解析邏輯

## What Changes

### Part A：管理員自動 LINE 推播

三個事件觸發後，自動推播 LINE 訊息給「所有具 `canManageOrders` 權限的 admin」，逐一推到每位 admin 的個人 LINE。

| 觸發事件 | 進入點 | 現況 |
|---|---|---|
| 訂單新增 | `server/routes/nuxt-api/orders/index.post.ts` | 只推乘客 |
| 訂單新增（admin 手動建單） | `server/routes/nuxt-api/admin/orders/index.post.ts` | 無推播 |
| 訂單狀態更新 | `server/routes/nuxt-api/orders/[orderId].patch.ts` | 只推乘客 |
| 司機提交申請 | `server/routes/nuxt-api/driver/apply.post.ts` | 只推司機本人 |

關鍵技術決策（已與架構師 Brain AI 確認）：

- **推播管道**：共用現有 **passenger OA**（`sendLinePush('passenger', ...)`），不新增第三個 channel
- **狀態更新範圍**：**全部狀態變更都推**，含 admin 自己操作造成的變更（不排除操作者本人）
- **收件人**：`admins` collection 中，依 `level`（`LEVEL_TABLE`）+ `permissions` override 判定具 `canManageOrders` 者；`admins` doc id 即 lineUid，直接作為推播目標
- **fire-and-forget**：推播失敗不影響主流程（對齊現有 `orders/index.post.ts` 的 `void async` 模式）

### Part B：Admin Dashboard 頁面

新增 `/admin/dashboard` 路由（`back-desk` layout）。第一版範圍僅「線上名單」：

- **線上乘客**：`users.lastSeenAt` 在 5 分鐘內 → 顯示數量 + 名單
- **線上司機**：`drivers.lastActiveAt` 在 5 分鐘內 → 顯示數量 + 名單
- 30 秒輪詢自動刷新
- **不做**待辦統計卡（待審司機數、待派訂單數等）

## Impact

### Affected specs

- 新建：`admin-notifications`（管理員自動通知行為）
- 新建：`admin-dashboard`（線上名單頁面）

### Affected code

| 檔案 | 動作 |
|---|---|
| `server/utils/admin-recipients.ts` | 🆕 解析具指定權限的 admin lineUid 清單 |
| `server/utils/notify-admins.ts` | 🆕 對 admin 清單逐一 fire-and-forget 推播 |
| `server/routes/nuxt-api/orders/index.post.ts` | 加 admin 通知（訂單新增） |
| `server/routes/nuxt-api/admin/orders/index.post.ts` | 加 admin 通知（手動建單） |
| `server/routes/nuxt-api/orders/[orderId].patch.ts` | 加 admin 通知（狀態更新） |
| `server/routes/nuxt-api/driver/apply.post.ts` | 加 admin 通知（司機申請） |
| `server/routes/nuxt-api/admin/dashboard/online.get.ts` | 🆕 線上名單 API |
| `app/pages/admin/dashboard.vue` | 🆕 Dashboard 頁面 |
| `app/layouts/back-desk.vue` | `ALL_NAV_ITEMS` 新增 dashboard 選單項 |
| `app/protocol/fetch-api/api/admin/*` | 🆕 dashboard API 定義 |
| `i18n/locales/{zh,en,ja}.js` | 新增 `adminNotify.*` + `adminDashboard.*` 鍵 |

### 不影響

- 既有乘客 / 司機推播邏輯完全不動，只在其後追加 admin 通知
- 不新增 LINE OA channel，`LineClient` 型別不變
- 既有 admin 頁面與權限模型（`require-permission.ts`）不動

## Non-goals（明確排除）

- 不新增 admin 專屬 OA channel
- 不做推播降噪（批次 / 摘要 / 免打擾時段）—— 「全部都推」為已拍板決策
- admin 通知文案**不做模板化**（不進 `notification-templates` 編輯器）；走 i18n hard-code 文案
- Dashboard 不做待辦統計卡、地圖、即時心跳連線
- 不做 email / 站內通知管道
