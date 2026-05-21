# Hand-off：Phase 1D Booking 偏好標籤 + max 加價邏輯

## 狀態

- **實作 100% 完成**：lint / test / build 三項全綠
- 一支 commit（不 push）；firestore rules 本 phase **不動**（無新 collection）
- 等 Brain AI 真機驗收 → 點「進 1E」

## 實作摘要

### shared 層（純函式 + 純型別，可前後端共用）
- [shared/pricing.ts](../../../shared/pricing.ts) — 加 `TagSurchargeIndexEntry` / `CalcTagSurchargeResult` / `buildTagSurchargeIndex` / `calcTagSurcharge`（取 max 而非 sum）
- [shared/pricing.spec.ts](../../../shared/pricing.spec.ts) — 加 8 case（空陣列 / 單一 / max / archived / scope=driver / unknown / 全 invalid / buildIndex 忽略空 id）
- [shared/orderPreferences.ts](../../../shared/orderPreferences.ts) 🆕 — `OrderPreferenceTagSnapshot` / `OrderPreferencesSnapshot` / `OrderPreferencesInput` + `validateOrderPreferencesShape`（mutex check）+ `buildPreferencesSnapshot`
- [shared/orderPreferences.spec.ts](../../../shared/orderPreferences.spec.ts) 🆕 — 11 case 涵蓋形狀 / mutex / snapshot 排序 / 三語 name fallback / 全 invalid

### server 層（util + orders.post / orders.patch / orders.[id].get / admin/orders.get）
- [server/utils/order-preferences.ts](../../../server/utils/order-preferences.ts) 🆕 — `loadActiveTagsForSnapshot` / `validateAndSnapshotPreferences`（一站式 validate + snapshot）/ `serializeOrderPreferences`（Firestore raw → DTO）
- [server/routes/nuxt-api/orders/index.post.ts](../../../server/routes/nuxt-api/orders/index.post.ts) — 接 `preferences.tagIds`，validate → snapshot → 寫進 doc top-level `preferences`；`tagSurcharge` 加在 `estimatedFare`（discount 之後）
- [server/routes/nuxt-api/orders/[orderId].patch.ts](../../../server/routes/nuxt-api/orders/%5BorderId%5D.patch.ts) — body 帶 `preferences` 一律忽略（log warn）；snapshot 不可變
- [server/routes/nuxt-api/orders/[orderId].get.ts](../../../server/routes/nuxt-api/orders/%5BorderId%5D.get.ts) — echo `preferences`（用 `serializeOrderPreferences`）
- [server/routes/nuxt-api/admin/orders/index.get.ts](../../../server/routes/nuxt-api/admin/orders/index.get.ts) — list 每筆 echo `preferences`，給 admin 詳情面板顯示用

### protocol 層
- [app/protocol/fetch-api/api/order/type.d.ts](../../../app/protocol/fetch-api/api/order/type.d.ts) — `CreateOrderParams` 加 `preferences?: { tagIds?: string[] } | null`；新增 `OrderPreferenceTagSnapshotDto` / `OrderPreferencesDto`；`OrderDetail` 加 optional `preferences`
- [app/protocol/fetch-api/api/admin/index.ts](../../../app/protocol/fetch-api/api/admin/index.ts) — 新增 `AdminOrderPrefTagSnapshot` / `AdminOrderPreferences`；`AdminOrder` 加 optional `preferences`

### UI（passenger booking + 訂單詳情 + admin 訂單面板）
- [app/components/booking/PassengerTagPreferencePicker.vue](../../../app/components/booking/PassengerTagPreferencePicker.vue) 🆕 — 依 group 分區 chip picker；single multiplicity 互斥（再點同 chip 取消）；顯示 `+NT$ N` surcharge；cream theme + 響應式
- [app/components/passenger/BookingStepConfirm.vue](../../../app/components/passenger/BookingStepConfirm.vue) — 加 props `availableTags` + `selectedTagIds`；加 `preferencesOpen` 摺疊；加 `tagSurcharge` computed（shared `calcTagSurcharge`）；fare summary 加「+NT$ N 喜好標籤加價」行；`fareAfterDiscount` 重算為 `max(0, fareTotal + tagSurcharge - discount)`；補 `withDefaults` 預設 `flightInfo: null` 修 lint warning
- [app/pages/booking/index.vue](../../../app/pages/booking/index.vue) — onMounted 載 `$api.GetActiveTags('vehicle')` 進 `activeVehicleTags`；維護 `selectedTagIds`；CreateOrder body 加 `preferences`（空陣列送 `null`）；`ClickNewOrder` 重置 `selectedTagIds`；step 4 透過 v-model 傳給 BookingStepConfirm
- [app/pages/orders/[orderId].vue](../../../app/pages/orders/%5BorderId%5D.vue) — 訂單詳情顯示「您的偏好」chip + tagSurcharge 行（依 locale 取 name，缺翻譯 fallback 繁中）
- [app/pages/admin/orders/index.vue](../../../app/pages/admin/orders/index.vue) — admin 詳情面板顯示「乘客偏好（已鎖價）」chip + 偏好加價 row（給 1E 配對 admin 看用）

