# Tasks — 乘客端發佈消息

> **總時程**：≈ 5-6 個工作天 / 6 個 Phase。每 Phase 結束 commit + `push origin :main`。
> **決策依據**：Brain AI 2026-05-14 拍板 — Layout admin hamburger / Q2=c（自動 a + 手動 b）/ Rich=L1 / 解耦 b。

---

## Phase 0：Spec（本提案 — 0.5 天）

- [x] 0.1 盤點現有 broadcast / line-push / notifications 基建
- [x] 0.2 拍板 4 個關鍵決策（layout / Q2 / rich level / 解耦）
- [x] 0.3 撰寫 [proposal.md](proposal.md)
- [x] 0.4 撰寫 [design.md](design.md)
- [x] 0.5 撰寫 [tasks.md](tasks.md)（本檔）
- [x] 0.6 commit + push origin :main
- [x] 0.7 等待 Brain AI 確認 spec → 進 Phase 1

---

## Phase 1：Layout 改造（1 天）

### 1.1 Drawer 元件

- [x] 新增 `app/components/common/CommonDrawer.vue` — 左側 280px slide-in，含 mask + transition
- [x] 與 [front-desk.vue](app/layouts/front-desk.vue) 整合，移除底部 5-tab bar

### 1.2 Layout 重寫

- [x] [front-desk.vue](app/layouts/front-desk.vue)：
  - [x] 移除 `tabs` / `activeTab` / `.LayoutFrontDesk__bottom` 相關
  - [x] 頂部 nav 右側加 hamburger button
  - [x] body `padding-bottom` 砍掉
- [x] Drawer 內容（依 Brain AI 拍板順序）：
  - [x] 使用者資訊區（頭像 + displayName）
  - [x] 主導航 7 項：最新消息（紅點） / 訂車 / 我的行程 / 歷史訂單 / 車型介紹 / 個人設定 / 客服（外連 LINE OA）
  - [x] 底部：app 版本號（**不放登出**）
  - [x] logo 點擊回 `/home`（不在 drawer 內列「首頁」）

### 1.3 主 CTA 補位

- [x] [pages/home/index.vue](app/pages/home/index.vue) hero 區「立即訂車」按鈕加大（如果太小）
- [x] 評估：頂部 nav 是否在非 booking 頁顯示 mini「+ 訂車」浮鈕（看設計時手感）

### 1.4 桌機 / 手機驗證

- [x] Chrome devtools 切手機（375 / 414）→ 5 個既有頁面（home / booking / orders / upcoming / fleet / profile）visual check 無破版
- [x] 桌機（1440）→ 同樣 visual check

### 1.5 Stage Gate

- [x] G1.1 `pnpm lint` pass
- [x] G1.2 `pnpm build` pass
- [x] G1.3 commit + push origin :main

---

## Phase 2：Announcements Schema + Admin CRUD API（0.5 天）

### 2.1 Firestore rules

- [x] [firestore.rules](firestore.rules) 加 `announcements` + `announcement_reads` 規則：
  - `announcements`：admin 全權限；passenger / driver read（status='published' 且 target match）
  - `announcement_reads/{lineUid}/items/{*}`：本人 RW
- [x] **User 部署 rules 行動列入**（不在程式碼層做）

### 2.2 Server utils

- [x] `server/utils/announcement.ts`：
  - [x] `queryAnnouncementsForUser(roles, lineUid)` — 共用過濾 logic
  - [x] `getAnnouncementTargets(targetType, targetOrderId, db)` — publish 時撈 target lineUid 列表

### 2.3 Admin endpoints

- [x] `GET    /nuxt-api/admin/announcements`（列表 + status filter + 分頁）
- [x] `GET    /nuxt-api/admin/announcements/[id]`（單筆）
- [x] `POST   /nuxt-api/admin/announcements`（建草稿）
- [x] `PATCH  /nuxt-api/admin/announcements/[id]`（編輯 / publish / archive，**status 可循環**）
  - **LINE push 觸發**精確判定：`oldStatus !== 'published' && newStatus === 'published'` 才推（draft→published + archived→published 都推；published→published 純編輯不推）
  - publish 觸發時：撈 targets → push LINE（若 channels.line）→ 寫 pushStats → audit log
  - audit action：`announcement.publish`（首發）/ `announcement.republish`（archived→published）/ `announcement.update`（內容編輯）/ `announcement.archive`
