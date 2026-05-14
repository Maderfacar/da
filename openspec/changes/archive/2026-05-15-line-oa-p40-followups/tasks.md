# Tasks — P40 LINE OA 系統收尾

> **總時程**：≈ 2.0-3.0 工作天 / 4-5 Phase。新視窗執行。
> **決策依據**：Brain AI 拍板 [design.md §6](design.md#6-開放問題待-brain-ai-拍板) Q1-Q5（必拍才能進 Phase 1）。
> **推 spec 預設**：Q1=1a runtimeConfig / Q2=2a 專屬 collection / Q3=3b 混合 / Q4=4b MVP / Q5=5a 本案 cleanup

---

## Phase 0：Spec + Brain AI 拍板（0.5 天）

- [x] 0.1 P38 完工 audit（commits 742abcf..d6377a6 + firebase deploy 完成 + A1 doc 不存在驗證）
- [x] 0.2 4 子範圍盤點（postback / bot replies / 公告整合 / diagnostics / A1 cleanup）
- [x] 0.3 撰寫 [proposal.md](proposal.md)
- [x] 0.4 撰寫 [design.md](design.md)
- [x] 0.5 撰寫 [tasks.md](tasks.md)（本檔）
- [x] 0.6 commit + push origin HEAD:main（commit `2ce7f76`）
- [x] 0.7 **Brain AI 拍板 Q1-Q5**（2026-05-15 全採推 spec 預設：Q1=1a / Q2=2a / Q3=3b / Q4=4b / Q5=5a）
- [x] 0.8 design.md §7 補拍板紀錄 → commit + push → 進 Phase 1

---

## Phase 1：Postback Whitelist + handler（0.5 天）

> **前置**：Q1 拍板。

### 1.1 LIFF URL 設定

- [x] 確認既有 env var：`runtimeConfig.public.lineLiffIdPassenger` / `lineLiffIdDriver` 已存在（雙 LIFF app）
- [x] **不新增 env var**：用既有雙 LIFF ID 推導 URL（`https://liff.line.me/${liffId}${path}`），符合 spec「先檢查既有 env var」精神且自然支援雙 LIFF 場景

### 1.2 Whitelist 補入 8 個 entry

- [x] [server/utils/line-postback-handlers.ts](server/utils/line-postback-handlers.ts) `POSTBACK_WHITELIST` 補：
  - passenger：OPEN_BOOKING / OPEN_NOTIFICATIONS / MY_TRIP / CONTACT_SUPPORT（channel='both'）
  - driver：OPEN_DASHBOARD / PENDING_LIST / MY_PROFILE / TRIP_GPS
  - 每 entry：data + label + channel + handler（reply text 含 LIFF URL）
  - 新增 `_getLiffUrl(client, subPath)` 與 `_buildSupportReply()` 內部 helper

### 1.3 Admin UI 整合（postback 下拉選單）

- [x] 新增 `GET /nuxt-api/admin/line-postback-whitelist`（channel query 可選；無則回全 whitelist 含 'both'）
- [x] `app/protocol/fetch-api/api/admin/index.ts` 加 `GetLinePostbackWhitelist` method + types
- [x] [richmenu Edit.vue](app/components/open/dialog/line-richmenu/Edit.vue) postback action input 改 `<el-select>` + allow-create / filterable / clearable
- [x] [TemplateEditor.vue](app/components/admin/line-management/TemplateEditor.vue) postback action input 同上（不傳 channel 看全 whitelist + channel 標籤）
- [x] free-form 仍允許（allow-create），whitelist 外 data 顯示警示

### 1.4 Stage Gate

- [x] G1.1 lint + build pass（`admin/index.get4.mjs` 即新 endpoint chunk）
- [ ] G1.2 真機驗證（彙整至 Phase 4 e2e checklist）
- [ ] G1.3 commit + push origin HEAD:main

---

## Phase 2：Bot Replies Template 化（0.5 天）

> **前置**：Q2 拍板。

### 2.1 Firestore schema + rules

- [x] [firestore.rules](firestore.rules) 加 `bot_replies` 規則（admin read，server-only write）
- [x] firebase deploy rules（Claude 自跑：`npx firebase-tools deploy --only firestore:rules` 成功 release）

### 2.2 Server util

- [x] [server/utils/line-channel.ts](server/utils/line-channel.ts) 加 `loadBotReply(client, type)` + `getBotReplyDefault(client, type)` helper（export 給 admin endpoint 用）
- [x] `handleLineWebhook` follow / message branch 改 call `loadBotReply`（fallback hard-coded 不變動既有行為）

### 2.3 Admin endpoints

- [x] `GET /nuxt-api/admin/bot-replies`（列 4 個 replyKey，doc 不存在回 hard-coded default 預覽）
- [x] `PUT /nuxt-api/admin/bot-replies/[key]`（upsert + audit log `line.bot_reply.update`；text 1-500 字驗證）

### 2.4 Audit + Protocol + UI

- [x] [audit-log.ts](server/utils/audit-log.ts) `AuditAction` 加 `line.bot_reply.update` + `bot_reply` targetType
- [x] `app/protocol/fetch-api/api/admin/bot-reply/` 模組（GetBotReplies / PutBotReply + types）
- [x] [/admin/line-management/index.vue](app/pages/admin/line-management/index.vue) `bot-replies` tab：4 row × { channel/type 標籤 + 已自訂 chip + enabled toggle + textarea + 字數計 + 還原預設 + 儲存 }
- [x] MAIN_TABS 'bot-replies' ready=true；diagnostics placeholder 改顯示「P40 Phase 3 準備中」

### 2.5 Stage Gate

- [x] G2.1 lint + build pass（`admin/bot-replies/_key_.put.mjs` + `admin/index.get4.mjs` 已 bundle）
- [ ] G2.2 真機驗證（彙整 Phase 4 e2e checklist）
- [ ] G2.3 commit + push origin HEAD:main

---

## Phase 3：Diagnostics MVP + 公告整合（0.5-1.0 天）

> **前置**：Q3 + Q4 拍板。

### 3.1 公告整合（Q3=3b）

- [x] [server/utils/announcement-flex.ts](server/utils/announcement-flex.ts) 內部改 call template-registry `buildTemplateFlex`（excerpt 非空時走共用 builder；空時保留 P37 單 title bubble fallback）
- [x] 對外簽名 + 外部 caller（announcement publish 流程）行為完全不變
- [x] 公告 admin UI 不動

### 3.2 Diagnostics MVP（Q4=4b）

- [x] 新增 `GET /nuxt-api/admin/line-richmenus/sync-overview?channel=...`（本地 line_richmenus + LINE listRichmenus / getDefaultRichmenuId 比對 + orphan / stale 偵測）
- [x] 新增 `POST /nuxt-api/admin/line-richmenus/cleanup-orphan`（安全檢查本地無 doc 後才 DELETE LINE 端，含 audit log）
- [x] `app/protocol/fetch-api/api/admin/line-richmenu/` 加 `GetRichmenuSyncOverview` + `CleanupOrphanRichmenu` method + types
- [x] [/admin/line-management/index.vue](app/pages/admin/line-management/index.vue) `diagnostics` tab：
  - passenger / driver 兩 card（卡片並列 / 手機單欄）
  - match 一致性 banner（綠 / 紅）+ inconsistencies list
  - LINE 端 listRichmenus 表（含 DEFAULT / ORPHAN badge + 清理按鈕）
  - 本地 active doc + stale list（informational）
  - 重新檢查按鈕
- [x] MAIN_TABS 'diagnostics' ready=true

### 3.3 Stage Gate

- [x] G3.1 lint + build pass（`sync-overview.get.mjs` + `cleanup-orphan.post.mjs` 已 bundle）
- [ ] G3.2 真機驗證（彙整 Phase 4 e2e checklist）
- [ ] G3.3 commit + push origin HEAD:main

---

## Phase 4：A1 cleanup + e2e + Archive（0.5 天）

> **前置**：Q5 拍板。Q5=5a 本案處理。

### 4.1 A1 cleanup（Q5=5a）

- [x] [orders/index.post.ts](server/routes/nuxt-api/orders/index.post.ts) 改直接 call `loadTemplate('order.pending')` + `buildTemplateFlex`（不再 import order-pending-flex wrapper）
- [x] 移除 `server/utils/order-pending-flex.ts`
- [x] 移除 `server/routes/nuxt-api/admin/settings/notification-templates/order-pending.{get,put}.ts`（含目錄 cleanup）
- [x] 移除 [app/pages/admin/settings/index.vue](app/pages/admin/settings/index.vue) NOTIFICATIONS section
- [x] 移除 `app/components/admin/SettingsNotificationTemplate.vue` 元件（auto-import 為 AdminSettingsNotificationTemplate）
- [x] 移除 [app/protocol/fetch-api/api/admin/index.ts](app/protocol/fetch-api/api/admin/index.ts) `GetOrderPendingTemplate` / `PutOrderPendingTemplate` method + OrderPendingTemplate interface
- [x] 移除 [audit-log.ts](server/utils/audit-log.ts) `AuditAction.notification_template.update` alias（保留 targetType `notification_template`）
- [x] 移除 [admin/notification-templates/[key].put.ts](server/routes/nuxt-api/admin/notification-templates/[key].put.ts) A1 dual-write + alias audit log
- [x] 移除 [template-registry.ts](server/utils/template-registry.ts) loadTemplate 內的 A1 fallback 路徑（A1 doc prod 不存在已 firestore MCP 驗證）

### 4.2 e2e 完整 checklist（彙整給 Brain AI 真機驗收）

> 程式碼層全綠（lint pass + build pass + firebase deploy rules）；下列由 Brain AI 在 prod 真機操作。

- [ ] **Postback**：admin 在 richmenu Edit dialog 對 passenger OA 設一個 area type=postback data=OPEN_BOOKING；發佈後 user 點擊應收到 reply text 含 LIFF /booking URL；其餘 7 entry 依序測試
- [ ] **Bot replies**：admin 在「自動回覆」tab 改 `passenger.follow` 文案；新 LINE 帳號加好友 → 收到 admin 設定新文案；按「還原預設」+ 儲存 → 加好友收到 hard-coded fallback
- [ ] **公告整合（Q3=3b）**：公告發佈 → 推播 Flex 結構與 P38 一致（hero / title / body / cta footer 樣式無 regression）
- [ ] **Diagnostics MVP**：手動透過 LINE Developer Console 建一個 richmenu（不經本系統）→ Diagnostics tab 偵測為 ORPHAN；點清理 → LINE 端 DELETE 成功 → 重檢查綠勾
- [ ] **A1 cleanup**：訂單建立 → 乘客收到 Flex 推播；admin 在 /admin/line-management Flex Templates tab 改 `order.pending` 標題 → 下一筆新訂單推播看到新標題
- [ ] **Audit log**：super 查 audit_logs 確認 `line.bot_reply.update` / `line.template.update` / `line.richmenu.delete` 都寫入；舊 `notification_template.update` action 在 cleanup 後不再新增（歷史紀錄保留）

### 4.3 文件 + Archive

- [x] [version.ts](version.ts) bump v0.3.22 → v0.3.23
- [x] [HANDOFF.md](HANDOFF.md) 撰寫（沿用 P38 archive 格式）
- [x] `openspec/changes/2026-05-15-line-oa-p40-followups/` mv 至 `archive/`
- [x] memory `project-p40-line-oa-followups.md` 更新完工狀態；MEMORY 索引同步

### 4.4 Stage Gate

- [x] G4.1 lint + build pass（bundle 41.2 → 40.7 MB，A1 cleanup 縮 0.5 MB）
- [ ] G4.2 Brain AI 在 prod 跑 e2e 驗收（§4.2 checklist）
- [x] G4.3 commit + push origin HEAD:main（含 archive mv）

---

## 完成後解鎖

- **P41**：（若 Q5=5b 留尾）A1 cleanup
- **P42**：richmenu 多語版本
- **P43**：（若 Q4=4c 留尾）Diagnostics 完整版（event log + error log + raw list）/ richmenu alias / 分頁切換
- **P44**：richmenu 圖層合成器 + area editor 拖拉互動
