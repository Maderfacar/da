# Tasks — Admin LINE OA 管理系統（P38）

> **總時程**：≈ 5-6 工作天 / 7 Phase。每 Phase 結束 commit + push `origin HEAD:main`。
> **決策依據**：Brain AI 拍板 [design.md §10](design.md#10-開放問題待-brain-ai-拍板) 的 Q1-Q8（必拍至少 Q1-Q8 全部，否則 Phase 1+ 動不了）。
> **拍板前狀態**：以推 spec 預設展開（1a / 2a / 3a / 4a / 5b / 6b / 7a / 8b）；Brain AI 改 default → 對應 Phase task 同步重寫。

---

## Phase 0：Spec + Brain AI 拍板（0.5 天）✅

- [x] 0.1 盤點現況：Wave 3-A1 既有結構 audit（`admin_settings_notification_templates/order-pending` doc + `order-pending-flex.ts` + `NotificationTemplate.vue` + 2 endpoint）
- [x] 0.2 LINE Messaging API richmenu spec 整理（[design.md §1](design.md#1-line-messaging-api-整理richmenu-部分)）
- [x] 0.3 撰寫 [proposal.md](proposal.md)
- [x] 0.4 撰寫 [design.md](design.md)
- [x] 0.5 撰寫 [tasks.md](tasks.md)（本檔）
- [x] 0.6 commit + push origin HEAD:main（commit `742abcf`）
- [x] 0.7 **Brain AI 拍板 2026-05-15**：Q1-Q8 全用推 spec 預設（1a / 2a / 3a / 4a / 5b / 6b / 7a / 8b）
- [x] 0.8 design.md §11 補上每個 Q 拍板結論 → commit + push

**Phase 1 解鎖** — 可直接開工。

> **Q6=6b 影響 Phase 5 範圍收斂**：bot replies / 公告整合 移除，Phase 5 純剩 Diagnostics（可選 / 看時間延後）。

---

## Phase 1：Richmenu 後端（1.0 天）✅

> **前置**：Q1 / Q2 / Q3 拍板（已完成 2026-05-15）。
> **commit**：`0f48ab4` push main 2026-05-15。

### 1.1 Firestore schema + rules ✅

- [x] [firestore.rules](firestore.rules) 加 `line_richmenus` 規則（admin read only，server-only write）
- [x] [firestore.indexes.json](firestore.indexes.json) 加 `(channel ASC, status ASC, updatedAt DESC)` + `(channel ASC, updatedAt DESC)` composite indexes
- [ ] **User 部署 rules + indexes**（`firebase deploy --only firestore:rules,firestore:indexes`，Phase 2 起首次 admin UI 使用前要部署）

### 1.2 LINE Richmenu API Client ✅

- [x] 新增 [server/utils/line-richmenu.ts](server/utils/line-richmenu.ts)：
  - `createRichmenu` / `uploadRichmenuImage` / `setDefaultRichmenu` / `clearDefaultRichmenu` / `getDefaultRichmenuId` / `listRichmenus` / `getRichmenuDetail` / `deleteRichmenu` / `linkRichmenuToUser` / `unlinkRichmenuFromUser`
  - 自訂 `LineApiError` class（含 statusCode + details）
  - 5xx 自動 retry 1 次（500ms backoff）
  - 404 在 getDefault / getDetail 視為 null 而非錯誤

### 1.3 Postback whitelist framework ✅

- [x] 新增 [server/utils/line-postback-handlers.ts](server/utils/line-postback-handlers.ts)：
  - `POSTBACK_WHITELIST` 空 array（Phase 2 起依設計填 4-8 個 entry）
  - `findPostbackHandler` / `listPostbackWhitelist` / `handlePostbackEvent`
- [x] [server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` 加 `postback` event 分支

### 1.4 Admin endpoints ✅

- [x] `GET /nuxt-api/admin/line-richmenus`
- [x] `GET /nuxt-api/admin/line-richmenus/[id]`
- [x] `POST /nuxt-api/admin/line-richmenus`
- [x] `PATCH /nuxt-api/admin/line-richmenus/[id]`
- [x] `DELETE /nuxt-api/admin/line-richmenus/[id]`
- [x] `POST /nuxt-api/admin/line-richmenus/[id]/upload-image`（multipart + inline PNG/JPEG dimension reader + 2500×1686/843 嚴格驗證）
- [x] `POST /nuxt-api/admin/line-richmenus/[id]/publish`（rate-limit 5/hr/admin + tx archive 舊 active + LINE create+upload+setDefault + sync 結果寫回）
- [x] `POST /nuxt-api/admin/line-richmenus/[id]/unpublish`
- [x] `POST /nuxt-api/admin/line-richmenus/[id]/sync-status`
- [x] `POST /nuxt-api/admin/line-richmenus/[id]/test-bind`
- [x] 全部套 `hasPermission(auth, 'canBroadcast')` + audit log
- [x] 共用 schema utility [server/utils/line-richmenu-doc.ts](server/utils/line-richmenu-doc.ts)（validators / DTO serializer）

### 1.5 Audit log action ✅

- [x] [server/utils/audit-log.ts](server/utils/audit-log.ts) `AuditAction` 加 6 個：`line.richmenu.{create,update,publish,unpublish,delete,sync}`
- [x] `AuditTargetType` 加 `line_richmenu`

### 1.6 Stage Gate ✅

- [x] G1.1 `pnpm lint` pass（修 5 個 import-type / void union 警告）
- [x] G1.2 `pnpm build` pass（10 個 endpoint 全部編譯為 chunks）
- [ ] G1.3 curl / Postman 手測 endpoints flow：建草稿 → 上傳圖 → publish → LINE actual 端確認 menu 生效（**留給 Phase 2 admin UI 上線時一併實機驗收**）
- [x] G1.4 commit + push origin HEAD:main（`0f48ab4`）

---

## Phase 2：Richmenu Admin UI（1.5 天）✅ 程式碼層完工

> **前置**：Phase 1 endpoints 全綠 + Q8 拍板（已完成）。
> **commit**：`528fad9` push main 2026-05-15。

### 2.1 新頁路由 ✅

- [x] 新增 [app/pages/admin/line-management/index.vue](app/pages/admin/line-management/index.vue)（layout: back-desk + middleware: auth/role + ssr: false）
- [x] [app/layouts/back-desk.vue](app/layouts/back-desk.vue) ALL_NAV_ITEMS 加「LINE OA 管理」（💬 icon）

### 2.2 Richmenu Tab 主介面 ✅

- [x] 4 tab 架構：Richmenu / Flex Templates / Bot Replies / Diagnostics（Phase 2 只開 Richmenu，其餘 placeholder「Phase X 準備中」）
- [x] Richmenu tab 內 channel sub-tab：passenger 藍 #2563eb / driver 綠 #059669 顏色區分
- [x] Status filter（all / draft / active / archived）+ 列表卡片
- [x] 卡片動作（依 status 動態）：編輯 / 發佈 / 取消預設 / 同步檢查 / 測試綁定 / 刪除

### 2.3 編輯彈窗 ✅

- [x] 新增 [app/components/open/dialog/line-richmenu/Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue)：
  - 基本資訊：name / chatBarText 1-14 / selected toggle
  - **圖片上傳元件**：input file + 預覽 + 寬高/filesize 警示（≤ 1MB、2500×1686 或 2500×843 嚴格驗證；server inline reader 二次驗證）
  - **Area 編輯器**：
    - 圖上 overlay 視覺化（點選 highlight + 編號 badge）
    - Grid quick set（1×1 / 2×1 / 3×1 / 2×2 / 3×2 / 2×3）+ 「+ 手動加區塊」
    - 每 area 編輯：x/y/width/height 數字輸入 + action 三選 radio（uri / message / postback）
    - 拖拉建 area / resize handle 延 P44 follow-up
    - postback 顯示警示「whitelist 尚未填，需 dev 接 handler」
  - Footer：取消 / 儲存草稿（PATCH 一併寫所有變更）
  - lazy 建草稿（第一次按上傳圖或儲存才 POST）

### 2.4 API 接線 ✅

- [x] [app/protocol/fetch-api/api/admin/line-richmenu/{index.ts, type.d.ts}](app/protocol/fetch-api/api/admin/line-richmenu/) 新模組
- [x] type 定義（`LineRichmenuDto` / `RichmenuArea` / `RichmenuAction` / `RichmenuSize` / `PublishRichmenuRes` / `SyncStatusRes`）
- [x] 10 個 API method：Get/List/Create/Patch/Delete/UploadImage/Publish/Unpublish/SyncStatus/TestBind
- [x] 註冊在 [app/protocol/fetch-api/api/admin/index.ts](app/protocol/fetch-api/api/admin/index.ts) `export *`

### 2.5 圖片上傳整合 ✅

- [x] 沿用 P37 multipart pattern + Firebase Storage signed URL
- [x] client 端 PNG/JPEG mime + ≤ 1MB 預檢
- [x] server 端 inline PNG/JPEG dimension reader 嚴格驗證 2500×1686 或 2500×843（Phase 1 已落地）

### 2.6 Stage Gate ✅ 程式碼層

- [x] G2.1 `pnpm lint` pass
- [x] G2.2 `pnpm build` pass
- [ ] G2.3 **真實 LINE OA 驗證**（**Brain AI / User 行動**）：
  - [ ] User 部署 firestore rules + indexes（Phase 1 留尾）
  - [ ] 兩 OA 各設一個 menu → 手機 LINE 看到圖文選單
  - [ ] 點 area 觸發 action（uri / message / postback 各試一次）— postback 因 whitelist 為空，會 fallback 「no handler」log
  - [ ] sync-status / test-bind 驗證
- [x] G2.4 commit + push origin HEAD:main（`528fad9`）

### 留尾（不阻塞 Phase 3）

- [ ] Phase 2 follow-up（可延後）：area editor 加「拖拉建 area + resize handle」進階互動
- [ ] postback whitelist 第一版實際 entry 補入（passenger: OPEN_BOOKING / CONTACT_SUPPORT / MY_TRIP / OPEN_NOTIFICATIONS；driver: OPEN_DASHBOARD / PENDING_LIST / MY_PROFILE / TRIP_GPS）— **此項可在 Phase 5 一併做**

---

## Phase 3：Template Registry + 通用 Builder + Endpoints（1.0 天）✅

> **前置**：Q4 / Q5 / Q6 拍板（已完成）。
> **commit**：`f09bd0b` push main 2026-05-15。

### 3.1 Template Registry ✅

- [x] [server/utils/template-registry.ts](server/utils/template-registry.ts)：
  - `TEMPLATE_REGISTRY` 含 5 個 order templateKey（Q6=6b）：pending / confirmed / en_route / completed / cancelled
  - 每個 entry 含 placeholder schema + defaultContent + fallbackI18nKey
  - `buildTemplateFlex(template, params)` 通用 Flex builder（取代 A1 hard-coded `buildOrderPendingFlex`）
  - `loadTemplate(db, key)` 雙路徑讀（新 collection 優先；order.pending 缺值 fallback A1）
  - `saveTemplate` / `resetTemplate` helper
  - ctaButton.action 三型別（Q7=7a：uri / message / postback）

### 3.2 既有 A1 wrapper 改為 alias（Q5=5b）✅

- [x] [server/utils/order-pending-flex.ts](server/utils/order-pending-flex.ts) 改為 thin wrapper：
  - `buildOrderPendingFlex` / `loadOrderPendingTemplate` export 簽名維持
  - 內部呼叫 `buildTemplateFlex` + `loadTemplate('order.pending')`
  - ctaButton schema 自動轉換（A1 `{label, url}` → 新 `{label, action: {type: 'uri', url}}`）
- [x] [orders/index.post.ts](server/routes/nuxt-api/orders/index.post.ts) 無需改（透過 wrapper）

### 3.3 Migration endpoint ✅

- [x] [server/routes/nuxt-api/admin/migrations/a1-template.post.ts](server/routes/nuxt-api/admin/migrations/a1-template.post.ts)：
  - 讀 A1 doc → 寫新 collection（ctaButton 結構轉換）
  - **super only** 權限（一次性 ops 任務）
  - 冪等：新 doc 已存在 → no-op；body `{ overwrite: true }` 才覆蓋
  - 不刪舊 doc（P41 cleanup 才處理）

### 3.4 通用 endpoints ✅

- [x] `GET /nuxt-api/admin/notification-templates`（list；registry × doc merge）
- [x] `GET /nuxt-api/admin/notification-templates/[key]`
- [x] `PUT /nuxt-api/admin/notification-templates/[key]`（驗證 + order.pending dual-write 舊 collection）
- [x] `POST /nuxt-api/admin/notification-templates/[key]/upload-cover`（multipart Storage signed URL）
- [x] `POST /nuxt-api/admin/notification-templates/[key]/reset`（還原 registry default）
- [x] 全部 `canBroadcast` + audit log（`line.template.update` / `.reset`；保留 `notification_template.update` legacy alias）

### 3.5 A1 既有 endpoint 雙寫 / alias ✅

- [x] [A1 GET endpoint](server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts) 透過 wrapper 自動讀新 collection 優先
- [x] [A1 PUT endpoint](server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts) 加 dual-write：同時寫舊 + 新 collection，ctaButton 自動轉新 schema

### 3.6 Firestore rules ✅

- [x] [firestore.rules](firestore.rules) 加 `notification_templates` 規則（admin client read，server-only write）
- [ ] **User 部署 rules**（與 Phase 1 留尾一併）
- [ ] **User 一次性 trigger** `POST /nuxt-api/admin/migrations/a1-template`（super 帳號）把 A1 doc 搬到新 collection

### 3.7 訂單事件 4 個推送點抽 template（spec §11.6 連動）✅

- [x] [orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) confirmed / en_route / completed / cancelled 4 個事件：
  - 先 loadTemplate + buildTemplateFlex → 推 Flex
  - 缺值 fallback `getOrderMessage` 三語 text（保證向下相容）
  - confirmed/en_route 補 `driverName` / `vehiclePlate`（drivers doc lookup）
  - completed 帶 `fare`；cancelled 帶 `cancelReason`

### 3.8 Stage Gate ✅

- [x] G3.1 `pnpm lint` pass
- [x] G3.2 `pnpm build` pass
- [ ] G3.3 **e2e 建單回歸**（**Brain AI / User 行動**）：
  - [ ] 部署 rules + migration trigger
  - [ ] 乘客建單 → 確認 fallback 正常（未 migrate 走舊 doc，已 migrate 走新 doc，結果應一致）
  - [ ] 5 個 templateKey 各 PUT 後 doc 寫入正確
  - [ ] 4 個 status change 推送點實機驗證（confirmed / en_route / completed / cancelled）
- [x] G3.4 commit + push origin HEAD:main（`f09bd0b`）

---

## Phase 4：Template Admin UI 統一介面（1.0 天）

> **前置**：Phase 3 endpoints 全綠。

### 4.1 通用 TemplateEditor 元件

- [ ] 新增 `app/components/admin/line-management/TemplateEditor.vue`：
  - props: `templateKey: string`
  - 從 registry meta 動態渲染 placeholder chip
  - 表單沿用 A1 NotificationTemplate.vue 結構（title / body / cover / CTA）
  - **CTA action 三選**（依 Q7 拍板）：radio uri / message / postback；postback 從 whitelist 下拉
  - 預覽：LINE Flex mockup（沿用 A1 思路）
  - 動作：儲存 / 還原預設

### 4.2 Templates Tab UI

- [ ] `app/pages/admin/line-management/index.vue` Templates tab：
  - 左 list 依 registry category 分組（訂單事件 / 公告 / Bot 自動回覆，依 Q6）
  - 右 editor 動態載入選中 templateKey

### 4.3 API 接線

- [ ] `app/protocol/fetch-api/api/admin/notification-template/` 新模組
- [ ] type 定義（`NotificationTemplate` / `TemplateContent` / `TemplateMeta`）

### 4.4 A1 NotificationTemplate.vue 處理

- [ ] 5b：保留 A1 元件 + `/admin/settings` section（向下相容）；加 banner link「⇢ 進入 LINE 管理頁編所有模板」
- [ ] 5c：移除 A1 section + 元件，admin 統一走新頁

### 4.5 Stage Gate

- [ ] G4.1 lint + build pass
- [ ] G4.2 手測 5 個 templateKey 從新 UI 編輯 → 儲存 → reload 看得到
- [ ] G4.3 e2e：乘客建單 → 收到新編輯後的 Flex（驗證 admin 改了確實生效）
- [ ] G4.4 commit + push origin HEAD:main

---

## Phase 5：Diagnostics（0.5 天，可延後）

> **前置**：Phase 4 全綠。Q6=6b 拍板後 Bot Replies / 公告整合移除，本 Phase 純剩 Diagnostics。
> **可延後**：若 Phase 1-4 時程吃緊，本 Phase 整個延到 P40，archive 時不阻塞。

### 5.1 Event log 基建

- [ ] 新增 `line_event_logs` / `line_api_errors` collection + Firestore TTL 7d
- [ ] [server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` 入口寫 `line_event_logs`（type / channel / userId / timestamp）
- [ ] `server/utils/line-richmenu.ts` + `server/utils/line-push.ts` catch 內統一寫 `line_api_errors`

### 5.2 Diagnostics Tab

- [ ] admin UI Diagnostics tab（`/admin/line-management`）：
  - 最近 50 筆 webhook event（channel filter）
  - 最近 LINE API error log
  - richmenu sync 狀態總覽：本地 active doc 對 LINE actual default ID 一致性檢查；不一致 highlight + 「重試 sync」按鈕

### 5.3 Stage Gate

- [ ] G5.1 lint + build pass
- [ ] G5.2 手測：故意斷 LINE token → publish richmenu → 確認 `line_api_errors` 寫入 + Diagnostics 顯示
- [ ] G5.3 commit + push origin HEAD:main

---

## Phase 6：e2e 手測 + Archive（0.5 天）

### 6.1 e2e 完整 checklist

- [ ] **Richmenu**：
  - [ ] passenger OA 設 richmenu A → 手機 LINE 看得到、area uri / message / postback 都生效
  - [ ] driver OA 設 richmenu B → 同樣驗證
  - [ ] passenger 切 richmenu A → A'（新版）→ 舊 A archive，新 A' 生效，LINE 端 menu 換新
  - [ ] richmenu sync 失敗模擬（暫停 channel access token 後 publish）→ syncStatus='sync_failed' + admin UI 顯示重試按鈕
  - [ ] richmenu delete（archived 才可）→ LINE 端對應 menu 也刪
- [ ] **Templates**：
  - [ ] 5 個 templateKey（Q6=6b）各編輯 → 對應觸發點推 Flex 確認生效
  - [ ] template `enabled=false` 或 doc 缺 → fallback i18n text（驗向下相容）
  - [ ] CTA action 三型別（Q7）各推一次：uri 點開 / message 送訊息 / postback 觸發 handler
- [ ] **Bot replies**（若 Q6=6c）：follow / text 自動回覆生效
- [ ] **A1 回歸**：乘客建單 → 走通用 builder Flex 推送，與既有體驗一致
- [ ] **Audit log**：所有 admin 動作（richmenu publish / template update / bot reply update）都寫入 audit log

### 6.2 文件更新

- [ ] [docs/api-contracts.md](docs/api-contracts.md) 加新增 endpoint 章節（如 docs 同 P37 為 local git-ignored，User 本地維護）
- [ ] [.claude/knowledge/backend-conventions.md](.claude/knowledge/backend-conventions.md) 補 template-registry / line-richmenu utility 使用範例
- [ ] [version.ts](version.ts) bump（依 minor 規則 → v0.3.22 或 v0.4.0）

### 6.3 OpenSpec archive

- [ ] [openspec/changes/2026-05-15-line-oa-management/](openspec/changes/2026-05-15-line-oa-management/) 整個 mv 至 `openspec/changes/archive/2026-05-15-line-oa-management/`
- [ ] 新增 HANDOFF.md（沿用 P37 / A1 格式：實作摘要 + 已部署狀態 + 留尾）

### 6.4 Stage Gate

- [ ] G6.1 lint + build pass
- [ ] G6.2 Brain AI 在 prod LINE 上跑 e2e 驗收 → 通過
- [ ] G6.3 commit + push origin HEAD:main（含 archive mv）
- [ ] G6.4 memory 寫入 `project-p38-line-oa-management.md`

---

## 完成後解鎖（後續 Wave）

> Q6=6b 已含 5 個 order template，P39 原規劃內容（另 4 個 order 事件）併入 P38 完成。

- **P40**：Bot Replies template 化（`bot.follow.passenger` / `bot.text.passenger` / `bot.follow.driver` / `bot.text.driver`） + 公告系統整合（`announcement-flex.ts` 併入 `template-registry.ts`）
- **P41**：A1 舊 collection `admin_settings_notification_templates` + 舊 audit log alias 清理（migration 完成後 cutover）
- **P42**：richmenu 多語版本（每 channel × {zh, en, ja}）— 依 `users/{lineUid}.lang` 自動切 per-user richmenu
- **P43**：richmenu alias / 分頁切換（richmenuswitch action）
- **P44**：richmenu 圖層合成器（admin 不需設計師外部工具產圖）

---

## 風險紀錄（Phase 進行中發現的補進來）

> 空，Phase 推進時遇到回頭補。

---

## Phase 0 收尾自查（Brain AI 拍板前）

- [x] 7 個 Phase 拆分清楚（Phase 0-6），每 Phase 有 stage gate
- [x] 阻塞性依賴明確（Q1-Q8 拍板 → Phase 1）
- [x] Phase 1 純 API、無 UI / 無 prod 風險可早 push
- [x] Phase 3 含 A1 migration + fallback 設計，prod 推播流程不中斷
- [x] 每 Phase 收尾 push origin HEAD:main（沿用 P37 / A1 模式）
- [x] 完成後解鎖明確列出 P39-P43 後續 wave