- [x] `DELETE /nuxt-api/admin/announcements/[id]`（**任何 status 都可刪**，含 published / archived）
- [x] 全部套 `hasPermission(auth, 'canBroadcast')` + audit log + rate-limit（沿用 broadcast.post.ts）

### 2.4 圖片上傳 endpoint

- [x] `POST /nuxt-api/admin/announcements/upload-cover`：multipart → Firebase Storage → url
- [x] mime / size / dimension 驗證

### 2.5 Audit actions 擴充

- [x] [server/utils/audit-log.ts](server/utils/audit-log.ts) `AuditAction` 加：
  - `announcement.create`（建草稿）
  - `announcement.update`（內容編輯，不變動 status）
  - `announcement.publish`（draft → published 首發）
  - `announcement.republish`（archived → published 重發）
  - `announcement.archive`（任意 → archived）
  - `announcement.delete`

### 2.6 Stage Gate

- [x] G2.1 lint + build pass
- [x] G2.2 Postman / curl 手測 POST → GET → PATCH publish → GET 流程
- [x] G2.3 commit + push origin :main

---

## Phase 3：Admin 編輯器（1.5 天）

### 3.1 改寫 `/admin/notifications`

- [x] [app/pages/admin/notifications/index.vue](app/pages/admin/notifications/index.vue) 改為 announcement 管理頁：
  - [x] 三 tab：草稿 / 已發佈 / 已下架（query state）
  - [x] 列表卡片：標題 / 目標 / 推送數據 / 動作按鈕（依 status 動態）
    - **draft**：編輯 / 發佈 / 刪除
    - **published**：編輯 / 下架 / 刪除（**編輯不重推 LINE**）
    - **archived**：編輯 / **重新發佈**（會再推一次 LINE，UseAsk 二次確認） / 刪除
  - [x] 「新增公告」按鈕 → 開編輯彈窗

### 3.2 編輯彈窗

- [x] 新增 `app/components/open/dialog/announcement/Edit.vue`：
  - 標題 input（max 60）
  - 內文 TinyEditor（max 1000 含 tag）
  - 封面圖（拖放 / 點擊上傳，預覽 + 刪除）
  - CTA 按鈕（label + url，optional）
  - 目標 radio：all / passenger / driver / order（後者顯示 orderId 輸入）
  - 通道 checkbox：☐ LINE OA  ☐ App 內列表
  - 動作：儲存草稿 / 立即發佈 / 取消

### 3.3 預覽

- [x] 編輯彈窗右側即時預覽：
  - LINE Flex preview（用 Flex Simulator-like rendering 或直接 fetch flex JSON 渲染）
  - App 內卡片 preview（複用後續 Phase 5 的詳情元件）

### 3.4 API 接線

- [x] [app/protocol/fetch-api/api/admin/](app/protocol/fetch-api/api/admin/) 加 `announcement/` 模組
- [x] type 定義
- [x] [app/protocol/fetch-api/api/admin/index.ts](app/protocol/fetch-api/api/admin/index.ts) 匯出

### 3.5 Stage Gate

- [x] G3.1 lint + build pass
- [x] G3.2 手測：建草稿 → 編輯 → 發佈 → 列表顯示 → 下架
- [x] G3.3 commit + push origin :main

---

## Phase 4：LINE 推送整合（1 天）

### 4.1 line-push 擴充支援 Flex

- [x] [server/utils/line-push.ts](server/utils/line-push.ts)：
  - `LineMessage` 改 union type：`{ type: 'text'; text: string } | { type: 'flex'; altText: string; contents: object }`
  - 內部 `$fetch` 不變（LINE API 接受 Flex）

### 4.2 Flex builder helper

- [x] `server/utils/announcement-flex.ts`：
  - `buildAnnouncementFlex(announcement): FlexMessage` 依 design.md 規格組裝

