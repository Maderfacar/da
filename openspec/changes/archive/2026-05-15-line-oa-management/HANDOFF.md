# HANDOFF — P38 Admin LINE OA 管理系統（2026-05-15）

> 程式碼層完工 — Phase 0-4 + Phase 6 收尾全綠並 push main。Phase 5（Diagnostics）延後至 P40。
> 真機 e2e 驗收待 User 部署 firestore rules + 跑一次 migration endpoint。

## 實作摘要

| Phase | 內容 | Commit |
|---|---|---|
| 0 | spec 三件套 + Brain AI 拍板 Q1-Q8 全用推 spec 預設 | `742abcf` + `c827e0f` |
| 1 | richmenu 後端：10 endpoint + LINE API client + postback framework + audit + rules/indexes | `0f48ab4` + `92f6cd8` |
| 2 | richmenu admin UI：/admin/line-management 4 tab 頁 + 編輯彈窗（area overlay editor）+ protocol module | `528fad9` + `8c9215c` |
| 3 | template registry 通用化 + 5 個 order template + A1 alias dual-write + orders patch 抽 template | `f09bd0b` + `fc6f953` |
| 4 | Flex Template admin UI：Templates tab + 通用 TemplateEditor + protocol module | `0a68ccd` |
| 6 | tasks.md / version 0.3.22 / archive openspec change / memory 同步 | （本次 archive commit） |

## 拍板紀錄（design.md §11）

8 個 Q 全用推 spec 預設（2026-05-15「spec 預設」拍板）：

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | 1a | richmenu single-active + multi-draft / archived |
| Q2 | 2a | admin 上傳成品 PNG/JPEG（不做 grid builder） |
| Q3 | 3a | area action 三選：uri / message / postback |
| Q4 | 4a | template registry server hard-coded |
| Q5 | 5b | A1 endpoint alias + dual-write |
| Q6 | 6b | Phase 1 含 5 個 order template（A1 + P39 一次做完） |
| Q7 | 7a | CTA action 三選與 Q3 對齊 |
| Q8 | 8b | 新獨立頁 /admin/line-management 4 tab |

## 部署狀態

✅ **已 push main**（commits 上列）：4 個 Phase（1-4）+ Phase 0/6 收尾。  
⏳ **User 行動清單**（部署前必做）：

1. **`firebase deploy --only firestore:rules,firestore:indexes`**
   - Phase 1 新增 `line_richmenus` rule + 2 composite index
   - Phase 3 新增 `notification_templates` rule
2. **super 帳號跑一次** `POST /nuxt-api/admin/migrations/a1-template`
   - 把 A1 舊 collection `admin_settings_notification_templates/order-pending` 搬到新 collection `notification_templates/order.pending`
   - ctaButton schema 自動轉換（`{label, url}` → `{label, action: {type: 'uri', url}}`）
   - 冪等：跑兩次無害；body `{overwrite: true}` 才覆蓋既有新 doc
   - 不跑也能 work（loadTemplate 有 A1 fallback 路徑），但跑完之後新 UI 與 A1 admin UI 看到的內容才一致
3. **真機 e2e 驗收**（依 tasks.md §6.1 checklist）

## 程式碼總覽

### 新增 utility（5 個）

- [server/utils/line-richmenu.ts](server/utils/line-richmenu.ts) — LINE Messaging API client（10 helper + LineApiError + 5xx retry）
- [server/utils/line-richmenu-doc.ts](server/utils/line-richmenu-doc.ts) — Firestore doc schema + DTO + validators
- [server/utils/line-postback-handlers.ts](server/utils/line-postback-handlers.ts) — postback whitelist framework（Phase 1 空 array，P40 補入）
- [server/utils/template-registry.ts](server/utils/template-registry.ts) — 5 個 order template + buildTemplateFlex + loadTemplate 雙路徑

### 改動既有

- [server/utils/order-pending-flex.ts](server/utils/order-pending-flex.ts) — 改為 thin wrapper，內部呼叫 template-registry（向下相容）
- [server/utils/line-channel.ts](server/utils/line-channel.ts) — webhook 加 postback event 分支
- [server/utils/audit-log.ts](server/utils/audit-log.ts) — 加 8 個新 action（6 個 `line.richmenu.*` + 2 個 `line.template.*`）+ 1 個新 targetType（`line_richmenu`）
- [server/routes/nuxt-api/orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) — 4 個推送點抽 template（confirmed/en_route/completed/cancelled）
- [server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts](server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts) — A1 endpoint 加 dual-write 新 collection
- [firestore.rules](firestore.rules) — 加 line_richmenus + notification_templates
- [firestore.indexes.json](firestore.indexes.json) — 加 line_richmenus 2 個 composite index

