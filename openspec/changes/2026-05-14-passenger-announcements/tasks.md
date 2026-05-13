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
- [ ] 0.6 commit + push origin :main
- [ ] 0.7 等待 Brain AI 確認 spec → 進 Phase 1

---

## Phase 1：Layout 改造（1 天）

### 1.1 Drawer 元件

- [ ] 新增 `app/components/common/CommonDrawer.vue` — 左側 280px slide-in，含 mask + transition
- [ ] 與 [front-desk.vue](app/layouts/front-desk.vue) 整合，移除底部 5-tab bar

### 1.2 Layout 重寫

- [ ] [front-desk.vue](app/layouts/front-desk.vue)：
  - [ ] 移除 `tabs` / `activeTab` / `.LayoutFrontDesk__bottom` 相關
  - [ ] 頂部 nav 右側加 hamburger button
  - [ ] body `padding-bottom` 砍掉
- [ ] Drawer 內容（user info / nav links / 登出 / 客服）

### 1.3 主 CTA 補位

- [ ] [pages/home/index.vue](app/pages/home/index.vue) hero 區「立即訂車」按鈕加大（如果太小）
- [ ] 評估：頂部 nav 是否在非 booking 頁顯示 mini「+ 訂車」浮鈕（看設計時手感）

### 1.4 桌機 / 手機驗證

- [ ] Chrome devtools 切手機（375 / 414）→ 5 個既有頁面（home / booking / orders / upcoming / fleet / profile）visual check 無破版
- [ ] 桌機（1440）→ 同樣 visual check

### 1.5 Stage Gate

- [ ] G1.1 `pnpm lint` pass
- [ ] G1.2 `pnpm build` pass
- [ ] G1.3 commit + push origin :main

---

## Phase 2：Announcements Schema + Admin CRUD API（0.5 天）

### 2.1 Firestore rules

- [ ] [firestore.rules](firestore.rules) 加 `announcements` + `announcement_reads` 規則：
  - `announcements`：admin 全權限；passenger / driver read（status='published' 且 target match）
  - `announcement_reads/{lineUid}/items/{*}`：本人 RW
- [ ] **User 部署 rules 行動列入**（不在程式碼層做）

### 2.2 Server utils

- [ ] `server/utils/announcement.ts`：
  - [ ] `queryAnnouncementsForUser(roles, lineUid)` — 共用過濾 logic
  - [ ] `getAnnouncementTargets(targetType, targetOrderId, db)` — publish 時撈 target lineUid 列表

### 2.3 Admin endpoints

- [ ] `GET    /nuxt-api/admin/announcements`（列表 + status filter + 分頁）
- [ ] `GET    /nuxt-api/admin/announcements/[id]`（單筆）
- [ ] `POST   /nuxt-api/admin/announcements`（建草稿）
- [ ] `PATCH  /nuxt-api/admin/announcements/[id]`（編輯 / publish / archive）
  - publish 觸發：撈 targets → push LINE（若 channels.line）→ 寫 pushStats → audit log
- [ ] `DELETE /nuxt-api/admin/announcements/[id]`
- [ ] 全部套 `hasPermission(auth, 'canBroadcast')` + audit log + rate-limit（沿用 broadcast.post.ts）

### 2.4 圖片上傳 endpoint

- [ ] `POST /nuxt-api/admin/announcements/upload-cover`：multipart → Firebase Storage → url
- [ ] mime / size / dimension 驗證

### 2.5 Audit actions 擴充

- [ ] [server/utils/audit-log.ts](server/utils/audit-log.ts) `AuditAction` 加：
  - `announcement.create`
  - `announcement.update`
  - `announcement.publish`
  - `announcement.archive`
  - `announcement.delete`

### 2.6 Stage Gate

- [ ] G2.1 lint + build pass
- [ ] G2.2 Postman / curl 手測 POST → GET → PATCH publish → GET 流程
- [ ] G2.3 commit + push origin :main

---

## Phase 3：Admin 編輯器（1.5 天）

### 3.1 改寫 `/admin/notifications`

