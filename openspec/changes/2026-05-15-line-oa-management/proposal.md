# 2026-05-15 — Admin LINE OA 管理系統（P38）

> **狀態**：Phase 0 spec 草案 — 等 Brain AI 拍板 5+ 關鍵決策後才進 Phase 1 實作。
> **規模**：專案目前最大規模 feature（預估 5-6 工作天 / 6-7 Phase），跨 admin / server / LINE OA 三端。

## Why

P29 / P37 / Wave 3-A1 把 LINE 雙 OA（passenger / driver）跑起來，但 admin 對 OA 的「視覺面 + 內容面」管理仍是黑盒：

1. **Richmenu 完全缺席**：兩個 OA 沒有圖文選單。乘客點開 OA 只看到一段文字 + LIFF link；司機端同樣。Onboarding / 主要動作（訂車 / 客服 / 派單 / 我的任務）需要靠記憶 chat 訊息或 LIFF 內部導覽，**新使用者轉化率與留存率都直接受影響**。
2. **手動推 richmenu 風險高**：若改走 LINE Official Account Manager 圖形介面手動操作，admin 需要自己準備兩張 2500×1686 圖、計算 area bounds、處理 fail 重試；無 audit log、無 prod 變更紀錄。雙 OA × 多版本（v1/v2/節慶）瞬間失控。
3. **Flex 模板系統只做了 1 個事件**：Wave 3-A1 把 `order.pending` 抽成 admin 可編輯模板（`admin_settings_notification_templates/order-pending`），但：
   - 寫死 doc id = `order-pending`、寫死 5 個 placeholder（`{date}` `{pickup}` `{vehicle}` `{fare}` `{orderId}`）
   - `server/utils/order-pending-flex.ts` 整個檔案專為 order-pending 而生
   - admin UI 元件 `AdminSettingsNotificationTemplate` 也是寫死綁 order-pending
   - 留尾 P39（另 4 個訂單事件模板化）若各自開一個 endpoint + 元件 + util，會 copy-paste 五份 → 不可維護
4. **公告 Flex 也是硬編碼**：P37 `server/utils/announcement-flex.ts` 走 `buildAnnouncementFlex(announcement)`，雖支援 admin 編輯（透過 announcement collection），但結構與 A1 模板沒有共用 builder/preview，admin 學兩套介面。
5. **Bot 自動回覆文案寫死**：`server/utils/line-channel.ts` 內 `FOLLOW_MESSAGES` / `TEXT_REPLY_MESSAGES` 是 hard-coded 繁中字串；節慶 / 行銷期想換問候語要走 PR 流程過慢（同 A1 痛點 #3 的延伸）。

P38 目標：把上述五件事整併成「Admin LINE OA 管理系統」一站式管控介面。Wave 3-A1 是「first instance」，P38 是「泛化」。

## What Changes

### 1. Richmenu 管理（核心新功能）

新增 admin 端 LINE OA 圖文選單 CRUD：

- **資料來源**：本系統 = single source of truth；LINE 上的 richmenu 由本系統 push 並維持同步。
- **雙 OA 各自獨立**：passenger / driver 兩個 channel 維持各自一份 richmenu set。
- **單一 default + multi draft**：每個 channel 同時只能有 1 個 active default richmenu；其他存草稿備用、可 publish 切換。
- **三 action 類型支援**（**Brain AI 拍板：Q3**）：
  - `uri`（外連網址 / LIFF link）
  - `message`（送 user 訊息給 OA）
  - `postback`（觸發 webhook → server 自訂回應）
  - 第一版**不做** `richmenuswitch`（alias / 分頁切換）+ `datetimepicker` 等冷門 action
- **圖片**：admin 直接上傳成品 PNG/JPEG（≤ 1MB，2500×1686 large 或 2500×843 compact），存 Firebase Storage；**第一版不做圖層 builder / 文字 overlay 合成**（複雜度爆炸 + 設計師外部工具產出更佳）。
- **Area mapping 編輯器**：admin 上傳圖後在介面以拖拉 / 數字輸入定義 area bounds（max 20 個），每 area 綁 action。

### 2. Flex Template 通用編輯器（A1 泛化）

A1 是 first instance，P38 把它泛化成可擴充的「事件模板系統」：

- **TemplateRegistry**：定義每個 template key 的 metadata（placeholder 名稱 / 預設文案 / 用途說明）。位於 server code（**Brain AI 拍板：Q4 — registry 在 server hard-coded vs Firestore 動態 doc**）。
- **A1 endpoint 處理策略**（**Brain AI 拍板：Q5**）：
  - 5a 維持 A1 endpoint 不動，新事件各自獨立 endpoint
  - 5b A1 endpoint 廢棄改用通用 `/nuxt-api/admin/settings/notification-templates/{eventKey}`，A1 endpoint 留 alias 反向相容
  - 5c 直接 break A1 endpoint，admin UI 統一改走新 endpoint（A1 部署不到一週、影響面可控）
