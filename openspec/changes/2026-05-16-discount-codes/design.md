# 折扣碼（陽春版）設計文件

> 日期：2026-05-16
> 狀態：程式碼層已實作（branch `claude/keen-greider-d44135`），待部署 + firestore rules 部署 + prod 驗算
> 交接：實作計畫見 `docs/superpowers/plans/2026-05-16-discount-codes.md`。
> 已知限制：perUserLimit 於 transaction 內無法跨 collection 復查（陽春版可接受，見 `redeemDiscountCode` 註解）。

## 1. 目標與範圍

讓 admin 建立「固定金額折扣碼」，乘客於 booking 確認頁輸入後，從車資折抵固定金額。

### 範圍內（陽春版）

- 固定金額折扣（NT$ X），**不做百分比**
- 折扣碼有生效日 / 到期日
- 限用次數：全域總量上限 + 每人次數上限（兩者皆可留空 = 不限）
- 使用門檻：最低車資門檻 + 適用行程類型限定
- 一張訂單只能用一個碼，**不疊加**
- admin 在 `admin/settings` 新增「折扣碼」分頁做 CRUD（停用而非刪除）

### 非目標（明確排除，未來升級版才做）

- 百分比折扣、折抵上限
- 多碼疊加
- 綁定特定帳號的專屬碼 / 推薦碼
- 會員點數折抵（目前乘客累積統計是即時彙總，非點數制）
- 行銷活動檔期自動化
- admin 手動建單（`admin/orders` 新增訂單）套折扣碼 —— admin 直接打折後金額即可

## 2. 已拍板決策

| 決策 | 結論 |
|------|------|
| 折扣類型 | 只支援固定金額（NT$） |
| 限用次數 | 全域總量 + 每人次數，兩者皆可留空 = 不限 |
| 使用門檻 | 最低車資門檻 + 適用行程類型限定 |
| 管理 UI 位置 | `admin/settings` 新增第 7 個分頁 |
| 司機結算金額 | 用**折扣後**車資（`estimatedFare`）—— 不動司機統計邏輯 |
| 取消訂單 | 折扣次數**不釋放**（建立即計次，防「取消重訂」刷碼） |
| admin 手動建單 | **不支援**折扣碼 |
| 驗證架構 | 方案 B：獨立驗證端點（乘客預覽）+ 訂單建立時再驗一次，驗證邏輯抽共用 util |

## 3. 資料模型

### 3.1 新增 collection：`discount_codes`

doc id = 折扣碼字串（自動轉大寫，例 `WELCOME100`）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `code` | string | 折扣碼（= doc id，大寫） |
| `discountAmount` | number | 固定折抵金額（NT$），> 0 |
| `validFrom` | Timestamp \| null | 生效日；null = 立即生效 |
| `validUntil` | Timestamp | 到期日（必填） |
| `maxRedemptions` | number \| null | 全域總量上限；null = 不限 |
| `perUserLimit` | number \| null | 每人次數上限；null = 不限 |
| `minFare` | number \| null | 最低車資門檻（NT$）；null = 無門檻 |
| `allowedOrderTypes` | string[] \| null | 限定行程類型（值取自 ORDER_TYPES）；null 或空陣列 = 全部 |
| `enabled` | boolean | admin 開關；停用不刪碼 |
| `redemptionCount` | number | 已兌換總次數（running counter，預設 0） |
| `createdBy` | string | 建立者 lineUid |
| `createdAt` | Timestamp | |
| `updatedBy` | string | 最後更新者 lineUid |
| `updatedAt` | Timestamp | |

### 3.2 `orders` doc 新增欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `discountCode` | string \| null | 套用的折扣碼；無折扣 = null |
| `discountAmount` | number | 實際折抵金額（NT$）；無折扣 = 0 |
| `fareBeforeDiscount` | number | 折扣前車資 |

> `estimatedFare` 維持為**折扣後最終車資**（乘客實付）。如此 admin 訂單列表、乘客累積消費統計（`passengers/me/stats`）、司機結算、訂單明細全部沿用既有邏輯不必改。

### 3.3 Firestore rules

`discount_codes` collection 全面禁止 client 直接讀寫（折扣碼為機密資料，僅透過 server admin SDK 驗證存取）。rules 部署後生效。

## 4. 驗證邏輯（共用 util）

新檔 `server/utils/discount-code.ts`：

```
validateDiscountCode(db, { code, fare, orderType, userId })
  → { ok: true, discountAmount: number }
  | { ok: false, reason: { zh_tw, en, ja } }
```

