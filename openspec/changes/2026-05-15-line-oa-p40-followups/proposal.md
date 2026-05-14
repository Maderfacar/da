# 2026-05-15 — P40 LINE OA 系統收尾（Bot Replies + Postback Whitelist + Diagnostics + 公告整合）

> **狀態**：Phase 0 spec 草案（**新視窗執行**）— 等 Brain AI 拍板 Q1-Q5 後才進 Phase 1。
> **前置**：P38 完工（commits 742abcf..d6377a6 已 push main + firebase rules/indexes 已部署）。
> **規模**：中等（預估 2-3 工作天 / 4-5 Phase），補完 P38 階段刻意延後的 4 個子範圍。

## Why

P38 把 LINE OA 管理系統的「核心骨架」做完（richmenu CRUD + flex template 通用編輯器 + admin 介面）並 ship 上 prod，但有 4 個子範圍刻意延後到本 Wave：

1. **Postback whitelist 為空陣列**：[server/utils/line-postback-handlers.ts](server/utils/line-postback-handlers.ts) framework 已建，`POSTBACK_WHITELIST` 為空。admin 在 richmenu area / Flex CTA 編輯 postback action 時可填字串，但 user 點擊後 server `no handler` warning，沒實際反應。**這讓 richmenu 的 postback action 等於擺著看不能用**。
2. **Bot 自動回覆文案硬編碼**：[server/utils/line-channel.ts](server/utils/line-channel.ts) 內 `FOLLOW_MESSAGES` / `TEXT_REPLY_MESSAGES` 4 條繁中字串。節慶 / 行銷期想換問候語必須改 code 走 PR 流程；新 user 加好友 OA 收到的第一句話「感謝您加入 DestinationAnywhere！」幾個月沒變。
3. **公告 Flex 不在通用編輯器**：[server/utils/announcement-flex.ts](server/utils/announcement-flex.ts) 維持獨立，admin 在 [/admin/notifications](app/pages/admin/notifications/index.vue) 編輯公告（含 cover + CTA），但與通用 TemplateEditor 結構不一致（announcement 走 multicast、有 target 過濾、多筆獨立 doc — 與 template-registry 靜態 schema 不同）。需要評估能否合進通用 builder，或設計 hybrid 架構。
4. **Diagnostics tab 為 placeholder**：admin 真要查 LINE 同步狀態目前只有「sync-status」按鈕（單筆 richmenu 主動查）。沒有 webhook event log 看歷史事件、沒有 LINE API error log 看失敗紀錄、沒有 richmenu 本地 vs LINE 一致性 dashboard。**運維盲區**。

## What Changes

### 1. Postback Whitelist 補入 + handler 實作（核心新功能）

填 [server/utils/line-postback-handlers.ts](server/utils/line-postback-handlers.ts) `POSTBACK_WHITELIST`：

**Passenger OA**（4 個）：
- `OPEN_BOOKING`：回 LIFF 訂車 URL 訊息
- `OPEN_NOTIFICATIONS`：回 LIFF 通知中心 URL
- `CONTACT_SUPPORT`：回客服 LINE OA 連結或固定 FAQ Flex
- `MY_TRIP`：回 LIFF 我的行程 URL

**Driver OA**（4 個）：
- `OPEN_DASHBOARD`：回 LIFF 司機儀表板 URL
- `PENDING_LIST`：回 LIFF 搶單列表 URL
- `MY_PROFILE`：回 LIFF 司機個人頁 URL
- `TRIP_GPS`：回 LIFF 任務 GPS 頁 URL（or 提示無進行中訂單）

LIFF URL 從 `runtimeConfig.public.liffBaseUrl` 取，或新增 env var（**Brain AI 拍板：Q1**）。

### 2. Bot Replies Template 化（**Brain AI 拍板：Q2**）