- [ ] [app/pages/admin/notifications/index.vue](app/pages/admin/notifications/index.vue) 改為 announcement 管理頁：
  - [ ] 三 tab：草稿 / 已發佈 / 已下架（query state）
  - [ ] 列表卡片：標題 / 目標 / 推送數據 / 動作按鈕（編輯 / 發佈 / 下架 / 刪除）
  - [ ] 「新增公告」按鈕 → 開編輯彈窗

### 3.2 編輯彈窗

- [ ] 新增 `app/components/open/dialog/announcement/Edit.vue`：
  - 標題 input（max 60）
  - 內文 TinyEditor（max 1000 含 tag）
  - 封面圖（拖放 / 點擊上傳，預覽 + 刪除）
  - CTA 按鈕（label + url，optional）
  - 目標 radio：all / passenger / driver / order（後者顯示 orderId 輸入）
  - 通道 checkbox：☐ LINE OA  ☐ App 內列表
  - 動作：儲存草稿 / 立即發佈 / 取消

### 3.3 預覽

- [ ] 編輯彈窗右側即時預覽：
  - LINE Flex preview（用 Flex Simulator-like rendering 或直接 fetch flex JSON 渲染）
  - App 內卡片 preview（複用後續 Phase 5 的詳情元件）

### 3.4 API 接線

- [ ] [app/protocol/fetch-api/api/admin/](app/protocol/fetch-api/api/admin/) 加 `announcement/` 模組
- [ ] type 定義
- [ ] [app/protocol/fetch-api/api/admin/index.ts](app/protocol/fetch-api/api/admin/index.ts) 匯出

### 3.5 Stage Gate

- [ ] G3.1 lint + build pass
- [ ] G3.2 手測：建草稿 → 編輯 → 發佈 → 列表顯示 → 下架
- [ ] G3.3 commit + push origin :main

---

## Phase 4：LINE 推送整合（1 天）

### 4.1 line-push 擴充支援 Flex

- [ ] [server/utils/line-push.ts](server/utils/line-push.ts)：
  - `LineMessage` 改 union type：`{ type: 'text'; text: string } | { type: 'flex'; altText: string; contents: object }`
  - 內部 `$fetch` 不變（LINE API 接受 Flex）

### 4.2 Flex builder helper

- [ ] `server/utils/announcement-flex.ts`：
  - `buildAnnouncementFlex(announcement): FlexMessage` 依 design.md 規格組裝

### 4.3 訂單事件自動推（Q2 a）

- [ ] [server/utils/i18n-message.ts](server/utils/i18n-message.ts) 新增 — 三語訊息表（5 個 `order.*` key）
- [ ] [server/routes/nuxt-api/orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) 5 個 status 切換點各 inline 加：
  - 撈 `users/{order.userId}.lang`
  - `getOrderMessage('order.{status}', lang, { ... })`
  - `sendLinePush('passenger', order.userId, [{ type: 'text', text }])`
  - 全部 fire-and-forget（catch 內部）

### 4.4 Admin 手動推單筆（Q2 b）

- [ ] [server/routes/nuxt-api/admin/orders/[orderId]/notify.post.ts](server/routes/nuxt-api/admin/orders/[orderId]/notify.post.ts) 擴充：
  - body 加 `target: 'passenger' | 'driver'`（default 'driver' 維持既有行為）
  - target='passenger' 時 push 給 order.userId via passenger OA
- [ ] [app/pages/admin/orders/[orderId].vue](app/pages/admin/orders/[orderId].vue) 加「通知乘客」按鈕 → 開彈窗（標題 + 訊息）→ POST 上述 endpoint
- [ ] audit log action 加 `admin.notify_passenger`

### 4.5 Stage Gate

- [ ] G4.1 lint + build pass
- [ ] G4.2 手測：發佈 announcement（channels.line=true）→ 手機 LINE OA 收到 Flex
- [ ] G4.3 手測：訂單 status 改 confirmed → 手機收到「✅ 訂單已確認」text
- [ ] G4.4 手測：admin 訂單詳情頁點「通知乘客」→ 乘客收到自訂訊息
- [ ] G4.5 commit + push origin :main