- **Admin UI 統一介面**：一個 template list 頁，左邊 list 所有 template key（含 A1 order-pending），右邊編輯器（title / body / cover / CTA + 動態 placeholder chip）+ 預覽。
- **Phase 1 內含的 template 範圍**（**Brain AI 拍板：Q6**）：
  - **6a 最小**：只搬 A1 進通用編輯器（不擴新 event）
  - **6b 包 P39**：含 A1 + 另 4 個訂單事件（confirmed / en_route / completed / cancelled）= 5 個 template
  - **6c 全包**：含 A1 + P39 + bot follow / text reply 文案（從 `line-channel.ts` 抽離）+ 公告（與 P37 announcement-flex.ts 共用 builder）
- **CTA action 擴充**：A1 ctaButton 只支援 `uri`，新版支援 `uri` / `message` / `postback` 三種（與 richmenu area action 對齊）— **Brain AI 拍板：Q7 — CTA action 範圍**

### 3. Bot 自動回覆文案管理（可選 — 看 Q6 / Q7 拍板結果）

若 Q6 = 6c，把 `server/utils/line-channel.ts` 內 `FOLLOW_MESSAGES` / `TEXT_REPLY_MESSAGES` 抽離至 `bot_replies/{channel}_{eventType}` template doc，admin 可在統一介面編輯。否則留 P40 backlog。

### 4. Admin 入口位置（**Brain AI 拍板：Q8**）

選項：
- **8a** `/admin/settings` 新加 LINE 區（與既有 ACCESS / FLEET / NOTIFICATIONS section 並列） — 已超載 4 個 section
- **8b** 新獨立頁 `/admin/line-management` 含 4 個 tab（Richmenu / Flex Templates / Bot Replies / Webhook Diagnostics） — 邏輯完整、但增加 admin nav
- **8c** 拆成兩個獨立頁：`/admin/line-richmenu` + `/admin/line-templates`

### 5. Webhook Diagnostics（可選）

若 Q8 = 8b，新加 tab 顯示：
- 兩個 OA channel 最近 50 筆 webhook event（type / userId / timestamp）
- LINE API call 最近錯誤（push fail / multicast fail）
- richmenu sync 狀態（本系統 doc vs LINE actual）
否則留 P40 backlog。

## Out of Scope（明確不做）

- ❌ **Richmenu 圖層合成器**：admin 從 grid + 文字 overlay 產圖（第一版需手動準備成品圖）
- ❌ **Richmenu alias / 多分頁切換**：第一版每 channel 1 個 default、其他為 draft；不做 user 在訊息中切換不同分頁
- ❌ **Richmenu per-user 個人化**：第一版只支援 default（全 user 同 menu）+ 手動 per-user override 用於測試；不做按角色 / 等級 / 偏好的自動 per-user 分配
- ❌ **A/B test split**：模板無 variant；richmenu 一次只有一個 active
- ❌ **模板版本歷史 / 回滾**：只記 updatedAt + updatedBy，需 rollback admin 手動改
- ❌ **Postback 路由 admin 編輯**：第一版 postback data 由 admin 在介面填字串，server 端對應 handler 仍 hard-coded（即 admin 改 postback data 之後 server 不會自動處理新 data，需 PR）
- ❌ **OA 統計報表**：follower 數 / 推播開信率 / richmenu 點擊熱區
- ❌ **多語 richmenu**：每個 channel 1 套 richmenu，三語使用者看到同一套；如要多語走 P41 backlog
- ❌ **Carousel / 多 bubble Flex**：模板維持 A1 single-bubble 結構

## Impact

### 影響範圍

- **新增 Firestore collection**：
  - `richmenus`（admin 編輯狀態 + LINE richMenuId 對應，每個 channel 各自 doc set）
  - `bot_replies`（若 Q6=6c）
  - 可能新增 / 重組 `admin_settings_notification_templates` 結構（看 Q5 拍板）
- **新增 endpoint**：~15-20 個（richmenu CRUD ~8 個 + flex template list/get/put ~3 個 + 圖片上傳 1 個 + LINE sync ~3 個 + diagnostics 可選 ~3 個）
- **新增頁面**：1-3 個 admin 頁（看 Q8）
- **新增 server util**：
  - `server/utils/line-richmenu.ts`（LINE API client + sync）
  - `server/utils/template-registry.ts`（template metadata + placeholder schema，泛化 A1 `order-pending-flex.ts`）
  - 重構或 alias `server/utils/order-pending-flex.ts` 走通用 builder
- **改動既有檔**：
  - `server/utils/announcement-flex.ts`（可能合進通用 builder）
  - `server/utils/line-channel.ts`（若 Q6=6c 抽 FOLLOW_MESSAGES）
  - `server/routes/nuxt-api/orders/index.post.ts`（A1 load 路徑可能換通用 loader）
