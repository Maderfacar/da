# 推薦獎勵機制 任務拆解

> 依 design.md 實作。每個 Phase 為一個可獨立 commit 的單位。
> 每 Phase 完成後：worktree `pnpm install`（首次）→ `pnpm lint` + `pnpm build` 驗證 → commit → 推 prod。
> Phase 1、2 動到 firestore.rules 與防刷邏輯，務必驗證後再推。

## Phase 1 — 資料模型 + 鑄碼基礎

- [ ] `server/utils/referral.ts` 🆕：`generateReferralCode()`（6 碼大寫英數）、唯一性檢查 helper。
- [ ] `auth/line-exchange.post.ts`：首次建立 `users` doc 時產生並寫入 `referralCode`；既有 user 缺 `referralCode` 時補寫（lazy backfill）。
- [ ] `users` schema：新增 `referredBy`(null) / `welcomeRewardClaimed`(false) 欄位（寫入點在 Phase 2，這裡僅確立型別/預設）。
- [ ] `referral_campaign/config` doc：建立 + 寫入 §3.3 預設值（可寫一支 migration 或 admin PUT 首次建立）。
- [ ] `discount_codes` 擴充：`source` / `ownerUid` 兩欄（`toDiscountCodeDto` 等同步）。
- [ ] `server/utils/discount-code.ts`：新增 `mintDiscountCode(db, opts)` —— 隨機碼（前綴 + 8 碼，碰撞重試 5 次）、寫 `discount_codes`（`maxRedemptions:1` + `source`/`ownerUid`/`validUntil`/`minFare`/`discountAmount`）。
- [ ] `firestore.rules`：`referrals/**`、`referral_campaign/**` client 全禁；`users` 新欄位 client 不可寫。
- [ ] 驗證：lint + build + rules validate。

## Phase 2 — 歸因與資格判定（核心，最需小心）

- [x] `POST /nuxt-api/referral/bind` 🆕：body `{ ref }`，執行 design.md §5 防刷六項檢查 → transaction 寫 `referredBy` + 建 `referrals/{referee}` + `mintDiscountCode` 歡迎碼 + `welcomeRewardClaimed=true`。
- [x] ref 落地捕捉：乘客端進入時若 URL 帶 `?ref=`，導向／呼叫 `/referral/bind`（落地頁或 global middleware；未登入則登入後再 bind）。
- [x] `orders/[orderId].patch.ts`：status→`completed` 後加 hook —— 查 `referrals/{order.userId}` 為 `pending` 且此為該 user 首筆 completed → 轉 `qualified`/`rewarded`、`mintDiscountCode` 推薦獎勵碼（`ownerUid=referrerUid`）、寫 `rewardCodeId`。
- [x] LINE 推播 2 則（`server/utils/line-push.ts`）：被推薦人歡迎碼、推薦人獎勵碼（fire-and-forget）。
- [x] pending lazy 過期邏輯（共用 helper：`pending && expiresAt<now` → 視為 expired）。
- [x] 單元測試：防刷檢查、`mintDiscountCode` 碰撞重試、資格判定純函式。
- [x] 驗證：lint + build。

## Phase 3 — 乘客端 UI

- [ ] `GET /nuxt-api/referral/me` 🆕：回 referralCode、推薦進度（pending/rewarded 數）、未用折扣碼清單（查 `discount_codes where ownerUid==me`）。
- [ ] LIFF 分享頁 🆕：`liff.shareTargetPicker()` 組裝活動 Flex（帶 `?ref=<我的 referralCode>`）；處理 `isApiAvailable` fallback。
- [ ] 完成行程後「分享提示卡」（C4 ②）：訂單完成後於 app 內（訂單詳情/歷史訂單）顯示提示卡 + 開分享頁按鈕。
- [ ] 歷史訂單頁「我的折扣碼/推薦進度」區塊（C4 ③）：顯示 referralCode、邀請進度、未用折扣碼。
- [ ] `store-auth`：載入/暴露 `referralCode`。
- [ ] 驗證：lint + build。

## Phase 4 — admin 端

- [ ] `GET` / `PUT /nuxt-api/admin/referral-campaign` 🆕：讀寫活動設定（含 `shareCard` Flex 內容、kill-switch、獎勵參數）。
- [ ] admin 推薦活動設定頁：Flex 卡編輯（沿用既有 Flex/範本編輯 UI 元件）+ 獎勵參數表單 + on/off。
- [ ] `GET /nuxt-api/admin/referral-records` 🆕：列 `referrals`，每列計算 referrer 的 rewarded 數，超 `anomalyThreshold` 標記 anomaly flag。
- [ ] admin 推薦紀錄檢視頁：列表 + 異常列**紅字**標示。
- [ ] 驗證：lint + build。

## Phase 5 — 收尾

- [ ] i18n 三語（zh/en/ja）：所有新字串（含歡迎/獎勵推播文案、提示卡、admin UI、bind 失敗訊息）。
- [ ] `firestore.rules` 最終檢查 + deploy。
- [ ] E2E：分享 → bind → 歡迎碼 → 完成首單 → 推薦碼 關鍵流程。
- [ ] `referral_campaign/config` 上 prod 初始化（預設 `enabled=false`，admin 設定好再開）。
- [ ] 最終 build 驗證 + 部署。

## 待辦／已知限制

- pending 過期採 lazy，不做排程（v2 可加 scheduled function）。
- 無全域預算上限，僅 kill-switch（v2 可加）。
- 防刷無法擋「真人小號 + 真的下單付費」—— 經濟成本已足夠嚇阻折扣碼級獎勵（可接受）。