逐項檢查（任一失敗即回對應三語訊息）：

1. `NOT_FOUND` — 碼不存在
2. `DISABLED` — `enabled === false`
3. `NOT_STARTED` — 現在時間 < `validFrom`
4. `EXPIRED` — 現在時間 > `validUntil`
5. `ORDER_TYPE_NOT_ALLOWED` — `allowedOrderTypes` 非空且不含此 `orderType`
6. `BELOW_MIN_FARE` — `minFare` 有值且 `fare < minFare`
7. `GLOBAL_LIMIT_REACHED` — `maxRedemptions` 有值且 `redemptionCount >= maxRedemptions`
8. `PER_USER_LIMIT_REACHED` — `perUserLimit` 有值且該使用者已用次數 `>= perUserLimit`

通過後 `discountAmount = min(code.discountAmount, fare)`（折後車資不為負，最低歸 0）。

**每人已用次數計算**：查 `orders` collection `where userId == uid`，client 端 filter `discountCode === code` 計數（避免建立 composite index —— 與 `orders/index.post.ts` 既有 ACTIVE_ORDER_LIMIT 作法一致）。已取消的訂單**仍計入**（取消不釋放）。

## 5. 後端端點

| 端點 | 用途 | 權限 |
|------|------|------|
| `POST /nuxt-api/discount-codes/validate` | 乘客輸碼即時預覽折抵 | 登入乘客 |
| `GET /nuxt-api/admin/discount-codes` | admin 列出所有折扣碼 | canManageOrders |
| `POST /nuxt-api/admin/discount-codes` | admin 建立折扣碼 | canManageOrders |
| `PUT /nuxt-api/admin/discount-codes/[code]` | admin 更新折扣碼 / 切換 enabled | canManageOrders |

**新檔**：
- `server/routes/nuxt-api/discount-codes/validate.post.ts`
- `server/routes/nuxt-api/admin/discount-codes/index.get.ts`
- `server/routes/nuxt-api/admin/discount-codes/index.post.ts`
- `server/routes/nuxt-api/admin/discount-codes/[code].put.ts`

`validate.post.ts`：登入即可，body 帶 `{ code, fare, orderType }`，回 `validateDiscountCode` 結果（成功回 `discountAmount`，失敗回 reason）。

admin 端點：`canManageOrders` 權限；建立時校驗 `discountAmount > 0`、`validUntil` 必填且為合法日期、`maxRedemptions`/`perUserLimit`/`minFare` 若有值須為非負、`allowedOrderTypes` 值須在 ORDER_TYPES 內；code 轉大寫；建立時 `redemptionCount = 0`。

### 5.1 訂單建立整合（修改 `orders/index.post.ts`）

`CreateOrderBody` 新增 optional `discountCode?: string`。流程：

1. 算完車資（既有 Fare V2 流程）得 `fareBeforeDiscount`
2. 若無 `discountCode` → `discountAmount = 0`、`estimatedFare = fareBeforeDiscount`，照舊
3. 若有 `discountCode`：
   a. 呼叫 `validateDiscountCode`（傳 `fareBeforeDiscount` 當 fare）
   b. 驗證失敗 → 回 `badRequestError`（reason 三語）。前端已預覽過，正常不會走到
   c. 驗證成功 → 用 **Firestore transaction** 在該 code doc 上：再次檢查 `enabled`/時間區間/`maxRedemptions`，通過則 `redemptionCount` +1
   d. `discountAmount` = 驗證回傳值；`estimatedFare = fareBeforeDiscount - discountAmount`
4. 訂單 doc 寫入 `discountCode` / `discountAmount` / `fareBeforeDiscount`

> 計次與訂單寫入非單一交易：先做 redemptionCount transaction，再寫訂單。若訂單寫入失敗，counter 可能多算 1（保守方向，非金流漏洞），陽春版可接受。

### 5.2 稽核

`server/utils/audit-log.ts`：
- `AuditAction` 新增 `discount_code.create`、`discount_code.update`
- `AuditTargetType` 新增 `discount_code`

admin 建立 / 更新折扣碼時寫 audit log。

## 6. 前端

### 6.1 乘客端 — booking 確認頁

