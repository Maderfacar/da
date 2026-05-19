# 推薦獎勵機制 設計文件

> 日期：2026-05-20
> 狀態：規格定案，待實作（5 Phase）
> 前置討論：proposal.md。所有決策已由 Brain AI 拍板（見下表）。

## 1. 目標與範圍

老用戶完成行程後分享活動卡 → 好友透過推薦連結進入平台 → 好友拿歡迎碼下首單 → 好友完成行程 → 推薦人拿推薦獎勵碼。形成 referee 自己也能變 referrer 的擴散鏈。

### 範圍內
- 兩種動態鑄造的隨機單次折扣碼：歡迎碼、推薦獎勵碼。
- 推薦歸因（referralCode + referredBy write-once + referrals 帳本）。
- 防刷：被推薦人須全新帳號、ref≠自己、推薦獎勵掛「完成首筆行程」。
- admin 推薦活動設定（Flex 卡編輯 + 獎勵參數 + kill-switch）+ 推薦紀錄檢視。
- 完成行程後的分享提示卡；歷史訂單頁「我的折扣碼/推薦進度」區塊。
- 推薦人/新人各 1 則 LINE 推播。

### 非目標（v2 才考慮）
- 里程碑加碼（邀第 3/5/10 位額外送）。
- richmenu 常駐入口。
- 全域預算上限（本版僅 kill-switch；D2）。
- 排程式 pending 過期（本版採 lazy 過期）。
- 百分比折扣、多碼疊加（沿用折扣碼陽春版限制）。

## 2. 已拍板決策

| 決策 | 結論 |
|------|------|
| 推薦人合格門檻 | 被推薦人**完成首筆行程**（付款為到付，建立訂單零成本可刷，門檻無法放寬）|
| 歡迎碼發放時機 | 被推薦人綁定 referredBy 當下立即發（須能折在其首單）|
| 歡迎碼發放對象 | 僅「被推薦進來的新人」；既有用戶、無 ref 自然進來的新用戶不發 |
| 歡迎碼次數 | 一帳號一次（`welcomeRewardClaimed`）|
| 推薦獎勵碼次數 | 可重複，每位合格新人一張，無硬上限 |
| 金額 | 歡迎碼 NT$150、推薦獎勵碼 NT$150（雙邊對稱，admin 可調）|
| 效期 | 歡迎碼 90 天、推薦獎勵碼 60 天 |
| minFare | NT$500（兩碼皆設，避免短程單被折到趨近免費）|
| pending TTL | 30 天未完成首單 → expired |
| 預算上限 | 不設，僅 admin kill-switch 開關 |
| 異常偵測 | 單人推薦數軟門檻（預設 50），不強制擋；超過 → admin 推薦紀錄頁紅字標示 |
| 分享對象 | 對全體用戶開放（非僅新用戶）|
| 入口 | 完成行程後提示卡 + 歷史訂單頁「我的折扣碼/推薦進度」區塊（無 richmenu）|

## 3. 資料模型

### 3.1 `users/{lineUid}` 新增欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `referralCode` | string | 自己的推薦碼，6 碼大寫英數，全 users 唯一；首次建立 user doc 時產生 |
| `referredBy` | string \| null | 帶他進來的推薦人 lineUid；**write-once**，預設 null |
| `welcomeRewardClaimed` | boolean | 是否已領歡迎碼；預設 false |

### 3.2 新增 collection `referrals/{refereeUid}`

> doc id = 被推薦人 lineUid —— 天然保證「一個被推薦人只能有一筆推薦紀錄」。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `referrerUid` | string | 推薦人 lineUid |
| `refereeUid` | string | 被推薦人 lineUid（= doc id）|
| `referrerCode` | string | 綁定時使用的 referralCode |
| `status` | string | `pending` → `qualified` → `rewarded`；或 `expired` |
| `welcomeCodeId` | string \| null | 發給被推薦人的歡迎碼 doc id |
| `rewardCodeId` | string \| null | 發給推薦人的推薦獎勵碼 doc id（qualified 後寫入）|
| `createdAt` | Timestamp | 綁定時間 |
| `qualifiedAt` | Timestamp \| null | 被推薦人完成首單時間 |
| `expiresAt` | Timestamp | createdAt + 30 天；pending 超過即視為 expired |

### 3.3 新增 doc `referral_campaign/config`（單一設定 doc）

| 欄位 | 型別 | 預設 |
|------|------|------|
| `enabled` | boolean | false（admin 開啟才生效）|
| `welcomeAmount` | number | 150 |
| `rewardAmount` | number | 150 |
| `welcomeValidityDays` | number | 90 |
| `rewardValidityDays` | number | 60 |
| `minFare` | number | 500 |
| `pendingTtlDays` | number | 30 |
| `anomalyThreshold` | number | 50 |
| `shareCard` | object | 分享 Flex 卡內容（title / imageUrl / body / ctaLabel）|

### 3.4 `discount_codes/{CODE}` 擴充

