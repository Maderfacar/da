# 推薦獎勵機制（分享得折扣 / Referral）

## Why

目前乘客端**沒有任何拉新／裂變機制**。現有折扣碼（`2026-05-16-discount-codes`）是 admin 手動建立的固定字串，誰知道誰就能用 —— 拿來當「分享獎勵」會因外流而失效。

需求：新使用者把活動卡片分享給好友，當好友真的進來並消費，雙方各得一組**不會外流、用一次就失效**的折扣碼，形成 referee → 自己也變 referrer 的擴散鏈。

## What Changes

### 機制總覽

採「**推薦歸因型 + 每人專屬單次碼**」：

- **不靠**偵測「有沒有按分享」（前端不可信），改靠「**有沒有新使用者透過你的推薦連結進來並消費**」歸因。
- 兩種折扣碼，皆為動態產生的隨機單次碼（`maxRedemptions:1`）：
  - **歡迎碼** — 發給被推薦的新人，每帳號限 1 次（`welcomeRewardClaimed` 旗標擋）。
  - **推薦獎勵碼** — 發給推薦人，每成功帶進一位合格新人發一組，每人上限 10 組。
- 推薦識別用每位使用者一組不可逆的隨機 **`referralCode`**（如 `K7M2QX`），**不用原始 lineUid**（避免外洩 LINE userId）。

### 資料模型（概述；完整 schema 見 design.md）

- `users/{uid}` 新增三欄位：`referralCode`（首登入產生）、`referredBy`（誰帶他進來，**write-once 不可改**）、`welcomeRewardClaimed`。
- 新增 collection `referrals/{id}` 當帳本：`referrerUid` / `refereeUid` / `status`（`pending`→`qualified`→`rewarded`／`expired`）/ `createdAt` / `qualifiedAt` / `rewardCodeId`。
- 沿用 `discount_codes` collection 與既有 `validateDiscountCode` / `redeemDiscountCode` 兌換邏輯；新增「動態鑄碼」函式（隨機碼、單次、帶效期/minFare）。

### 推薦生命週期

```
1. 推薦人分享含 ?ref=<referralCode> 的活動卡片
2. 新好友點連結 → LIFF 落地頁讀 ref + liff.getProfile()
3. 驗證（全新帳號 / ref≠自己 / referredBy 尚未綁定）→ 綁 referredBy → 建 referrals(pending)
   → 發歡迎碼給新人
4. 新人完成首筆訂單 → referrals 轉 qualified → 鑄推薦獎勵碼給推薦人 → 轉 rewarded
5.（pending 超過 TTL 未消費 → 轉 expired）
```

### 防刷核心

- 被推薦人必須是**全新帳號**（無既有 `users` doc／無歷史訂單）。
- `ref ≠ 自己`；`referredBy` 寫一次鎖死（第一個 ref 勝）。
- 推薦獎勵碼觸發點掛在「**被推薦人完成首筆訂單**」（見〈待拍板〉#1）—— 刷一個假推薦＝要真的下一筆單，對折扣碼級獎勵不划算。
- 推薦人每人上限 10 組；活動有全域預算上限與 admin kill-switch。

### admin 端

- 新增「**推薦活動**」設定（獨立 entity，**不**塞進現有 5 個訂單事件範本）：分享卡片 Flex 編輯（沿用既有 Flex/範本編輯 UI）＋ 獎勵參數（歡迎碼/推薦碼金額、效期、minFare）＋ on/off ＋ 全域預算上限。
- 「推薦紀錄」檢視（讀 `referrals` 帳本，可人工作廢可疑紀錄）。
- 2 則 LINE 推播訊息：給推薦人的「朋友加入了，獎勵碼 XXX」、給新人的「歡迎，新人碼 XXX」。

### 乘客端

- LIFF 分享頁：`liff.shareTargetPicker()` 帶活動 Flex（內含 `?ref=`）。
- `ref` 落地綁定頁／middleware。
- 「我的推薦與折扣碼」顯示（併入歷史訂單頁或新區塊）：自己的 referralCode、邀請進度（pending / 已成行）、未用折扣碼。

## Impact

### Affected code