### 4.3 訂單事件自動推（Q2 a，5 個觸發點 — Brain AI 拍板）

- [x] [server/utils/i18n-message.ts](server/utils/i18n-message.ts) 新增 — 三語訊息表（5 個 `order.*` key：`pending` / `confirmed` / `en_route` / `completed` / `cancelled`）
- [x] **訂單建立**（**新增點**）：[server/routes/nuxt-api/orders/index.post.ts](server/routes/nuxt-api/orders/index.post.ts) Firestore write 後加：
  - 撈 `users/{lineUid}.lang`
  - `sendLinePush('passenger', lineUid, [{ type: 'text', text: getOrderMessage('order.pending', lang) }])`
- [x] **status 切換**：[server/routes/nuxt-api/orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) 在 **confirmed / en_route / completed / cancelled** 4 個切換點各 inline 加 sendLinePush（注意：**arrived_pickup 不推**）
  - 撈 `users/{order.userId}.lang`
  - `getOrderMessage('order.{status}', lang, { cancelReason })`
  - `sendLinePush('passenger', order.userId, [{ type: 'text', text }])`
- [x] 全部 fire-and-forget（catch 內部）

### 4.4 Admin 手動推單筆（Q2 b）

- [x] [server/routes/nuxt-api/admin/orders/[orderId]/notify.post.ts](server/routes/nuxt-api/admin/orders/[orderId]/notify.post.ts) 擴充：
  - body 加 `target: 'passenger' | 'driver'`（default 'driver' 維持既有行為）
  - target='passenger' 時 push 給 order.userId via passenger OA
- [x] [app/pages/admin/orders/[orderId].vue](app/pages/admin/orders/[orderId].vue) 加「通知乘客」按鈕 → 開彈窗（標題 + 訊息）→ POST 上述 endpoint
- [x] audit log action 加 `admin.notify_passenger`

### 4.5 Stage Gate

- [x] G4.1 lint + build pass
- [x] G4.2 手測：發佈 announcement（channels.line=true）→ 手機 LINE OA 收到 Flex
- [x] G4.3 手測 5 個訂單事件：建單 (pending) / 切 confirmed / 切 en_route / 切 completed / 切 cancelled → 乘客手機 LINE 各收到對應 text；切 arrived_pickup → 乘客**不**收到（驗證移除點）
- [x] G4.4 手測：admin 訂單詳情頁點「通知乘客」→ 乘客收到自訂訊息
- [x] G4.5 commit + push origin :main

---

## Phase 5：乘客端 /notifications 頁（1 天）

### 5.1 列表頁

- [x] 新增 `app/pages/notifications/index.vue`：
  - 列表卡片：封面縮圖（80×60）+ 標題 + 發佈時間 + 未讀紅點
  - 點擊 → push /notifications/[id]
  - 分頁 / 下拉刷新

### 5.2 詳情頁

- [x] 新增 `app/pages/notifications/[id].vue`：
  - 封面全寬圖
  - 標題 + 發佈時間
  - 內文 v-html（sanitize 過）
  - CTA 按鈕（如有）
  - 返回按鈕

### 5.3 Passenger endpoints

- [x] `GET /nuxt-api/passenger/announcements`
- [x] `GET /nuxt-api/passenger/announcements/[id]` — 順帶寫 read
- [x] `GET /nuxt-api/passenger/announcements/unread-count`

### 5.4 API 接線

- [x] [app/protocol/fetch-api/api/](app/protocol/fetch-api/api/) 加 `announcement/` 模組
- [x] type 定義（`Announcement` / `AnnouncementListItem`）

### 5.5 未讀紅點整合

- [x] [front-desk.vue](app/layouts/front-desk.vue) drawer 內 /notifications 入口顯紅點
- [x] 30s polling + visibility refresh

### 5.6 Stage Gate

- [x] G5.1 lint + build pass
- [x] G5.2 手測：admin 發佈 → 乘客列表出現 → 點開讀 → 紅點消失
- [x] G5.3 commit + push origin :main

---

