# Phase 1D 任務拆解

> 依 `design.md` 實作。完成後 `commit`（不 push），等 Brain AI 點「進 1E」。
> **本 phase 風險最高**（動到既有 booking + pricing + order schema），務必三項 lint/test/build 全綠才 commit。

## 0. 探勘（15 min）
- [ ] 讀 `shared/pricing.ts` 既有 calcFare / fareV2 函式簽名與 export shape
- [ ] 讀 `shared/pricing.spec.ts` 既有 8 test cases pattern
- [ ] 讀 `server/routes/nuxt-api/orders/index.post.ts` 既有訂單建立流程（auth / 折扣碼 / fare 計算寫入）
- [ ] 讀 `app/pages/booking/index.vue` 既有 booking 主頁結構（fare summary 區塊位置）
- [ ] 讀 `app/pages/orders/[id].vue` 訂單詳情頁結構
- [ ] 確認 `$api.GetActiveTags()`（1A 已建）介面與回傳型別
- [ ] Grep `order.fare` / `order.discountAmount` / `order.finalTotal` 確認既有訂單欄位用法

## 1. shared 層（45 min）
- [ ] `shared/pricing.ts` 改：
  - `TagSurchargeIndexEntry` interface
  - `CalcTagSurchargeResult` interface
  - `calcTagSurcharge(selectedTagIds, tagIndex)` function
  - `buildTagSurchargeIndex(tags)` helper
- [ ] `shared/pricing.spec.ts` 改：加 7+ case 覆蓋 max / archived / scope / unknown / 空集合
- [ ] `shared/orderPreferences.ts` 🆕
  - `OrderPreferenceTagSnapshot`、`OrderPreferencesSnapshot`、`OrderPreferencesInput`
  - `buildPreferencesSnapshot(input, tagIndex)`
  - `validateOrderPreferencesShape(input, tagIndex)`（mutex 檢查）
- [ ] `shared/orderPreferences.spec.ts` 🆕（5+ case）

## 2. server 層（45 min）
- [ ] `server/utils/order-preferences.ts` 🆕 或在既有 order utils 加：
  - `loadActiveTagsCache(db)` → Map<string, TagSurchargeIndexEntry>
  - `validateAndSnapshotPreferences(input, db)` 整合 shared validate + snapshot
- [ ] `server/routes/nuxt-api/orders/index.post.ts` 改：
  - body 接 `preferences.tagIds`
  - validate + snapshot
  - 失敗（mutex / scope mismatch / unknown id）→ `badRequestError`
  - 寫入 order doc top-level `preferences` 欄位
  - `finalTotal = baseFare + tagSurcharge - discountAmount`（既有 finalTotal 寫入點調整）
- [ ] `server/routes/nuxt-api/orders/[orderId].patch.ts` 守則：
  - 忽略 body 中的 `preferences`（log warn 即可，不報錯）

## 3. protocol（20 min）
- [ ] `app/protocol/fetch-api/api/order/type.d.ts` 改：
  - `OrderDto` 加 optional `preferences` 欄位
  - `CreateOrderBody` 加 optional `preferences.tagIds`
- [ ] 確認 `$api.CreateOrder` 簽名不需改（透過 body 帶）

## 4. UI（120 min）
- [ ] `app/components/booking/PassengerTagPreferencePicker.vue` 🆕
  - 群組分區 chip picker
  - single / multi multiplicity 行為
  - 顯示加價金額
  - cream theme + 響應式
- [ ] `app/pages/booking/index.vue` 改：
  - onMounted 載 active vehicle tags
  - 嵌入 `PassengerTagPreferencePicker`（摺疊收合）
  - reactive 計算 tagSurcharge 加進 fare summary
  - 確認下單時帶 `preferences.tagIds`
- [ ] `app/pages/orders/[id].vue` 改：
  - 顯示「您的偏好」section（從 `order.preferences.tagSnapshot` 渲染）
  - 顯示 tagSurcharge 行
- [ ] `app/pages/admin/orders/[id].vue`（路徑確認）改：
  - admin 看訂單時也顯示乘客偏好（給 1E 配對用）

## 5. i18n（20 min）
- [ ] `i18n/locales/zh.js` 加 `booking.preferences.*`
- [ ] `i18n/locales/en.js` 加（真翻譯）
- [ ] `i18n/locales/ja.js` 加（真翻譯）

## 6. 驗證（10 min）
- [ ] `pnpm lint` 全綠
- [ ] `pnpm test` 全綠（含新 case，預期 +12 case 左右）
- [ ] `pnpm build` 全綠

## 7. 真機 smoke（20 min）
- [ ] booking 頁底部有「+ 加入期望特徵」摺疊
- [ ] 點 chip 互斥（single group）正確
- [ ] fare summary 即時加價
- [ ] 多勾 → 取 max
- [ ] 沒勾 → 不顯示加價行
- [ ] 確認下單後 Firestore console 看 order doc 有 preferences
- [ ] admin 改某 tag.surchargeAmount → 重開舊單顯示不變
- [ ] 訂單詳情頁顯示偏好正確
- [ ] admin 訂單詳情看得到乘客偏好
- [ ] 三語切換正確

## 8. commit + HANDOFF
- [ ] commit message: `feat: Phase 1D — booking 偏好標籤 + max 加價邏輯`
- [ ] **不 push**
- [ ] 寫 HANDOFF.md
- [ ] 回報「Phase 1D 完工，等 Brain AI 點『進 1E』」