| 檔案 | 動作 |
|---|---|
| `server/utils/referral.ts` | 🆕 referralCode 產生、ref 綁定、資格判定、防刷檢查 |
| `server/utils/discount-code.ts` | 擴充：動態鑄碼（隨機碼 + 單次 + 效期）|
| `server/routes/nuxt-api/referral/*` | 🆕 bind / my-referrals / claim 等 endpoint |
| `server/routes/nuxt-api/admin/referral-campaign/*` | 🆕 GET/PUT 活動設定 |
| `server/routes/nuxt-api/admin/referral-records/*` | 🆕 推薦紀錄列表 + 作廢 |
| `server/routes/nuxt-api/auth/line-exchange.post.ts` | 首次建 user 時產生 `referralCode` |
| `server/routes/nuxt-api/orders/[orderId].patch.ts` | hook：狀態轉 completed 時觸發推薦資格判定 |
| `server/utils/line-push.ts` | 推薦人 / 新人 2 則推播 |
| `app/pages/referral/*`（或 LIFF 分享頁） | 🆕 分享頁 + ref 落地頁 |
| `app/pages/orders/index.vue` | 新增「我的推薦／折扣碼」區塊 |
| `app/pages/admin/...`（settings 分頁或新頁） | 🆕 推薦活動設定 + 紀錄檢視 |
| `app/stores/5.store-auth.ts` | 載入 / 暴露 `referralCode` |
| `firestore.rules` | `referrals` 規則、`users` 新欄位規則 |
| `i18n/locales/{zh,en,ja}.js` | 新字串三語 |

### 不影響

- 既有折扣碼 admin CRUD、booking 兌換流程不改（只擴充鑄碼）。
- 現有 5 個訂單事件通知範本不動。
- 司機端、admin 訂單管理不動。

## 工作量 / Phase 拆解

中大型功能，建議分 5 個 Phase：

| Phase | 內容 | 風險／成本 |
|---|---|---|
| 1 | 資料模型：`referralCode` / `referredBy` / `referrals` collection + 動態鑄碼 + rules | 中 |
| 2 | 歸因與資格判定：ref 落地綁定、首單完成 hook、發獎勵碼、防刷檢查 | 中高（correctness 最關鍵）|
| 3 | 乘客端：LIFF 分享頁、ref 落地頁、「我的推薦／折扣碼」 | 中 |
| 4 | admin 端：推薦活動設定（Flex 編輯 + 獎勵參數）、推薦紀錄檢視 | 中（Flex 編輯有現成基礎，較便宜）|
| 5 | LINE 推播 2 則、i18n 三語、測試 | 中 |

## 待 Brain AI 拍板

### #1（最關鍵）推薦獎勵的「合格門檻」

「被推薦人完成首筆訂單(completed)」防刷最強，但你擔心轉換門檻太高、扼殺裂變。

**建議：門檻仍設「完成首筆訂單」，但搭配三項配套化解阻力 ——**
- (A) 被推薦人一綁定即建 `pending` 並讓推薦人**看到邀請進度**（「已邀請 3 人・待成行 1 人」）→ 即時心理回饋、零發碼風險。
- (B) **歡迎碼要夠有感** —— 這才是推動新人下單的引擎；新人轉換率高，推薦碼自然常觸發。裂變動力來自「歡迎碼香 + 一鍵分享 + 新人也能立刻變推薦人」，不是 10 次上限。
- (C) 若評估後仍嫌慢，可降到「**首筆訂單建立**」當折衷。

> **此決策取決於一個前提問題：本專案訂單是否需要預先付款？**
> - 若為現場付司機／到付 → 「建立訂單」幾乎零成本可刷，門檻**必須**是「完成行程」。
> - 若 booking 階段即收款 → 「訂單建立（已付款）」即可當門檻，可大幅降低裂變阻力。
>
> 請先確認付款模式，再定 #1。

### #2 Stage-A 是否給小獎勵

被推薦人綁定（尚未消費）時，推薦人除了「看到進度」外是否再給小獎勵？
**建議：只給進度顯示、不給可用碼** —— 任何「綁定即得的可用碼」都可被小號刷。若要 Stage-A 獎勵，採非貨幣形式（如抽獎券）。

### #3 pending 推薦 TTL

被推薦人綁定後多久未完成首單則 `pending`→`expired`。**建議 30–60 天**（釋放帳本 + 製造急迫感）。

### #4 全域預算上限 / kill-switch

活動可設「最多發 N 組碼」與 admin 開關。**建議必做**，防活動失控。

### #5 其他建議（可選，列入考量）

- 推薦獎勵**階梯式**：第 1–3 位金額小、4–10 位大 → 鼓勵推到上限。
- 歡迎碼設效期（14–30 天）製造急迫感，間接加速推薦碼觸發。
- 被推薦人首單若取消 → 不算 qualified（completed 才算）。
- `referralCode` 用不可逆隨機碼，不用 lineUid（隱私）。