修改 `app/components/passenger/BookingStepConfirm.vue`：
- 聯絡資訊區下方新增「折扣碼」欄位 + 「套用」按鈕
- 按「套用」→ 呼叫 validate 端點（帶 code + 當前車資 + orderType）→ 顯示「✓ 折抵 −NT$X」或失敗訊息
- 套用成功後，確認卡車資區多一行「折扣 −NT$X」與「折後總額」
- 可清除已套用的碼重輸
- 送出訂單時 `CreateOrderParams` 帶 `discountCode`

修改 `app/pages/booking/index.vue`：draft / submit 流程帶上 `discountCode`。

折扣顯示可放在確認卡內新增一列，或 `FareBreakdownCard.vue` 加一行 —— 實作時擇一，以確認卡內顯示為優先（改動較小）。

### 6.2 admin 端 — settings 第 7 分頁

修改 `app/pages/admin/settings/index.vue`：`MAIN_TABS` 新增 `{ key: 'promotions', label: '折扣碼' }`，對應區塊 `v-show="mainTab === 'promotions'"`。

新元件 `app/components/admin/SettingsDiscountCodes.vue`（比照 `SettingsLegalDocuments.vue` 模式）：
- 折扣碼列表：碼 / 折抵金額 / 期限 / 已用次數（`redemptionCount` / `maxRedemptions`）/ 啟用狀態
- 建立 / 編輯表單：碼、折抵金額、生效日、到期日、全域總量上限、每人次數上限、最低車資門檻、適用行程類型（多選）、啟用開關
- 停用 = 切 `enabled=false`，不提供刪除

### 6.3 API protocol

- `app/protocol/fetch-api/api/order/type.d.ts`：`CreateOrderParams` 新增 `discountCode?: string`
- `app/protocol/fetch-api/api/order/index.ts`：新增 `ValidateDiscountCode` 函式（打 validate 端點）
- 新增 admin sub-module `app/protocol/fetch-api/api/admin/discount-code/`（`index.ts` + `type.d.ts`），於 `api/admin/index.ts` re-export，提供 `GetDiscountCodes` / `CreateDiscountCode` / `UpdateDiscountCode`

## 7. i18n

`i18n/locales/zh.js` / `en.js` / `ja.js` 補：
- booking 折扣碼 UI 字串（欄位 label、placeholder、「套用」、「折抵」、折後總額等）
- 各驗證失敗訊息（NOT_FOUND / DISABLED / NOT_STARTED / EXPIRED / ORDER_TYPE_NOT_ALLOWED / BELOW_MIN_FARE / GLOBAL_LIMIT_REACHED / PER_USER_LIMIT_REACHED）

> 後端驗證 reason 直接回三語物件；前端 admin / server 錯誤訊息維持專案既有三語慣例。`en.js` / `ja.js` 結構須與 `zh.js` 對齊。

## 8. 建議實作順序

1. 資料模型確立 + `firestore.rules` 加 `discount_codes` 鎖定
2. `server/utils/discount-code.ts` 驗證 util + audit action 擴充
3. admin CRUD 三支端點 + protocol sub-module
4. `admin/settings` 第 7 分頁 + `SettingsDiscountCodes.vue`（admin 可先建碼）
5. `discount-codes/validate.post.ts` 驗證端點 + protocol
6. `orders/index.post.ts` 整合（套折扣 + redemptionCount transaction）
7. `BookingStepConfirm.vue` + `booking/index.vue` 前端整合
8. i18n 三語補齊
9. lint + build 驗證 → 部署 → firestore rules 部署

## 9. 影響檔案總覽

**新增：**
- `server/utils/discount-code.ts`
- `server/routes/nuxt-api/discount-codes/validate.post.ts`
- `server/routes/nuxt-api/admin/discount-codes/index.get.ts`
- `server/routes/nuxt-api/admin/discount-codes/index.post.ts`
- `server/routes/nuxt-api/admin/discount-codes/[code].put.ts`
- `app/components/admin/SettingsDiscountCodes.vue`
- `app/protocol/fetch-api/api/admin/discount-code/index.ts`
- `app/protocol/fetch-api/api/admin/discount-code/type.d.ts`

**修改：**
- `server/routes/nuxt-api/orders/index.post.ts`
- `server/utils/audit-log.ts`
- `app/pages/admin/settings/index.vue`
- `app/components/passenger/BookingStepConfirm.vue`
- `app/pages/booking/index.vue`
- `app/protocol/fetch-api/api/order/type.d.ts`
- `app/protocol/fetch-api/api/order/index.ts`
- `app/protocol/fetch-api/api/admin/index.ts`
- `i18n/locales/zh.js`、`en.js`、`ja.js`
- `firestore.rules`
