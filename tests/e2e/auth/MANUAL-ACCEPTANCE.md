# Auth 手動驗收清單 (Tier C)

> 本清單對應 auth e2e 矩陣（共 14 場景）中**無法自動化**的 4 個場景。
> 自動化部分由 `tests/e2e/auth/*.spec.ts` 涵蓋（Tier A + Tier B 共 10 場景），
> 本清單由 Brain AI 在每次 auth 相關 PR / prod hotfix 後親手照表跑一輪。

## 為什麼這 4 場景不自動化

- **真實 LIFF SDK 行為**：`@line/liff` 在 headless 環境不可信任（getProfile / getAccessToken 行為與真機差）
- **多帳號切換**：Playwright 無法控制 LINE app 端的帳號切換
- **跨瀏覽器 storage 隔離**：iOS Safari Private 模式對 IndexedDB / localStorage 的限制需真機驗證
- **infinite loop 偵測**：plugin boot redirect 風險需「真實 LINE 授權頁」回彈才能完整復現

---

## 場景 #11 — 全新 LINE 使用者首次進 LIFF `/booking` 不 infinite loop

**風險覆蓋**：2026-06-17 commit f9a7198 修復點（[[project-liff-no-auto-redirect]]）—
plugin boot 不可無條件 `liff.login()`，否則「裝有 LINE app 但未授權」的使用者
會被推到 LINE 授權頁 → user 取消 → redirect 回原 URL → plugin 再 login → 無限迴圈。

### 前置條件

- 一台**從未授權過本專案 LIFF channel** 的測試手機（或在 LINE app 內手動撤銷該 channel 授權）
- LINE app 已登入 LINE 帳號
- 測試 LIFF URL：`https://liff.line.me/{passenger-liff-id}/booking`

### 操作步驟

1. 在 LINE app 內貼上測試 LIFF URL → 點開
2. LINE 顯示授權確認頁時，**按「取消」**
3. 觀察：是否被立刻彈回 LINE 授權頁（infinite loop）？
4. 用 LINE in-app browser 的「⋯」→「在外部瀏覽器開啟」打開 DevTools（chrome://inspect 連手機）
5. Network tab 過濾關鍵字：`liff.line.me`、`access.line.me`、`/nuxt-api/auth/line-exchange`
6. Console tab 過濾：`[StoreAuth]`、`InitAuthFlow`、`liff_redirect_count`

### 預期結果

- ✅ 取消授權後**停在我們的 `/booking` 頁面**，可看到 booking 表單骨架或「請先登入」UI
- ✅ Network 看不到連續多次 `liff.login()` redirect chain
- ✅ Console 沒有 `[StoreAuth] InitAuthFlow` 重複輸出 5 次以上
- ✅ sessionStorage `liff_redirect_count` 數字不應持續增加（circuit breaker 應介入）

### 失敗時收集

- DevTools Network 完整 HAR（`Save all as HAR with content`）
- Console 完整截圖（含 `liff_redirect_count` 值）
- 重現步驟錄影（QuickTime / Android Screen Record）
- 收進：`docs/incidents/{YYYY-MM-DD}-liff-loop-{場景編號}/`

---

## 場景 #12 — 切 LINE 帳號不看到上個 user 資料

**風險覆蓋**：[[feedback-liff-endpoint]] + W4 lazy load reset 機制。
切換 LINE 帳號後 `users/{lineUid}` doc 不同，舊 user 的 roles / lineProfile / orders 不可殘留。

### 前置條件

- 兩個 LINE 帳號 A、B，皆已授權本專案 LIFF
- 兩個帳號在 prod 都有歷史訂單（避免「看似乾淨」是因為沒資料）
- 測試手機可在 LINE app 內切換帳號

### 操作步驟

1. LINE 帳號 A 登入 → 進 `/booking` → 確認 hamburger drawer 顯示帳號 A 的頭像/名稱
2. 進 `/orders` → 記下最上面 3 筆訂單 ID（截圖）
3. LINE app「設定」→「帳號」→ 切換到帳號 B
4. **不關閉瀏覽器、不清 cache**，重新進 `/booking`（從 LINE app 內 LIFF 進）
5. DevTools Application tab → Storage → 觀察 `localStorage.da_line_profile` 值是否已更新為 B 的 displayName
6. Application → IndexedDB → `firebaseLocalStorageDb` 觀察 currentUser uid 是否已切到 B 的 uid（`line:{B 的 lineUid}`）
7. 進 `/orders` → 比對訂單列表

### 預期結果

- ✅ Drawer 頭像/名稱**立刻顯示 B**，不出現 A 的殘影
- ✅ `/orders` 顯示 B 的訂單列表，**完全看不到 A 的訂單 ID**
- ✅ localStorage `da_line_profile` 已更新為 B
- ✅ localStorage `da_admin_2fa_session` 若 A 是 admin → 應已被清除（避免 B 借用 A 的 2FA session）

### 失敗時收集

- Application → Storage → localStorage / sessionStorage / IndexedDB 三者完整截圖
- `/orders` 顯示的訂單 ID（截圖）
- 收進：`docs/incidents/{YYYY-MM-DD}-account-switch-bleed/`

---