## Phase 6：收尾（0.5 天）

### 6.1 i18n（Phase 5 順帶完成）

- [x] [i18n/locales/zh.js](i18n/locales/zh.js) 加 `notifications.*` keys（列表 / 詳情 / 空狀態 / CTA / 紅點）
- [x] [i18n/locales/en.js](i18n/locales/en.js) 對齊
- [x] [i18n/locales/ja.js](i18n/locales/ja.js) 對齊

### 6.2 e2e 手測 checklist

- [x] Layout 改造後 5 個既有頁面（home/booking/orders/upcoming/fleet/profile）visual ok
- [x] admin 發佈純 text announcement（channels.line=true, inApp=false） → LINE 收到 text + App 列表不出現
- [x] admin 發佈純 in-app announcement（channels.line=false, inApp=true）→ LINE 沒收 + App 列表出現
- [x] admin 發佈含圖 + CTA Flex（line=true, inApp=true）→ 兩端都正確顯示
- [x] admin target=order 指定特定訂單 → 只該乘客收到
- [x] **status 循環驗證**：published → 編輯 → 不重推 LINE / archived → 重新發佈 → 重推 LINE / archived → 刪除 OK
- [x] 訂單事件 5 個推播：建單 / confirmed / en_route / completed / cancelled → 乘客 LINE 收到；arrived_pickup → **不**推
- [x] admin 訂單詳情點「通知乘客」 → 乘客收到自訂訊息
- [x] 未讀紅點：開未讀消息後紅點 -1 / 全部讀完紅點消失
- [x] **drawer menu 順序驗證**：最新消息（紅點） / 訂車 / 我的行程 / 歷史訂單 / 車型介紹 / 個人設定 / 客服 — 順序與 label 正確；無「登出」「首頁」項
- [x] logo 點擊回 `/home` 可運作

### 6.3 decision-log（Brain AI 本地維護 — docs/ git-ignored）

- [x] [docs/decision-log.md](docs/decision-log.md) 新增 2026-05-14 entry — 公告系統 + Layout 改造拍板紀錄
  > 註：`docs/` 自 `d03b076` 起 git-ignored，僅 Brain AI 本地保留，無法從 git-tracked 工作流落地

### 6.4 tasks.md 收斂

- [x] [docs/tasks.md](docs/tasks.md) 更新 P 編號（建議 P37）+ 移除「🟡 待辦」section 中 LIFF B/W1/W2/W3 的「乘客端發佈消息完工」blocker 標註，改為「✅ 乘客端發佈消息 P37 已完成，B vs W123 優先順序待拍」
  > 註：`docs/tasks.md` 同樣 git-ignored；Brain AI 本地手動更新
- [x] bump version 至 v0.3.21（version.ts + CommonDrawer 同源 import）

### 6.5 Stage Gate

- [x] G6.1 commit + push origin :main（Phase 6 收尾 commit）
- [x] G6.2 Brain AI 在 LIFF 上跑一輪 e2e 驗收（2026-05-14 通過）
- [x] G6.3 整個 change archive 到 `openspec/changes/archive/`

---

## 上線後 hotfix（archive 前一併紀錄）

- `e88d440` — composite indexes 缺失修復：建立 `firestore.indexes.json` + `firebase.json` + `.firebaserc`；admin/orders 指派司機 path 改不推 `order.confirmed`（改用「通知乘客」按鈕手動觸發）
- `41beb18` — firestore.indexes.json 同步 prod 5 indexes（含 3 個 legacy orders 索引保留）
- `dcd9cb4` — target=all 改雙 OA multicast（原依 role 路由讓 dual-role 使用者只收 driver OA）+ published 卡新增「再發佈」按鈕（duplicate mode = POST 新獨立 doc 不動原 source）

Firebase 部署（也在 2026-05-14 完成）：
- `firebase deploy --only firestore:indexes,firestore:rules,storage` 成功；2 個 announcements composite indexes building → enabled

---

## 完成後解鎖

- LIFF B 方案 / W1/W2/W3 cold start 提速（tasks.md「🟡 待辦」）優先順序決定點
