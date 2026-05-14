# 2026-05-14 — 乘客端發佈消息（Passenger Announcements + Layout 改造）

## Why

目前 admin 發訊息只能透過 `/admin/notifications` 即時 broadcast LINE text，痛點：

1. **發送紀錄不持久化**：`history` 是頁面內 `ref<SentRecord[]>`，刷新就消失，無法回頭查
2. **乘客端 App 內無消息入口**：訊息只在 LINE OA 看，使用者離開 LINE 就斷線；錯過推播找不回來
3. **僅支援 text**：[line-push.ts:10-13](server/utils/line-push.ts) `LineMessage` 介面 hardcoded `type: 'text'`；無法做活動推廣 / 優惠券 / 節慶公告等需要圖片 + CTA 的場景
4. **訂單事件無乘客推播**：[P19 backlog](docs/tasks.md#L523) 已列「訂單推送通知 — 待業務優先級確認」；接單 / 狀態變更時不會推 LINE 給乘客（對比：司機端 4 個 push 已於 `cae0d60` 補齊）
5. **底部 5-tab bar 容量上限**：要塞 /notifications + 未讀紅點，5-tab UX 已擠；長期還要加 /profile / 客服等更會擠

## What Changes

### 1. Layout 改造（前置）

- **移除** [front-desk.vue](app/layouts/front-desk.vue) 底部 5-tab bar
- **改用 admin 風格 hamburger drawer**：頂部右側 hamburger 按鈕 → 左側抽屜 280px
- Drawer 內容：
  - 使用者資訊區（頭像 + displayName + LINE friend status）
  - 主導航（**Brain AI 拍板順序**）：
    1. **最新消息**（含未讀紅點，本次新增）
    2. 訂車（`/booking`）
    3. 我的行程（`/upcoming`）
    4. 歷史訂單（`/orders`，原「訂單」改名）
    5. 車型介紹（`/fleet`，原「車隊」改名）
    6. 個人設定（`/profile`）
    7. 客服（外連 LINE OA）
  - 底部：app 版本號（**不放登出**，沿用乘客端無登出政策 commit `473ada0`；首頁由 logo 點擊回 `/home`）
- 頂部 nav 簡化：左 logo / 中央頁面標題 / 右 LangSwitcher + hamburger
- 主要 CTA「訂車」改為 home hero 卡片，不再倚賴底部 tab

### 2. Announcements Firestore Collection

新增 `announcements/{announcementId}` 與 `announcement_reads/{lineUid}/items/{announcementId}` 兩個 collection（schema 見 design.md）

### 3. Admin Editor（rich content L1）

`/admin/notifications` 改寫為 announcement 管理介面：

- 列表（草稿 / 已發佈 / 已下架 三 tab）
- 編輯彈窗：標題（必填）+ 內文 TinyEditor（多段純文字 / 連結 / 粗體斜體）+ **1 張封面圖**（Firebase Storage 上傳）+ **1 個 CTA 按鈕**（label + URL，optional）
- 目標分群：all / passenger / driver / **order**（綁特定 orderId 推給該訂單乘客）
- 通道勾選（解耦 b 方案）：☐ 推 LINE OA  ☐ 顯示在 App 內列表（兩個獨立 checkbox）
- 動作：草稿 / 立即發佈 / 排程（v2 backlog）
- 預覽：右側即時 LINE Flex preview + App 內卡片 preview
- **狀態可循環**（Brain AI 拍板）：
  - draft ↔ published ↔ archived 任意流轉
  - published / archived 都可編輯與刪除
  - archived 可重新發佈（**重發會再推一次 LINE**，admin 須有意識）
  - 純編輯 published 內容不重推 LINE（避免騷擾），只更新 App 內顯示

### 4. LINE 推送整合

- 擴充 [line-push.ts](server/utils/line-push.ts) `LineMessage` 型別：支援 `text` 與 `flex`
- `text` 訊息維持現狀；`flex` 訊息組 L1 Flex Bubble：Hero image + Title + Body + CTA button
- announcement publish → 依目標分群撈 lineUid 列表 + Promise.allSettled 批次推
- **訂單事件自動推（Q2 a）**：5 個觸發點各推一次 sendLinePush 給 owner（lineUid = order.userId）
  - **pending（待確認）**：在 [orders/index.post.ts](server/routes/nuxt-api/orders/index.post.ts) 訂單建立後推（**新增點**）
  - **confirmed（已確認）**：在 [orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) 切 confirmed 時推
  - **en_route**：同上
  - **completed**：同上
  - **cancelled**：同上
  - **不推 arrived_pickup**（Brain AI 拍板移除：乘客通常已在現場，多餘）
- **Admin 手動推單筆（Q2 b）**：訂單詳情頁加「通知乘客」按鈕 → 開彈窗（標題 + 訊息）→ POST `/nuxt-api/admin/orders/[orderId]/notify`（已存在 endpoint，擴充 channel 走 passenger OA）

### 5. 乘客端 /notifications 頁

- 列表頁：分頁 / 未讀紅點 / 點擊跳詳情頁
- 詳情頁：標題 + 封面圖 + 內文 + CTA 按鈕（外部連結用 `target="_blank"`）
- 標已讀：詳情頁開啟即 POST `/nuxt-api/passenger/announcement-reads/[id]`
- 未讀計數：drawer menu 上的 /notifications 入口顯紅點 + 數字

### 6. 權限（Q1 沿用）

- Admin CRUD endpoints 全套 [hasPermission(auth, 'canBroadcast')](server/utils/require-permission.ts)
- 乘客端只能讀自己有權見的 announcement（targetRole 對自己 roles 為 subset OR targetUserId 等於自己）

## Out of Scope（明確不做）

- ❌ L2 / L3 rich content（multi-image / 自由 Flex 排版） — 邊際效益遞減、工程量翻倍
- ❌ 圖文選單入口（Q3 跳過）
- ❌ 排程發佈（用 createdAt 即可，admin 自己抓時間發） — v2 backlog
- ❌ 推播分群進階條件（註冊滿 N 天 / 地區 / 車型偏好） — 第一版只做 all / passenger / driver / order
- ❌ Push notification（系統級 Web Push） — 純走 LINE OA + App 內顯示

## Impact

### 影響範圍

- **新增**：1 個 Firestore collection（`announcements`）+ 1 個 sub-collection（`announcement_reads/{lineUid}/items/{id}`）
- **新增 endpoint**：~10 個（admin CRUD 5 + 圖片上傳 1 + 乘客讀 1 + 標已讀 1 + 訂單事件推共用 inline 不算新 endpoint）
- **新增頁面**：乘客端 /notifications（列表 + 詳情）
- **大改頁面**：admin/notifications（改成 announcement 管理）、所有乘客端 layout 顯示（layout 換 drawer）
- **小改檔**：line-push.ts 擴充型別、orders/[orderId].patch.ts 加 5 個 sendLinePush 區塊
- **i18n**：announcement 詳情頁雙語化 status / button label；訂單事件推 LINE 用繁中（admin 端不做 i18n 政策延伸：訂單事件 LINE 推因為走乘客端，要支援三語）

### 風險

| 風險 | 緩解 |
|---|---|
| Layout 改造影響所有乘客端頁面，可能炸開 regression | 改造完先 e2e 手測 5 個現有頁面（home/booking/orders/upcoming/fleet/profile）才往下做 |
| L1 Flex Message Hero image 在 LINE OA 渲染失敗（圖片 URL 不可訪問 / 規格錯誤） | LINE Flex 規格嚴格：Hero image 1024×1024 + JPG/PNG/GIF + HTTPS 可訪問 + < 10MB；上傳時驗證 |
| announcement 推播觸發 LINE messaging quota 燒爆 | 沿用 [broadcast.post.ts](server/routes/nuxt-api/admin/broadcast.post.ts) rate-limit 10/hr/admin |
| 訂單事件每次 status 切換都 push，乘客被吵 | 只在 5 個關鍵點推（confirmed / en_route / arrived_pickup / completed / cancelled），避開 in_transit；未來 admin 可在 settings 加開關 |
| 改 layout drawer 後桌機體驗變差 | drawer 在桌機改成側邊 stick / 始終展開（mobile-first 但桌機友善） |

### 估時

詳見 [tasks.md](tasks.md)，總計約 **5-6 個工作天**，6 個 Phase 拆分，每 Phase 結束 commit + push `origin :main`。