### 新增 endpoint（16 個）

**Richmenu（10 個）**：
- GET / POST `/admin/line-richmenus`
- GET / PATCH / DELETE `/admin/line-richmenus/[id]`
- POST `/admin/line-richmenus/[id]/{upload-image, publish, unpublish, sync-status, test-bind}`

**Notification template（5 個）**：
- GET `/admin/notification-templates`
- GET / PUT `/admin/notification-templates/[key]`
- POST `/admin/notification-templates/[key]/{reset, upload-cover}`

**Migration（1 個）**：
- POST `/admin/migrations/a1-template`（super only）

### 新增 admin UI

- [app/pages/admin/line-management/index.vue](app/pages/admin/line-management/index.vue) — 4 tab 頁（Richmenu / Templates / Bot Replies-P40 / Diagnostics-P40）
- [app/components/open/dialog/line-richmenu/Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue) — richmenu 編輯彈窗（含 area overlay editor）
- [app/components/admin/line-management/TemplateEditor.vue](app/components/admin/line-management/TemplateEditor.vue) — 通用 template 編輯器（placeholder chip + CTA 三型別 + Flex preview）

### 新增 protocol module

- [app/protocol/fetch-api/api/admin/line-richmenu/](app/protocol/fetch-api/api/admin/line-richmenu/) — 10 method
- [app/protocol/fetch-api/api/admin/notification-template/](app/protocol/fetch-api/api/admin/notification-template/) — 5 method

### 整合既有

- [app/layouts/back-desk.vue](app/layouts/back-desk.vue) — 加 nav 入口「LINE OA 管理」（💬）
- [app/components/open/_index.d.ts](app/components/open/_index.d.ts) + [app/components/open/index.ts](app/components/open/index.ts) — 註冊 `$open.DialogLineRichmenuEdit`

## 留尾

### 阻塞性（User 部署前必做）

- [ ] `firebase deploy --only firestore:rules,firestore:indexes`
- [ ] 跑一次 `POST /nuxt-api/admin/migrations/a1-template`

### 後續 Wave 待辦

- **Phase 5（延後）/ P40**：
  - Bot Replies template 化（`bot.follow.passenger` / `bot.text.passenger` / `bot.follow.driver` / `bot.text.driver`）+ 從 [line-channel.ts](server/utils/line-channel.ts) 抽 hard-coded FOLLOW_MESSAGES / TEXT_REPLY_MESSAGES
  - 公告系統整合：announcement-flex.ts 評估能否併入 template-registry.ts（announcement category）
  - Diagnostics tab：webhook event log + LINE API error log + richmenu sync 狀態總覽
  - **Postback whitelist 補入**：第一版預計 8 個（passenger 4：OPEN_BOOKING / OPEN_NOTIFICATIONS / CONTACT_SUPPORT / MY_TRIP；driver 4：OPEN_DASHBOARD / PENDING_LIST / MY_PROFILE / TRIP_GPS）+ 對應 handler 實作
- **P41**：清理 A1 舊 collection `admin_settings_notification_templates` + 舊 A1 admin UI section + `order-pending-flex.ts` wrapper（migration 完全穩定後）
- **P42**：richmenu 多語版本（per-user 依 users.lang 自動切）
- **P43**：richmenu alias / 分頁切換（richmenuswitch）
- **P44**：richmenu 圖層合成器 + area editor 拖拉建 area + resize handle

## 已知留尾（非阻塞）

- Postback action 在 admin UI 仍可填字串，但 server whitelist 空 → 觸發後 console warn `no handler`，user 不會收到回應。**設計上故意**：whitelist 上 server 才能對應 handler；admin UI 已警示「需 dev 接 handler」
- A1 `/admin/settings` NOTIFICATIONS section 暫時保留（沿用 P37 / A1 UI），與新通用 UI 並存；A1 PUT 已加 dual-write，內容會自動同步到新 collection
- order.pending 模板：未跑 migration 前，新 UI 看到 fallback A1 doc 內容；A1 UI 看到舊 doc。跑完 migration 後完全一致

## 版本

v0.3.22（[version.ts](version.ts)）