### i18n（zh / en / ja 完整三語，**真翻譯**）
- [i18n/locales/zh.js](../../../i18n/locales/zh.js) / [en.js](../../../i18n/locales/en.js) / [ja.js](../../../i18n/locales/ja.js) — 加 `booking.preferences.*`（12 keys：title / hint / expand / collapse / selectedCount / singleHint / multiHint / surchargeRow / surchargeDetail / yourPreferences / noPreferences / noTagsAvailable）

## 規格細節決策

| 議題 | 拍板 | 出處 |
|---|---|---|
| 加價邏輯 | `max(selected_tag_surcharges)`，多選一律取最高 | 議題 #1 |
| 加價依據 | 依**乘客勾選**的 tagIds，非車輛擁有 | 議題 #2 |
| 顯示哪些標籤 | active + scope==='vehicle' | 議題 #3 |
| 群組互斥 | 沿用 1A TAG_GROUPS multiplicity（power/vehicleType/origin single；interior/equipment multi） | 議題 #4 |
| 沒勾任何標籤 | tagSurcharge=0，UI 不顯示加價行 | 議題 #5 |
| 報價時點 | 客戶端 reactive 即時 + 確認下單時 server 端 snapshot 鎖定 | 議題 #6 |
| 訂單建立後標籤改價 | snapshot 鎖死；舊單顯示金額不變 | 議題 #7 |
| UI 預設 | 預設摺疊（避免 booking 頁太長）；「+ 加入期望特徵」展開 | 議題 #8 |
| 乘客端 i18n | 三語完整翻譯 | 議題 #9 |
| Picker 是否複用 1B | **新建** `PassengerTagPreferencePicker`（行為類似但加價金額顯示 + cream theme + 單選互斥取消邏輯不同） | 議題 #10 |
| 訂單 schema | top-level `preferences` 欄位 | 議題 #11 |
| 折扣碼 vs tagSurcharge | 折扣 `minFare` 仍用 `baseFare`（不含 tagSurcharge）→ 不可靠標籤拉高過 minFare；`tagSurcharge` 加在折扣之後 | 議題 #12 |
| **patch 守則** | body 帶 `preferences` 一律忽略 + log warn；snapshot 一旦寫入即固化 | tasks §2 |
| **舊單沒 preferences 欄位** | server 端 `serializeOrderPreferences(undefined)` 回 `null`；UI v-if 守住不渲染 | 兼容 |
| **空陣列 vs null** | CreateOrder body 用 `null` 表示乘客未勾選；server 寫進 doc 時用 `null`；orders.get 回 `null` | 一致性 |
| **lint warning fix** | `BookingStepConfirm` 改用 `withDefaults` 後 ESLint 多檢一條 `vue/require-default-prop`，補 `flightInfo: null` 預設 | 副作用 |

## 驗證結果

```
pnpm lint   ✅ 0 error / 0 warning
pnpm test   ✅ 10 test files / 182 tests passed（+19 case：8 calcTagSurcharge + 11 orderPreferences）
pnpm build  ✅ exit 0；orders.post / orders.[orderId].get / admin/orders.get chunk 全 emit
```

## 真機驗收 checklist（Brain AI）

啟動 `pnpm dev` + 確保 1A seed 過 21 個預設標籤（先到 `/admin/settings` 車輛標籤 tab 看；無則點「載入預設標籤」）：

### Booking 流程

- [ ] **B1** 進 `/booking`，走完 4 步到「確認訂單」頁
- [ ] **B2** 確認頁底部（折扣碼上方）有「+ 加入期望特徵」摺疊按鈕
- [ ] **B3** 點開展開 → 看到 5 個 group（動力 / 車型 / 產地 / 內裝 / 設備；driverSkill **不顯示**）
- [ ] **B4** 點 power group chip（單選）→ 同群其他 chip 取消選中；再點當前選中 chip → 取消（清空）
- [ ] **B5** 點 interior group chip（多選）→ toggle 多選
- [ ] **B6** 多勾後 fare summary 出現「+NT$ N 喜好標籤加價」row；金額 = max（不是 sum）
- [ ] **B7** 取消所有勾選 → 加價 row 消失
- [ ] **B8** 切 locale zh/en/ja → 文案 + tag 名稱跟著切（缺翻譯 fallback 繁中）

### 訂單建立 + snapshot 鎖價

- [ ] **B9** 確認下單成功 → 進訂單詳情 `/orders/[id]`，看到「您的偏好」chip + tagSurcharge row（若 > 0）
- [ ] **B10** 開 Firebase console 查 `orders/{orderId}.preferences` → 含 `tagIds`、`tagSnapshot[]`（含 name 三語 / surchargeAmount / group / sortOrder）、`tagSurcharge`、`snapshotAt`
- [ ] **B11** 改 `tags/{tagId}.surchargeAmount`（admin /admin/settings）→ 重開既有訂單詳情頁 → 顯示金額**不變**（snapshot 鎖定）
- [ ] **B12** 同一訂單再開 admin `/admin/orders` → 展開該訂單 → 看到「乘客偏好（已鎖價）」chip + 偏好加價 row