- **Storage path 新增**：`line-richmenus/{channel}/{richmenuDocId}/image.{ext}`、可能擴 `notification-template-covers/{templateKey}/...`
- **Firestore rules**：admin 才能寫 richmenus / templates / bot_replies；read 規則：只 admin（passenger / driver 端不直接讀，由 LINE 端 render）

### 風險

| 風險 | 緩解 |
|---|---|
| LINE API 變更導致 richmenu push 失敗 | sync 邏輯做 retry + 對齊 LINE error code；admin UI 顯示「LINE 同步狀態」（本地 doc vs LINE actual）並提供「重試 sync」按鈕 |
| Image 上傳 > 1MB 或寬高不符 → LINE 拒收 | 上傳 endpoint 客戶端 + server 雙重驗證；server 端用 sharp 讀取尺寸 + filesize 卡關，超過時退回 400 |
| Richmenu set default 之後 LINE 自動清舊 default | 本系統維持「single active per channel」邏輯，publish 新 default 前自動 unset / delete 舊 active；audit log 紀錄 |
| 通用化過頭破壞 A1 既有 prod 流程（訂單建單 push） | Q5=5a/5b 保留 A1 endpoint；通用 endpoint 上線後做 e2e（建單 → 乘客收 Flex）才切；5c 風險最高、不建議首選 |
| Postback action admin 編輯但 server handler 沒對齊 | UI 端有 postback data 對應表（whitelist of known prefixes，e.g. `OPEN_BOOKING` / `CONTACT_SUPPORT` / `MY_TRIP` / `DRIVER_PENDING_LIST`），admin 只能從清單選；輸入 free-form 需 dev 補 handler |
| 兩 OA richmenu 混淆（admin 設錯 channel） | UI 切 channel 用顯眼 tab + 顏色區分；publish 前 confirm dialog 二次確認 |
| richmenu image 在 Firebase Storage 公開 URL 不可被 LINE 取得 | Storage rule 設 public read（與 announcement cover 同策略）；server push 時用 service account 直接讀 binary 上傳，避免依賴 public URL |
| 移除 A1 hard-coded path 後既有 audit log action 不一致 | audit log action 命名規範新增前綴 `line.richmenu.*` / `line.template.*` / `line.bot_reply.*`；A1 既有 `notification_template.update` 保留為 alias |

### 估時

詳見 [tasks.md](tasks.md)。粗估：

| Phase | 內容 | 估時 |
|---|---|---|
| **Phase 0** | spec 三件套 + Brain AI 拍板 5+ 決策 | 0.5d |
| **Phase 1** | Richmenu schema + LINE API client + sync logic | 1.0d |
| **Phase 2** | Richmenu admin UI（image upload + area editor + preview） | 1.5d |
| **Phase 3** | Flex template 通用編輯器 schema + endpoints + registry | 1.0d |
| **Phase 4** | Flex template admin UI 統一介面 + A1 migration | 1.0d |
| **Phase 5** | （依 Q6/Q7）Bot replies / 公告整合 / Webhook diagnostics | 0.5-1.0d |
| **Phase 6** | e2e 手測（LINE 推實機 + admin / passenger / driver 多端） + archive | 0.5d |
| **總計** | | **5-6 工作天** |

## 待 Brain AI 拍板的關鍵決策（必須先給）

詳見 [design.md §10](design.md#10-開放問題待-brain-ai-拍板)。共 **8 個關鍵問題**，其中至少 5 個必須先拍才能進 Phase 1：

1. **Q1**：Richmenu single-default vs multi-draft 策略 — 推 spec 預設「single active + 多 draft」是否同意？
2. **Q2**：Richmenu image source — 純成品圖上傳（推 spec 預設）vs admin grid builder（不推）
3. **Q3**：Richmenu area action 範圍 — 三選（uri / message / postback）vs 全選 vs 只兩選（uri / message）
4. **Q4**：Template registry 位置 — 4a server hard-coded（推）/ 4b Firestore 動態 / 4c 混合
5. **Q5**：A1 endpoint 處理 — 5a 並存 / 5b alias 反向相容 / 5c break 換新
6. **Q6**：Phase 1 template 範圍 — 6a 只 A1 / 6b A1+P39 / 6c 全包
7. **Q7**：CTA action 擴充範圍 — 跟 Q3 對齊還是只支援 uri？
8. **Q8**：Admin 入口位置 — 8a / 8b / 8c

未拍板前 spec 暫以**推 spec 預設**（Q1=single+draft、Q2=純上傳、Q3=三選、Q4=4a、Q5=5b、Q6=6b、Q7=與 Q3 對齊、Q8=8b）展開設計，Brain AI 改 default 後 spec 同步重寫。