選項：
- **2a**：抽 follow/text 文案進 `bot_replies/{client}.{type}` collection；用通用 template-registry 結構（meta + Firestore doc）；admin 在 /admin/line-management Bot Replies tab 編輯純 text + enabled toggle
- **2b**：抽進 `notification_templates/bot.{client}.{type}`（與 order template 同一個 collection；統一 registry meta）
- **2c**：只抽進靜態 i18n 檔（i18n/locales/zh.js 加 `linePush.botFollow.passenger` 等）；admin 不可動態改，需 PR + 部署

**2a 與 2b 差異**：2b 用 template-registry 統一架構（包含 Flex builder），但 bot reply 只需 text 不需 Flex；2a 設計專門 schema（純 text，無 cover/cta）更輕量。

### 3. 公告系統整合（**Brain AI 拍板：Q3**）

選項：
- **3a 不動**：announcement-flex.ts 保持獨立，admin 繼續走 /admin/notifications；通用 TemplateEditor 不含公告 category（維持現狀）
- **3b 混合**：announcement-flex.ts 內部改 call template-registry 的 buildTemplateFlex（共用 Flex 組裝邏輯），但 admin UI / collection / multicast 流程不變
- **3c 完全併**：公告改用 template-registry，每筆 announcement 對應一個動態 templateKey（如 `announcement.{id}`）— 高度重構，可能拆 P42

P38 預設「不可併」（design.md §5.2），但本 Wave 重新評估。

### 4. Diagnostics Tab（**Brain AI 拍板：Q4**）

選項：
- **4a 完整**：
  - `line_event_logs/{autoId}`：webhook handler 入口每筆寫（type / channel / userId / timestamp），TTL 7d
  - `line_api_errors/{autoId}`：LINE API client catch 內統一寫，TTL 7d
  - Diagnostics tab UI：最近 50 筆 event / error log + richmenu 本地 vs LINE actual default 一致性 dashboard
- **4b MVP**：
  - 只做 richmenu sync overview（GET 所有 active richmenu 對 LINE listRichmenus 比對）
  - 不寫 event/error log collection（省 Firestore 寫入成本）
  - admin sync-check 按鈕單筆查維持，dashboard 一鍵全 channel check
- **4c 延後**：本案不做，留 P43；admin 暫用 sync-status 單筆按鈕

### 5. A1 cleanup 評估（**Brain AI 拍板：Q5**）

- **5a 本案處理**：移除 A1 舊 collection `admin_settings_notification_templates`、舊 endpoint `/admin/settings/notification-templates/order-pending.{get,put}.ts`、舊 admin UI section（/admin/settings 內 `AdminSettingsNotificationTemplate`）、wrapper `order-pending-flex.ts`、`AuditAction.notification_template.update` alias
- **5b 延後 P41**：本案不動，後續 Wave 再清

**先決條件**：A1 doc 在 prod 不存在（已驗證），新 collection 走通用 endpoint + UI；A1 alias 純粹過渡相容用，可安全移除。

## Out of Scope（明確不做）

- ❌ Richmenu 多語版本（per-user 依 users.lang 自動切）— **P42**
- ❌ Richmenu alias / 分頁切換（richmenuswitch action）— **P43**
- ❌ Richmenu 圖層合成器 + area editor 拖拉互動 — **P44**
- ❌ 公告 P37 系統的功能擴充（target 進階分群、排程發佈）— P37 archive 範圍
- ❌ Webhook event log 進階查詢 / 視覺化（heatmap / time series）— 第一版 raw list 為主
- ❌ LINE quota dashboard（剩餘 push 額度 / multicast 次數）— LINE API 不直接提供，需自己 track，延後

## Impact

### 影響範圍

依 Q1-Q5 拍板會浮動：

- **新增 Firestore collection**：0-3 個（依 Q2 / Q4）：
  - 若 Q2=2a：`bot_replies`
  - 若 Q4=4a：`line_event_logs` + `line_api_errors`
- **新增 endpoint**：~3-8 個（bot replies CRUD ~2 + diagnostics ~2-4 + 公告整合 ~0-2）
- **新增頁面**：不新增（/admin/line-management 已有 4 tab 架構，本案是把 Bot Replies + Diagnostics 兩個 placeholder 換成實作）
- **新增 server util**：
  - `server/utils/line-postback-handlers.ts` 補 8 個 entry + helper（共用 LIFF URL 組裝）
  - 可能新增 `server/utils/event-log.ts`（Q4=4a）