### Server 端驗證

- [ ] **C1** 用 devtool console 送 `{ preferences: { tagIds: ['t-power-ev', 't-power-hybrid'] } }` 給 POST /nuxt-api/orders → 400 `mutex_violation`（power 為 single group）
- [ ] **C2** 送 `{ preferences: { tagIds: ['t-unknown-id', 't-int-captain'] } }` → 200 建單成功（unknown 被忽略）；snapshot 只含 captain；tagSurcharge = captain.surchargeAmount
- [ ] **C3** 送 PATCH `/nuxt-api/orders/[id]` body 含 `preferences: { tagIds: [...] }` → 200（preferences 被 server 忽略 + console warn；其他欄位正常更新）
- [ ] **C4** 折扣碼 minFare = 1000，baseFare = 800，tagSurcharge = 300 → 折扣**不應**生效（minFare 用 baseFare 不含 tag）

### 多語

- [ ] **L1** 切 zh → 「期望特徵（選填）」/「+ 加入期望特徵」/「喜好標籤加價」
- [ ] **L2** 切 en → 「Preferences (optional)」/「+ Add Preferences」/「Preference surcharge」
- [ ] **L3** 切 ja → 「希望する特徴（任意）」/「+ 希望特徴を追加」/「希望タグ加算」

### 邊界

- [ ] **E1** 乘客不勾任何標籤 → 確認頁 fare summary 不出現加價 row；訂單 doc `preferences = null`
- [ ] **E2** tag.surchargeAmount = 0 的標籤勾選 → 加價 row 不顯示（max = 0）
- [ ] **E3** 全部勾選 archived tag → 同 E1（archived 入 invalid，max = 0）

> firestore rules 沒 deploy；本 phase 無新 collection。

## 留尾（不在本 phase 範圍）

- ⏳ booking 配對流程接入 tagIds → Phase 1E（需求單 / 喊單）
- ⏳ Soft Match / 配對重試 → Phase 1F
- ⏳ E2E 測試 + rules deploy + prod push → Phase 1G
- ⏳ 1C 公開檔案頁從 booking 結果區塊接連結（「查看車輛詳情」）→ 1E 配對結果出來後考慮

## 已知陷阱與設計權衡

1. **取 max 不取 sum**：若 admin 想藉「多 nice-to-have = 多收錢」鼓勵升級，這策略反方向。但拍板已定，後續若要改 sum 只需改 `calcTagSurcharge` 一處。
2. **driver-scope 不收費**：driverSkill（英文 / 商務）不影響 booking 定價，純為 1E 配對輔助。
3. **archived 標籤在訂單建立後改價**：snapshot 鎖死，但若 admin 將原本 +600 的 tag archive 並重建 +1000，舊單仍按 +600 收。
4. **booking 頁載入 active tags 的時點**：onMounted 一次性載入；若 admin 在 booking 過程中改 tag，user 需 refresh 才會看到。
5. **`PassengerTagPreferencePicker` 與 1B `DriverTagGroupPicker` 不複用**：行為類似但加價金額顯示 + cream theme + 單選互斥取消邏輯不同。新建避免動 1B driver 端。
6. **`snapshotAt` 用 ISO string 而非 Firestore Timestamp**：snapshot 寫入時直接用 `new Date().toISOString()`，Firestore 接受字串 ok；不用 serverTimestamp 是因為 snapshot 是「寫單瞬間」的客戶端時間，server 端用 `Date.now()` 也夠精確。Order doc 的 `createdAt` 才是 serverTimestamp。
7. **AdminOrder list endpoint echo `preferences`**：是給 admin 詳情 modal 顯示「乘客偏好」用；只 echo `tagSnapshot` 子集（不含 invalid id），admin 看到的是鎖價快照。

## Commit

```
feat: Phase 1D — booking 偏好標籤 + max 加價邏輯
```

新增 / 改動檔案清單：

**新增**
- shared/orderPreferences.ts 🆕
- shared/orderPreferences.spec.ts 🆕
- server/utils/order-preferences.ts 🆕
- app/components/booking/PassengerTagPreferencePicker.vue 🆕
- openspec/changes/2026-05-21-booking-tag-pricing/HANDOFF.md 🆕

**改動**
- shared/pricing.ts ✏️（加 calcTagSurcharge + buildTagSurchargeIndex）
- shared/pricing.spec.ts ✏️（+8 case）
- server/routes/nuxt-api/orders/index.post.ts ✏️
- server/routes/nuxt-api/orders/[orderId].patch.ts ✏️
- server/routes/nuxt-api/orders/[orderId].get.ts ✏️
- server/routes/nuxt-api/admin/orders/index.get.ts ✏️
- app/protocol/fetch-api/api/order/type.d.ts ✏️
- app/protocol/fetch-api/api/admin/index.ts ✏️
- app/components/passenger/BookingStepConfirm.vue ✏️
- app/pages/booking/index.vue ✏️
- app/pages/orders/[orderId].vue ✏️
- app/pages/admin/orders/index.vue ✏️
- i18n/locales/zh.js ✏️
- i18n/locales/en.js ✏️
- i18n/locales/ja.js ✏️
