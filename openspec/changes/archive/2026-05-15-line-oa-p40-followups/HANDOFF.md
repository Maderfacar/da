# HANDOFF — P40 LINE OA 系統收尾（2026-05-15）

> 程式碼層完工 — Phase 0-4 全綠並 push main。firestore rules 已 deploy 完成。
> Brain AI 真機 e2e 驗收（tasks.md §4.2 checklist）為唯一留尾。

## 實作摘要

| Phase | 內容 | Commit |
|---|---|---|
| 0 | spec 三件套 + Brain AI 拍板 Q1-Q5 全用推 spec 預設 | `2ce7f76` + `6fcffd5` |
| 1 | Postback whitelist 8 entry（passenger 4 + driver 4）+ admin UI ElSelect 下拉（richmenu Edit / TemplateEditor 兩處）+ 新 endpoint | `e49ce2d` |
| 2 | Bot Replies template 化：`bot_replies` collection + GET list / PUT [key] endpoint + admin 「自動回覆」tab + audit log + firebase deploy rules | `c833ebd` |
| 3 | 公告整合（announcement-flex.ts 內部走 `buildTemplateFlex` 共用 builder）+ Diagnostics MVP（sync-overview + cleanup-orphan endpoint + admin Diagnostics tab）| `46e68fe` |
| 4 | A1 cleanup（移除 wrapper + 2 endpoint + admin section + UI 元件 + protocol method + audit alias）+ version bump v0.3.23 + HANDOFF + archive + memory | （本次 archive commit） |

## 拍板紀錄（design.md §7）

5 個 Q 全用推 spec 預設（2026-05-15「預設即可」拍板）：

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | 1a | LIFF URL 取自既有 `lineLiffIdPassenger` / `lineLiffIdDriver`（不新增冗餘 env var） |
| Q2 | 2a | 抽進專屬 `bot_replies/{client}.{type}` collection（4 doc） |
| Q3 | 3b | 公告 builder 共用：announcement-flex 內部 call `buildTemplateFlex`，對外行為不變 |
| Q4 | 4b | Diagnostics MVP：sync overview + 孤兒清理；event/error log 延後 P43 |
| Q5 | 5a | A1 cleanup 本案處理（A1 doc prod 不存在 firestore MCP 已驗，風險最低） |

## 部署狀態

✅ **已 push main**（commits `2ce7f76` → 本次 archive commit）：5 個 Phase 全綠
✅ **firestore rules 已 deploy**（Phase 2 加 `bot_replies` rule；Claude 自跑 `firebase deploy --only firestore:rules` 成功 release 至 `destination-anywhere-cfd50`）
✅ **A1 doc 驗證**：firestore MCP 確認 `admin_settings_notification_templates/order-pending` prod 不存在；cleanup 無 data 遺留

⏳ **User 行動**：僅剩 tasks.md §4.2 e2e checklist 真機驗收（6 項）

## 程式碼總覽

### 新增 utility

- 無新增 utility 檔（Phase 2 helper 加到既有 [line-channel.ts](server/utils/line-channel.ts) 內）

### 改動既有

