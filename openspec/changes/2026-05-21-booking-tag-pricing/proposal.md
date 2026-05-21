# Phase 1D — Booking 偏好標籤勾選 + 加價邏輯（2026-05-21）

> 整體計畫第 4 phase。前置：1A taxonomy / 1B vehicle profile / 1C public page 已完成。
> 本 phase 把標籤接到 booking 流程：**乘客勾喜好 → 即時試算加價 → 鎖價建單**。

## Why

1A 建好 taxonomy，1B 司機可掛標籤、admin 可審核，1C 乘客可看公開檔案頁。但 booking 流程**還沒接到標籤** — 乘客下單時：
- 不能勾喜好（純電 / 航空椅）
- 不會被加價
- 訂單沒記偏好快照

這個 phase 把標籤體系真的「賺到錢」 — 並且為 Phase 1E（配對）準備好「乘客要什麼」的 input。

## What Changes

### 機制總覽

1. Booking 頁加「期望特徵」section（預設摺疊；點開展開全部群組）
2. 只顯示 **vehicle-scope** 且 `status==='active'` 的標籤（不顯示 driver-scope；driver-scope 屬於配對後加值，不影響定價）
3. 群組互斥規則沿用 1A taxonomy：`power`/`vehicleType`/`origin` 單選；`interior`/`equipment` 多選
4. 即時試算加價：**`tagSurcharge = max(乘客勾選命中的 tag.surchargeAmount)`**（取 max 而非 sum）
5. Booking 頁 fare summary 多一行 `+ NT$ XXX 喜好標籤加價`，可展開明細
6. 確認下單時把 preferences 寫入 order doc（含 tag snapshot：id / name / surchargeAmount / group）→ **訂單建立後即使 admin 改 tag.surchargeAmount，舊訂單不變**
7. Final price = base_fare（fare V2 既有計算結果）+ tagSurcharge - discountAmount

### 計價公式（鎖定版本）

```
final_total = base_fare + tag_surcharge - discount_amount
   where
     base_fare       = fare V2 計算（既有，不動）
     tag_surcharge   = preferences.tagIds 非空 ? max(snapshot.surchargeAmount) : 0
     discount_amount = 折扣碼套用結果（既有）
```

**重要**：tag_surcharge **取 max 而非 sum**（拍版 #1，原 21 盲區）— 多選 nice-to-have 標籤，只收最高那個的加價，其餘附贈。

## 12 個決策

| # | 議題 | 拍版 |
|---|---|---|
| 1 | 加價計算 | `max(selected_tag_surcharges)`，多選一律取最高 |
| 2 | 加價依據 | 依**乘客勾選**的 tagIds，非車輛擁有的 tagIds（拍版 #1）|
| 3 | 顯示哪些標籤 | active + scope==='vehicle'（driver-scope 不顯示） |
| 4 | 群組互斥 | 沿用 1A TAG_GROUPS multiplicity |
| 5 | 沒勾任何標籤 | tagSurcharge = 0，UI 不顯示「喜好標籤加價」行 |
| 6 | 報價時點 | Booking 頁即時試算 + 確認下單時鎖定（snapshot） |
| 7 | 訂單建立後標籤改價 | 舊訂單不變（snapshot 機制） |
| 8 | UI 預設展開或摺疊 | **預設摺疊**（避免 booking 頁太長）；點「+ 加入期望特徵」展開 |
| 9 | 乘客端 i18n | 必三語完整 |
| 10 | TagGroupPicker 是否複用 | **新建 PassengerTagPreferencePicker**（不複用 1B driver 版，邏輯/樣式都不同） |
| 11 | 訂單 schema 變動 | 加 top-level `preferences` 欄位 |
| 12 | 折扣碼是否套用至 tagSurcharge | 折扣碼套用對象是 `base_fare + tag_surcharge`（既有 minFare 判斷邏輯仍用 base_fare）|

## Impact

### Affected code (Phase 1D only)

| 檔案 | 動作 |
|---|---|
| `shared/pricing.ts` | 改：加 `calcTagSurcharge(selectedTagIds, tagsIndex)` + `applyTagSurchargeToFare(fareResult, tagSurcharge)` |
| `shared/pricing.spec.ts` | 改：加 5+ case 覆蓋 max 邏輯、空集合、未知 id |
| `shared/orderPreferences.ts` | 🆕 `OrderPreferencesInput` / `OrderPreferencesSnapshot` types + `buildPreferencesSnapshot(tagIds, tagsCache)` helper |
| `shared/orderPreferences.spec.ts` | 🆕 |
| `server/routes/nuxt-api/orders/index.post.ts` | 改：接 `preferences.tagIds` → 後端 re-validate（tag exist / active / scope=vehicle / mutex）→ 計 surcharge → 寫 snapshot 進 order doc |
| `server/utils/order.ts` 或新增 `server/utils/order-preferences.ts` | 🆕/改：reconcile snapshot + surcharge 寫入 helper |
| `app/protocol/fetch-api/api/order/type.d.ts` | 改：`OrderDto` 加 `preferences` 欄位；`CreateOrderBody` 加 `preferences.tagIds` |
| `app/components/booking/PassengerTagPreferencePicker.vue` | 🆕 乘客版 chip picker（群組分區 + multiplicity） |
| `app/components/booking/BookingFareSummary.vue` 或既有 booking fare 區塊 | 改：加「喜好標籤加價」行 |
| `app/pages/booking/index.vue` 或 booking 主頁 | 改：嵌入 `PassengerTagPreferencePicker` + 即時 reactive 加價 |
| `app/pages/orders/[id].vue` | 改：訂單詳情顯示 preferences 列表 |
| `app/pages/admin/orders/[id].vue` 或 admin 訂單詳情 | 改：admin 看訂單時也顯示 preferences（為 1E 配對做準備） |
| `i18n/locales/{zh,en,ja}.js` | 加 `booking.preferences.*` keys（三語） |

### 不影響

- 1A tags collection schema
- 1B driver/vehicle profile schema
- 1C public page
- 折扣碼 / fare V2 / referral 既有功能
- firestore.rules（無新 collection）

## 驗收標準

- [ ] Booking 頁底部出現「+ 加入期望特徵」摺疊按鈕；點開展開 5 個群組（power/vehicleType/origin/interior/equipment）
- [ ] 點 chip → 互斥行為正確（single group 切換）；fare summary 即時更新加價行
- [ ] 沒勾 → 不顯示加價行
- [ ] 多勾 → 加價金額 = max（不是 sum）
- [ ] 確認下單建立後，看 order doc 應有 `preferences.tagIds[]` + `preferences.tagSnapshot[]` + `preferences.tagSurcharge`
- [ ] 改 tag.surchargeAmount → 重新打開既有訂單 → 顯示金額**不變**（snapshot 鎖定）
- [ ] 訂單詳情頁顯示勾選的標籤列表 + 加價金額
- [ ] Admin 訂單詳情頁看得到乘客偏好
- [ ] 三語切換正確
- [ ] `pnpm lint` / `pnpm test`（含新 case）/ `pnpm build` 全綠