## 場景 #13 — LIFF 內 vs 外部瀏覽器走兩條路

**風險覆蓋**：plugin `_InitLiffFlow` 對「LIFF 環境」與「純 web」分流邏輯。
LIFF 內 `liff.isInClient()` = true → 走 LIFF token + getProfile；
外部瀏覽器 → 走 LIFF web login redirect。兩條路 token 來源不同、drawer 顯示行為應一致。

### 前置條件

- 同一個 LINE 帳號
- 同一台手機（避免裝置差異干擾）
- 兩個入口 URL：
  - LIFF 內：`https://liff.line.me/{passenger-liff-id}` （在 LINE app 內貼）
  - 外部：`https://da.{your-domain}` （在 Safari/Chrome 貼）

### 操作步驟

#### 13a — LIFF 內

1. LINE app 內貼 LIFF URL → 點開
2. DevTools（chrome://inspect 連手機）Console 執行：`window.__authStore.lineProfile`
3. 記錄 token 來源：Console 執行 `(await import('@line/liff')).default.getAccessToken().slice(0,10)`
4. 進 hamburger drawer 確認顯示頭像

#### 13b — 外部瀏覽器

1. Safari/Chrome 貼外部 URL → 進站
2. 點「LINE 登入」按鈕 → 跳 LINE 授權 → 同意 → redirect 回來
3. DevTools Console 執行：`window.__authStore.lineProfile`
4. Console 執行：`localStorage.getItem('da_line_profile')`
5. 進 hamburger drawer 確認顯示頭像

### 預期結果

- ✅ 兩條路 drawer 頭像/名稱**完全一致**（同帳號）
- ✅ 兩條路 `__authStore.lineProfile.displayName` 值一致
- ✅ 兩條路最終可正常進 `/booking` 填表
- ✅ 13a token 應有值；13b 在按過「LINE 登入」後也應有值

### 已知差異（不算失敗）

- LIFF 內可呼叫 `liff.getFriendship()` → 13a drawer 可能顯示「加好友」橫幅；13b 不顯示
- LIFF 內取 token 是同步（cached）；13b 是 redirect 後才有

### 失敗時收集

- 兩條路 Console `__authStore` 物件完整截圖
- 兩條路 Network `/nuxt-api/auth/line-exchange` 的 request/response body
- 收進：`docs/incidents/{YYYY-MM-DD}-liff-vs-web-divergence/`

---

## 場景 #14 — Safari iOS Private 模式

**風險覆蓋**：iOS Safari Private 對 localStorage / IndexedDB 配額極低（~7 day rolling delete），
W4 lazy-load 設 Firebase persistence 為 `browserLocalPersistence`（用 localStorage），
Private 模式可能直接拋 QuotaExceededError → Firebase init 失敗 → plugin 12s safetyTimer 兜底。

### 前置條件

- iPhone（任何 iOS 17+ 機型，Safari 為主）
- Safari → 標籤頁切換器右下「私密」進入 Private 模式
- prod URL（不能用 dev，dev 沒 Firebase config）

### 操作步驟

1. Private 模式新標籤頁 → 貼 prod 首頁 URL
2. 點「LINE 登入」按鈕 → LINE 授權 → redirect 回
3. 進 `/booking` → **手機橫向旋轉一次**（觸發 reload 行為等同效果）
4. Mac 端 Safari → 開發 → {iPhone 名稱} → 選此分頁
5. Console 過濾：`[StoreAuth]`、`setPersistence`、`QuotaExceeded`、`safetyTimer`
6. Application → Storage → 觀察 localStorage 是否真有寫入 `da_line_profile`、`firebase:authUser:*`

### 預期結果（degraded but functional）

- ✅ 12s 內 `/booking` 可進、不卡 splash 永久
- ✅ Console 若出現 `setPersistence(browserLocal) failed` 是預期的（Private 模式拋錯）→ Firebase fallback inMemory
- ✅ 整個 session 內可正常下單；**reload 後需重新登入是可接受的**（Private 不持久）
- ❌ 若 12s 後仍卡 splash → P0，立刻收集

### 失敗時收集

- Mac Safari Develop 連手機 Console 完整 log（含 Network）
- 截圖 `/booking` 卡住的畫面（含右上角時間戳，證明已超過 12s）
- 收進：`docs/incidents/{YYYY-MM-DD}-safari-private-stuck/`

---

## 跑完一輪後

- ✅ 全綠 → 在本檔末尾追加：`- {YYYY-MM-DD} Brain AI 跑過，4 場景全綠（commit hash {xxx}）`
- ⚠️ 任一場景紅 → 開 issue（label: `auth-regression`）+ 把 `docs/incidents/...` 路徑貼進 issue
- 不需要 Claude 動作 — 手動驗收結果由 Brain AI 自己消化

---

## 跑過紀錄

> 每次跑過追加一行

<!-- 範例：
- 2026-07-01 Brain AI 跑過，4 場景全綠（commit a1b2c3d）
- 2026-08-15 Brain AI 跑過，#14 Safari Private 12s 仍卡，已開 issue #234
-->

---

**版本紀錄**
- 版本：v1.0（auth e2e 矩陣 Tier C，配套 Tier A + Tier B 自動化 spec）
- 建立日期：2026-06-25