- [server/utils/line-postback-handlers.ts](server/utils/line-postback-handlers.ts)：補 8 個 entry + `_getLiffUrl` / `_buildSupportReply` 內部 helper
- [server/utils/line-channel.ts](server/utils/line-channel.ts)：加 `loadBotReply` / `getBotReplyDefault` exports；handleLineWebhook follow/text branch 改 call loadBotReply
- [server/utils/audit-log.ts](server/utils/audit-log.ts)：加 `line.bot_reply.update` action + `bot_reply` targetType；移除 `notification_template.update` alias
- [server/utils/template-registry.ts](server/utils/template-registry.ts)：loadTemplate 移除 A1 fallback（單路徑只讀新 collection）
- [server/utils/announcement-flex.ts](server/utils/announcement-flex.ts)：excerpt 非空時走 `buildTemplateFlex`；空時 fallback 維持 P37 單 title bubble
- [server/routes/nuxt-api/orders/index.post.ts](server/routes/nuxt-api/orders/index.post.ts)：A1 cleanup — 直接 call `loadTemplate('order.pending')` + `buildTemplateFlex`
- [server/routes/nuxt-api/admin/notification-templates/[key].put.ts](server/routes/nuxt-api/admin/notification-templates/[key].put.ts)：A1 cleanup — 移除 dual-write 舊 collection 邏輯 + 移除 alias audit log
- [firestore.rules](firestore.rules)：加 `bot_replies` match（admin read / server-only write）
- [app/pages/admin/line-management/index.vue](app/pages/admin/line-management/index.vue)：bot-replies tab + diagnostics tab（兩者 ready=true）
- [app/pages/admin/settings/index.vue](app/pages/admin/settings/index.vue)：移除 NOTIFICATIONS section（A1 cleanup）
- [app/components/open/dialog/line-richmenu/Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue)：postback action input 改 ElSelect with allow-create / filterable
- [app/components/admin/line-management/TemplateEditor.vue](app/components/admin/line-management/TemplateEditor.vue)：postback action input 同上 + channel 標籤
- [app/protocol/fetch-api/api/admin/index.ts](app/protocol/fetch-api/api/admin/index.ts)：加 `GetLinePostbackWhitelist`；移除 `GetOrderPendingTemplate` / `PutOrderPendingTemplate` / `OrderPendingTemplate`
- [app/protocol/fetch-api/api/admin/line-richmenu/index.ts](app/protocol/fetch-api/api/admin/line-richmenu/index.ts)：加 `GetRichmenuSyncOverview` / `CleanupOrphanRichmenu` + types

### 新增 endpoint（5 個）

- `GET /admin/line-postback-whitelist`（channel query 可選）
- `GET /admin/bot-replies`
- `PUT /admin/bot-replies/[key]`
- `GET /admin/line-richmenus/sync-overview?channel=...`
- `POST /admin/line-richmenus/cleanup-orphan`

### 新增 protocol module / 元件

- [app/protocol/fetch-api/api/admin/bot-reply/](app/protocol/fetch-api/api/admin/bot-reply/index.ts) — GetBotReplies / PutBotReply + types

### 移除（A1 cleanup）

- `server/utils/order-pending-flex.ts`（thin wrapper）
- `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts`
- `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.put.ts`
- `app/components/admin/SettingsNotificationTemplate.vue`
- `app/pages/admin/settings/index.vue` NOTIFICATIONS section
- `app/protocol/fetch-api/api/admin/index.ts` GetOrderPendingTemplate / PutOrderPendingTemplate / OrderPendingTemplate
- `audit-log.ts` AuditAction `notification_template.update`（targetType 保留供新 action）
- `admin/notification-templates/[key].put.ts` A1 dual-write 邏輯 + alias audit log
- `template-registry.ts` loadTemplate A1 fallback 路徑

## 留尾（後續 Wave）

> 本 Wave 吸收 P41 A1 cleanup 範圍。

- **P42**：richmenu 多語版本（per-user 依 users.lang 自動切）
- **P43**：Diagnostics 完整版（event log + error log raw list + heatmap） / richmenu alias / 分頁切換
- **P44**：richmenu 圖層合成器 + area editor 拖拉互動 + resize handle

## 已知留尾（非阻塞）

- LINE OA Bot 自動回覆 fallback 文案仍 hard-coded 在 [line-channel.ts](server/utils/line-channel.ts) `FOLLOW_MESSAGES` / `TEXT_REPLY_MESSAGES`；admin 改 `bot_replies` doc 後實際生效，hard-coded 作為 doc 不存在 / disabled / 空文時的安全網
- Postback handler reply 第一版皆為 text message 含 LIFF URL；後續可進化成 Flex Bubble（單 entry 改 handler 即可，無需 schema 變動）
- Diagnostics「重試 sync」按鈕未做（單筆 sync 維持走 richmenu list 內現有 sync-check 按鈕，避免功能重複）
- `bot_replies` doc 在 `enabled=false` 時 webhook 走 hard-coded fallback；admin UI 已標示「停用」狀態
- `notification_template.update` 歷史 audit log 紀錄保留；UI 列表如要篩選改用 `targetType='notification_template'`（不依賴 action 字串）

## 版本

v0.3.23（[version.ts](version.ts)）— bump from v0.3.22（P38 archive）