---

## Phase 5：乘客端 /notifications 頁（1 天）

### 5.1 列表頁

- [ ] 新增 `app/pages/notifications/index.vue`：
  - 列表卡片：封面縮圖（80×60）+ 標題 + 發佈時間 + 未讀紅點
  - 點擊 → push /notifications/[id]
  - 分頁 / 下拉刷新

### 5.2 詳情頁

- [ ] 新增 `app/pages/notifications/[id].vue`：
  - 封面全寬圖
  - 標題 + 發佈時間
  - 內文 v-html（sanitize 過）
  - CTA 按鈕（如有）
  - 返回按鈕

### 5.3 Passenger endpoints

- [ ] `GET /nuxt-api/passenger/announcements`
- [ ] `GET /nuxt-api/passenger/announcements/[id]` — 順帶寫 read
- [ ] `GET /nuxt-api/passenger/announcements/unread-count`

### 5.4 API 接線

- [ ] [app/protocol/fetch-api/api/](app/protocol/fetch-api/api/) 加 `announcement/` 模組
- [ ] type 定義（`Announcement` / `AnnouncementListItem`）

### 5.5 未讀紅點整合

- [ ] [front-desk.vue](app/layouts/front-desk.vue) drawer 內 /notifications 入口顯紅點
- [ ] 30s polling + visibility refresh

### 5.6 Stage Gate

- [ ] G5.1 lint + build pass
- [ ] G5.2 手測：admin 發佈 → 乘客列表出現 → 點開讀 → 紅點消失
- [ ] G5.3 commit + push origin :main

---

## Phase 6：收尾（0.5 天）

### 6.1 i18n

- [ ] [i18n/locales/zh.js](i18n/locales/zh.js) 加 `notifications.*` keys（列表 / 詳情 / 空狀態 / CTA / 紅點）
- [ ] [i18n/locales/en.js](i18n/locales/en.js) 對齊
- [ ] [i18n/locales/ja.js](i18n/locales/ja.js) 對齊

### 6.2 e2e 手測 checklist

- [ ] Layout 改造後 5 個既有頁面（home/booking/orders/upcoming/fleet/profile）visual ok
- [ ] admin 發佈純 text announcement（channels.line=true, inApp=false） → LINE 收到 text + App 列表不出現
- [ ] admin 發佈純 in-app announcement（channels.line=false, inApp=true）→ LINE 沒收 + App 列表出現
- [ ] admin 發佈含圖 + CTA Flex（line=true, inApp=true）→ 兩端都正確顯示
- [ ] admin target=order 指定特定訂單 → 只該乘客收到
- [ ] 訂單事件 5 個推播 → 乘客 LINE 確實收到對應訊息
- [ ] admin 訂單詳情點「通知乘客」 → 乘客收到自訂訊息
- [ ] 未讀紅點：開未讀消息後紅點 -1 / 全部讀完紅點消失

### 6.3 decision-log

- [ ] [docs/decision-log.md](docs/decision-log.md) 新增 2026-05-14 entry — 公告系統 + Layout 改造拍板紀錄

### 6.4 tasks.md 收斂

- [ ] [docs/tasks.md](docs/tasks.md) 更新 P 編號（建議 P37）+ 移除「🟡 待辦」section 中 LIFF B/W1/W2/W3 的「乘客端發佈消息完工」blocker 標註，改為「✅ 乘客端發佈消息 P37 已完成，B vs W123 優先順序待拍」
- [ ] bump version 至 v3.21

### 6.5 Stage Gate

- [ ] G6.1 commit + push origin :main
- [ ] G6.2 Brain AI 在 LIFF 上跑一輪 e2e 驗收
- [ ] G6.3 整個 change archive 到 `openspec/changes/archive/`

---

## 完成後解鎖

- LIFF B 方案 / W1/W2/W3 cold start 提速（tasks.md「🟡 待辦」）優先順序決定點