- **改動既有**：
  - `server/utils/line-channel.ts`（Q2=2a：`_reply()` 內讀 bot_replies doc → fallback hard-coded；Q4=4a：handleLineWebhook 入口寫 event log）
  - `server/utils/line-push.ts` / `line-richmenu.ts` catch（Q4=4a：寫 error log）
  - `server/utils/announcement-flex.ts`（Q3=3b：內部 call template-registry buildTemplateFlex）
  - `app/pages/admin/line-management/index.vue`（Bot Replies / Diagnostics tab 內容 + 把 ready=true）
- **A1 cleanup 影響**（Q5=5a）：
  - 移除：`admin_settings_notification_templates` collection + `order-pending-flex.ts` + A1 endpoint 2 個 + admin/settings NOTIFICATIONS section + `AdminSettingsNotificationTemplate.vue` 元件 + `AuditAction.notification_template.update` alias

### 風險

| 風險 | 緩解 |
|---|---|
| Bot Replies 抽離後 follow event 推播文案改變，現有 user 看到新文案可能怪 | 第一版 default 文案沿用 hard-coded 既有字串，admin 不編輯時行為與現狀完全一致 |
| Postback whitelist handler reply 失敗導致 user 體驗破 | handler 內 try/catch + fallback text；LINE reply token 有 1 分鐘 TTL，handler 必須快速回應 |
| Diagnostics event log 寫入 Firestore 燒成本 | TTL 7d 自動清；建議寫入採 fire-and-forget（不阻擋 webhook 處理）；webhook QPS 個位數 → 月 < 1 萬筆 doc → 成本 < US$0.5 |
| A1 cleanup 後既有 audit log 查詢 action='notification_template.update' 篩不到新記錄 | dual-write 期間 audit log 已同時寫 `notification_template.update` + `line.template.update`；P38 archive 後就只寫新 action；篩選改用 `targetType='notification_template'` 不依賴 action |
| 公告整合（Q3=3b/3c）破壞 P37 既有公告推播流程 | Q3=3b 內部改 call 不變對外行為，e2e 跑公告發佈確認推播一致；Q3=3c 為大重構，建議延後 |

### 估時

| Phase | 內容 | 估時 |
|---|---|---|
| 0 | spec + Brain AI 拍板 Q1-Q5 | 0.5d |
| 1 | Postback whitelist 8 個 entry + handler | 0.5d |
| 2 | Bot Replies template 化（schema + endpoint + UI tab） | 0.5d |
| 3 | Diagnostics（依 Q4 範圍）+ 公告整合（依 Q3 範圍） | 0.5-1.0d |
| 4 | A1 cleanup（若 Q5=5a）+ e2e + archive | 0.5d |
| **總計** | | **2.0-3.0d** |

## Brain AI 拍板的關鍵決策（必須先給）

詳見 [design.md §6](design.md#6-開放問題待-brain-ai-拍板)。共 **5 個關鍵問題**：

1. **Q1**：Postback handler LIFF URL 取值來源 — `runtimeConfig.public.liffBaseUrl`（推 spec 預設）/ 新增 env var
2. **Q2**：Bot Replies 抽離方式 — 2a 專屬 collection / 2b 併 notification_templates / 2c 純 i18n
3. **Q3**：公告系統整合 — 3a 不動 / 3b 混合（共用 builder）/ 3c 完全併（延後 P42 風險）
4. **Q4**：Diagnostics 範圍 — 4a 完整 / 4b MVP / 4c 延後 P43
5. **Q5**：A1 cleanup 時機 — 5a 本案處理 / 5b 延後 P41

未拍板前 spec 以**推 spec 預設**（Q1=runtimeConfig / Q2=2a 專屬 collection / Q3=3b 混合 / Q4=4b MVP / Q5=5a 本案）展開設計，Brain AI 改 default 後 spec 同步重寫。
