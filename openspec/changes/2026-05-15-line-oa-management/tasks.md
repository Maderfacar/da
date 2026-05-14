# Tasks — Admin LINE OA 管理系統（P38）

> **總時程**：≈ 5-6 工作天 / 7 Phase。每 Phase 結束 commit + push `origin HEAD:main`。
> **決策依據**：Brain AI 拍板 [design.md §10](design.md#10-開放問題待-brain-ai-拍板) 的 Q1-Q8（必拍至少 Q1-Q8 全部，否則 Phase 1+ 動不了）。
> **拍板前狀態**：以推 spec 預設展開（1a / 2a / 3a / 4a / 5b / 6b / 7a / 8b）；Brain AI 改 default → 對應 Phase task 同步重寫。

---

## Phase 0：Spec + Brain AI 拍板（0.5 天）

- [ ] 0.1 盤點現況：Wave 3-A1 既有結構 audit（`admin_settings_notification_templates/order-pending` doc + `order-pending-flex.ts` + `NotificationTemplate.vue` + 2 endpoint）
- [ ] 0.2 LINE Messaging API richmenu spec 整理（[design.md §1](design.md#1-line-messaging-api-整理richmenu-部分)）
- [ ] 0.3 撰寫 [proposal.md](proposal.md)
- [ ] 0.4 撰寫 [design.md](design.md)
- [ ] 0.5 撰寫 [tasks.md](tasks.md)（本檔）
- [ ] 0.6 commit + push origin HEAD:main
- [ ] 0.7 **等 Brain AI 拍板 Q1-Q8** → 任一未拍 / 改 default 則 spec 重寫 → 重 push → 再等
- [ ] 0.8 拍板確認後 design.md §11 補上每個 Q 的結論 → commit + push

**進 Phase 1 的條件**：Q1-Q8 全部拍板（至少 Q1, Q2, Q3, Q4, Q5, Q6 是阻塞性，Q7, Q8 可延後但建議一起拍）。

---

## Phase 1：Richmenu 後端（1.0 天）

> **前置**：Q1 / Q2 / Q3 拍板。

### 1.1 Firestore schema + rules

- [ ] [firestore.rules](firestore.rules) 加 `line_richmenus` 規則（admin read only，server-only write）
- [ ] [firestore.indexes.json](firestore.indexes.json) 加 `(channel ASC, status ASC, updatedAt DESC)` composite index
- [ ] **User 部署 rules + indexes**（不在程式碼層做）

### 1.2 LINE Richmenu API Client

- [ ] 新增 `server/utils/line-richmenu.ts`（[design.md §5](design.md#5-line-richmenu-api-client-serverutilsline-richmenuts)）：
  - `createRichmenu` / `uploadRichmenuImage` / `setDefaultRichmenu` / `clearDefaultRichmenu` / `getDefaultRichmenuId` / `listRichmenus` / `deleteRichmenu` / `linkRichmenuToUser`
  - 自訂 `LineApiError` class
  - 5xx 自動 retry 1 次

### 1.3 Postback whitelist（若 Q3 含 postback）

- [ ] 新增 `server/utils/line-postback-handlers.ts`
- [ ] Phase 2 設計師確認後填 4-8 個 whitelist entry（暫先做 framework）
- [ ] [server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` 加 `postback` event 分支 → 查 whitelist → 跑 handler

### 1.4 Admin endpoints（無 UI，純 API）

- [ ] `GET /nuxt-api/admin/line-richmenus`
- [ ] `GET /nuxt-api/admin/line-richmenus/[id]`
- [ ] `POST /nuxt-api/admin/line-richmenus`
- [ ] `PATCH /nuxt-api/admin/line-richmenus/[id]`
- [ ] `DELETE /nuxt-api/admin/line-richmenus/[id]`
- [ ] `POST /nuxt-api/admin/line-richmenus/[id]/upload-image`（multipart）
- [ ] `POST /nuxt-api/admin/line-richmenus/[id]/publish`（複合：tx archive 舊 active + LINE API push + set default）
- [ ] `POST /nuxt-api/admin/line-richmenus/[id]/unpublish`
- [ ] `POST /nuxt-api/admin/line-richmenus/[id]/sync-status`
- [ ] `POST /nuxt-api/admin/line-richmenus/[id]/test-bind`（測試用）
- [ ] 全部套 `hasPermission(auth, 'canBroadcast')` + audit log + rate limit（publish ≤ 5/hr）

### 1.5 Audit log action

- [ ] [server/utils/audit-log.ts](server/utils/audit-log.ts) `AuditAction` 加 `line.richmenu.*`（create / update / publish / unpublish / delete / sync）

### 1.6 Stage Gate

- [ ] G1.1 `pnpm lint` pass
- [ ] G1.2 `pnpm build` pass
- [ ] G1.3 curl / Postman 手測 endpoints flow：建草稿 → 上傳圖 → publish → LINE actual 端確認 menu 生效
- [ ] G1.4 commit + push origin HEAD:main（無 UI 入口、無 prod 風險）

---

## Phase 2：Richmenu Admin UI（1.5 天）

> **前置**：Phase 1 endpoints 全綠 + Q8 拍板。

### 2.1 新頁路由

- [ ] 新增 `app/pages/admin/line-management/index.vue`（layout: back-desk + middleware: auth/role + ssr: false）
- [ ] 在 admin 端 layout / 主導航加入口（依 Q8）

### 2.2 Richmenu Tab 主介面

- [ ] tab 結構：Richmenu / Flex Templates / Bot Replies（Q6=6c 才有）/ Diagnostics（Q8=8b 含才有）
- [ ] Richmenu tab 內 channel sub-tab：passenger（藍） / driver（綠）顏色區分
- [ ] 列表卡片（依 [design.md §6.2](design.md#62-richmenu-tab)）

### 2.3 編輯彈窗

- [ ] 新增 `app/components/open/dialog/line-richmenu/Edit.vue`：
  - 基本資訊：name / chatBarText / selected
  - **圖片上傳元件**：拖放 + 預覽 + 寬高/filesize 警示（≤ 1MB、2500×1686 或 2500×843）
  - **Area 編輯器**：
    - 圖上 overlay grid（quick set: 1×1 / 2×2 / 2×3 / 3×2 / 3×3）
    - 拖拉 / 數字輸入 bounds（百分比 + 像素並存）
    - action 編輯（依 Q3 拍板支援 1-3 種 type）
    - postback option 從 whitelist 撈下拉（不可自由輸入）
  - 即時 LINE chat mockup 預覽
  - 動作：儲存草稿 / 儲存並發佈（二次確認）/ 取消

### 2.4 API 接線

- [ ] `app/protocol/fetch-api/api/admin/line-richmenu/` 新模組
- [ ] type 定義（`LineRichmenu` / `LineRichmenuArea` / `LineRichmenuAction`）

### 2.5 圖片上傳整合

- [ ] 沿用 P37 / A1 圖片上傳模式（Firebase Storage multipart）
- [ ] client 端寬高 / filesize 預檢
- [ ] server 端 sharp 二次驗證寬高

### 2.6 Stage Gate

- [ ] G2.1 lint + build pass
- [ ] G2.2 手測：建 richmenu → 上傳圖 → 設 area → 預覽 → 發佈
- [ ] G2.3 **真實 LINE OA 驗證**：兩 OA 各設一個 menu → 手機 LINE 看到圖文選單 → 點 area 觸發 action（uri / message / postback 都試一次）
- [ ] G2.4 commit + push origin HEAD:main

---

## Phase 3：Template Registry + 通用 Builder + Endpoints（1.0 天）

> **前置**：Q4 / Q5 / Q6 拍板。

### 3.1 Template Registry

- [ ] 新增 `server/utils/template-registry.ts`（[design.md §3](design.md#3-template-registryq44a-推-spec-預設)）：
  - `TEMPLATE_REGISTRY` 含 Q6 拍板的所有 templateKey（6a=1個 / 6b=5個 / 6c=9+個）
  - `buildTemplateFlex(template, params)` 通用 Flex builder（取代 A1 `buildOrderPendingFlex` 寫死邏輯）
  - `loadTemplate(db, templateKey)` 通用 loader

### 3.2 既有 A1 wrapper 改為 alias（Q5=5b）

- [ ] [server/utils/order-pending-flex.ts](server/utils/order-pending-flex.ts) 內部改 call `loadTemplate` + `buildTemplateFlex`，export 簽名維持（向下相容）
- [ ] 雙路徑讀寫：先讀新 collection `notification_templates/order.pending`；不存在 fallback 舊 `admin_settings_notification_templates/order-pending`（migration 過渡）

### 3.3 Migration script（一次性）

- [ ] 新增 `server/utils/migrations/migrate-a1-template.ts`：
  - 讀 `admin_settings_notification_templates/order-pending` → 寫 `notification_templates/order.pending`（含 ctaButton.action 結構轉換：A1 `{ label, url }` → 新 `{ label, action: { type: 'uri', url } }`）
- [ ] 提供 `POST /nuxt-api/admin/migrations/a1-template`（super only，single-shot）
- [ ] 部署後 User 手動 trigger 一次

### 3.4 通用 endpoints

- [ ] `GET /nuxt-api/admin/notification-templates`（列 registry × doc merge）
- [ ] `GET /nuxt-api/admin/notification-templates/[key]`
- [ ] `PUT /nuxt-api/admin/notification-templates/[key]`（validation 依 registry placeholder schema）
- [ ] `POST /nuxt-api/admin/notification-templates/[key]/upload-cover`
- [ ] `POST /nuxt-api/admin/notification-templates/[key]/reset`
- [ ] 全部 `canBroadcast` + audit log（`line.template.update` / `.reset`；保留 `notification_template.update` alias）

### 3.5 A1 既有 endpoint 雙寫 / alias

- [ ] [server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts](server/routes/nuxt-api/admin/settings/notification-templates/order-pending.get.ts) 內部 redirect / shared handler 讀新 collection
- [ ] PUT 同上 + 同時寫舊 collection（過渡期保持）

### 3.6 Firestore rules + indexes

- [ ] `firestore.rules` 加 `notification_templates` 規則
- [ ] `(category ASC, enabled ASC, templateKey ASC)` composite index（如 list 頁需排序）

### 3.7 Stage Gate

- [ ] G3.1 lint + build pass
- [ ] G3.2 **e2e 建單回歸**：乘客建單 → 確認新 collection 不存在時 fallback 舊 collection 正常推 Flex；migrate 完後新 collection 走通用 builder 推 Flex 與舊一致
- [ ] G3.3 手測 5 個 templateKey（Q6=6b）各 PUT 後 doc 寫入正確
- [ ] G3.4 commit + push origin HEAD:main

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

## Phase 5：Bot Replies / 公告整合 / Diagnostics（0.5-1.0 天，依 Q6/Q8）

> **前置**：Phase 4 全綠 + Q6, Q8 拍板。

### 5.1 Bot Replies（若 Q6=6c）

- [ ] `bot_replies` collection schema + rules
- [ ] `GET / PUT /nuxt-api/admin/bot-replies` + `/[key]`
- [ ] [server/utils/line-channel.ts](server/utils/line-channel.ts) `_reply()` 改讀 `bot_replies/{client}.{follow|text}` doc → fallback hard-coded（向下相容）
- [ ] admin UI Bot Replies tab：4 row × { enabled + textarea }
- [ ] audit log `line.bot_reply.update`

### 5.2 公告系統整合（若 Q6=6c）

- [ ] `server/utils/announcement-flex.ts` 評估能否完全併入 `template-registry.ts`（announcement category）
- [ ] 若可併：建 templateKey `announcement.default` 走通用 builder
- [ ] 若不可（announcement 走 multicast、有 target 過濾、不適合 template static schema）：保留 announcement-flex.ts 獨立、不併

### 5.3 Diagnostics（若 Q8=8b 含）

- [ ] 新增 `line_event_logs` / `line_api_errors` collection + TTL 7d
- [ ] webhook handler 寫 log
- [ ] LINE API client catch 內統一寫 error log
- [ ] admin UI Diagnostics tab：
  - 最近 50 筆 webhook event（依 channel filter）
  - 最近錯誤 log
  - richmenu sync 狀態總覽（本地 active doc vs LINE actual default ID）

### 5.4 Stage Gate

- [ ] G5.1 lint + build pass
- [ ] G5.2 手測：bot reply 改字 → 用新 LINE 帳號 follow OA → 收到新文案 / 傳訊息 → 收到新自動回覆
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

- **P39**（若 Q6=6a 留尾）：另 4 個訂單事件 template 化（confirmed / en_route / completed / cancelled）— 直接在通用編輯器加新 registry entry 即可
- **P40**：A1 舊 collection `admin_settings_notification_templates` + 舊 audit log alias 清理
- **P41**：richmenu 多語版本（每 channel × {zh, en, ja}）
- **P42**：richmenu alias / 分頁切換（richmenuswitch）
- **P43**：richmenu 圖層合成器（admin 不需設計師外部工具產圖）

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