沿用既有 schema，新增 2 個 optional 欄位（既有 admin 碼不受影響）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `source` | string | `'admin'`（預設）/ `'referral-welcome'` / `'referral-reward'` |
| `ownerUid` | string \| null | 鑄碼歸屬的使用者 lineUid（referral 碼有值，admin 碼為 null）|

`ownerUid` 讓「我的折扣碼」可經 server endpoint 查詢。

## 4. 流程時序

```
① 老用戶完成行程
   orders/[orderId].patch → status=completed
   → 回傳/推播觸發「分享提示卡」（C4 ②）

② 老用戶開分享頁 → liff.shareTargetPicker() 送活動 Flex
   Flex CTA 連結帶 ?ref=<該用戶 referralCode>

③ 好友點連結 → LIFF 落地頁（auth 後）→ POST /referral/bind { ref }
   server 防刷檢查（見 §5）通過：
   - users/{referee}.referredBy = referrerUid（write-once，transaction）
   - users/{referee}.welcomeRewardClaimed = true
   - 鑄歡迎碼 → discount_codes/{WLCxxxx}
   - 建 referrals/{referee}（status=pending, expiresAt=+30d）
   - LINE 推播被推薦人：「歡迎，新人碼 WLCxxxx」

④ 好友用歡迎碼下首單 → 完成行程
   orders/[orderId].patch → status=completed hook：
   - 若 referrals/{userId} 存在且 status=pending
   - 且這是該使用者「第一筆 completed 訂單」
   → status=qualified, qualifiedAt=now
   → 鑄推薦獎勵碼 → discount_codes/{RWDxxxx}（ownerUid=referrerUid）
   → referrals.rewardCodeId 寫入, status=rewarded
   → LINE 推播推薦人：「朋友完成首趟，獎勵碼 RWDxxxx」

⑤ 好友現在有自己的 referralCode → 回到 ② 形成鏈
```

## 5. 防刷規則（POST /referral/bind 內）

逐項檢查，任一失敗即拒：

1. 活動 `enabled` 為 true（kill-switch）。
2. `ref` 對應的 referralCode 存在 → 取得 referrerUid。
3. `referrerUid ≠ refereeUid`（不可推薦自己）。
4. `users/{referee}.referredBy` 為 null（write-once；已綁定者拒絕）。
5. 被推薦人為**全新帳號**：`orders` 中無任何該 userId 的訂單（已有訂單 = 既有客，不算被推薦進來）。
6. 通過後所有寫入以 transaction 包覆（referredBy 競態保護）。

> 異常偵測（D3）：不在此擋，於 admin 推薦紀錄頁計算「referrerUid 的 rewarded 數」，超過 `anomalyThreshold` 該列紅字。

## 6. Endpoint 介面

| Method/Path | 用途 | 權限 |
|---|---|---|
| `POST /nuxt-api/referral/bind` | body `{ ref }`；綁定 + 發歡迎碼 | require-auth（乘客）|
| `GET /nuxt-api/referral/me` | 回自己的 referralCode、推薦進度（pending/rewarded 數）、未用折扣碼清單 | require-auth |
| `GET /nuxt-api/admin/referral-campaign` | 讀活動設定 | canManageFleet（或新權限）|
| `PUT /nuxt-api/admin/referral-campaign` | 改活動設定（含 shareCard）| 同上 |
| `GET /nuxt-api/admin/referral-records` | 推薦紀錄列表（含 anomaly flag）| 同上 |

資格判定**非** endpoint —— 是 `orders/[orderId].patch.ts` 內 status→completed 後的 hook。

鑄碼共用 `server/utils/discount-code.ts` 新增 `mintDiscountCode(db, opts)`：產生隨機碼（前綴 `WLC`/`RWD` + 8 碼隨機英數，碰撞重試）、寫 `discount_codes`（`maxRedemptions:1`、帶 `source`/`ownerUid`/`validUntil`/`minFare`）。

## 7. firestore.rules 變更

- `referrals/**`：client 全禁讀寫（一律經 server admin SDK）。
- `referral_campaign/**`：client 全禁讀寫。
- `discount_codes/**`：維持 client 全禁（已是）。
- `users/{uid}`：`referredBy` / `welcomeRewardClaimed` / `referralCode` 禁止 client 寫（沿用 users 既有的 client 不可寫敏感欄位規則；referralCode 可允許 client 讀自己的）。

## 8. 邊界情況 / 失敗降級

- 活動 `enabled=false`：`/referral/bind` 直接拒；分享提示卡不顯示。
- 被推薦人首單**取消**：不算 completed → 不觸發 qualify；referral 維持 pending 直到 expiresAt。
- pending 過期：採 **lazy** —— `/referral/me` 與 admin 紀錄頁讀取時，`status=pending && expiresAt<now` 視為 `expired`（可順手寫回）。不做排程。
- 鑄碼碰撞：`mintDiscountCode` 偵測 doc 已存在則重新產生（最多重試 5 次）。
- LINE 推播失敗：fire-and-forget，不影響主流程（沿用 line-push 既有行為）。
- 被推薦人已是既有用戶（有訂單）誤點 ref：§5.5 擋下，回明確訊息「此優惠僅限新加入的好友」。
