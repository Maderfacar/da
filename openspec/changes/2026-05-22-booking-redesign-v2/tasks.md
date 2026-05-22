# Tasks — Booking Redesign v2

> 批次 1 = 純前端 UX + Schema optional 欄位（單視窗可完成）
> 批次 2 = 破壞性改造 + Slider（需另開視窗、prod push）
> 批次 3 = Admin 後台手動操作（Brain AI 親自）

---

## 批次 1：UX 重排 + 聯絡人欄位 + tagline schema

### 1. Schema 層

- [ ] `shared/pricing.ts`: `FleetVehicle` interface 加 `tagline?: I18nLabel`
- [ ] `app/protocol/fetch-api/api/order/type.d.ts`: `CreateOrderParams` 加 `contactName?: string` + `passengerName?: string`
- [ ] `app/protocol/fetch-api/api/admin/index.ts`（vehicle payload）：`CreateVehiclePayload` + `UpdateVehiclePayload` 加 `tagline?: I18nLabel`

### 2. Server 層

- [ ] `server/routes/nuxt-api/orders/index.post.ts`: accept `contactName` + `passengerName`、寫入 Firestore order doc
- [ ] `server/routes/nuxt-api/orders/[orderId].get.ts`: 回傳 `contactName` + `passengerName`（fallback 空字串）
- [ ] `server/routes/nuxt-api/orders/[orderId].patch.ts`: support patch contactName / passengerName（optional）
- [ ] `server/routes/nuxt-api/admin/vehicles/index.post.ts`: accept tagline
- [ ] `server/routes/nuxt-api/admin/vehicles/[id].put.ts`: accept tagline（含 null = 清除）
- [ ] `server/routes/nuxt-api/admin/vehicles/[id].get.ts`: 回傳 tagline
- [ ] `server/utils/fleet-config.ts`（如有）: 載入 tagline 欄位

### 3. Booking 流程改造

- [ ] `app/pages/booking/index.vue`:
  - state 加 `contactName` + `passengerName` + `sameAsContact`（從 store draft sync）
  - LINE displayName 預填 contactName 邏輯（onMounted）
  - sameAsContact watch 同步邏輯
  - SyncToStore / ClickSubmit / ClickNewOrder 帶上新欄位
  - 移除 extras 相關 state（若 EnabledExtras 區塊整個移除）
- [ ] `app/components/passenger/BookingStepOptions.vue`:
  - 移除「加值服務」整個區塊（template 跟 SCSS）
  - 移除 `extras` ref + 對應 ToggleExtra / isExtraSelected helper
  - 重新排序 template：人數 → 行李 → 車型 → 提示文案 → 期望特徵 chip
  - 加「💡 如有特殊需求請從下方選擇」提示區塊
  - 在車型卡與提示之間插入 `PassengerTagPreferencePicker` 區塊（直接顯示、不摺疊）
  - 從父層接 `availableTags` + `selectedTagIds` props
  - 車型卡渲染多顯一行 tagline（若有）
- [ ] `app/components/passenger/BookingStepConfirm.vue`:
  - 移除「期望特徵」摺疊區塊（搬到 Step 3）
  - 移除「行駛距離」「預估時間」row
  - 移除「喜好標籤加價」單獨明細 row
  - 移除「折前 / 折扣 / 折後」三行拆分、改一行「應付車資 NT$ X」
  - 新增聯絡人 input（必填 + LINE displayName 預填）
  - 新增乘車人 input + 同聯絡人 checkbox（同步 + 取消保留邏輯）
  - 備註 placeholder 改為新文案
  - 訂單摘要 row 順序 / 內容調整
- [ ] `app/components/booking/PassengerTagPreferencePicker.vue`:
  - 不需動（filter 在 booking/index.vue 載入端做）

### 4. Tag 載入 filter

- [ ] `app/pages/booking/index.vue` `ApiLoadActiveVehicleTags`: 載入後 filter `t.group !== 'vehicleType'`

### 5. Admin 欄位

- [ ] `app/components/admin/SettingsFleetVehicles.vue`:
  - `VehicleFormState` 加 taglineZh / taglineEn / taglineJa
  - `_emptyForm` 預設空字串
  - `ClickOpenEdit` 讀既有 tagline 填 form
  - `ClickSave` payload 帶上 tagline（三語都空 → 不送或送 null）
  - 編輯彈窗 template 加 3 個 ElInput（zh/en/ja tagline）

### 6. Store

- [ ] `app/stores/7.store-order.ts`: `draft` 介面加 `contactName?: string` + `passengerName?: string`、`SetDraft` 支援新欄位、`ResetDraft` 清空

### 7. i18n

- [ ] `i18n/locales/zh.js` + `en.js` + `ja.js` 新增 keys:
  - `booking.options.passengerHint`: 「💡 如有特殊需求請從下方選擇」
  - `booking.form.contactName`: 「聯絡人」
  - `booking.form.contactNamePlaceholder`: LINE displayName fallback
  - `booking.form.passengerName`: 「乘車人」
  - `booking.form.sameAsContact`: 「同聯絡人」
  - `booking.form.notesPlaceholder`: 「小孩需安全座椅、行李較多或特殊規格、多人數或特殊接駁需求」（覆寫既有）
  - `booking.confirm.finalFare`: 「應付車資」（取代既有總價拆分 keys）
  - `booking.confirm.passengerSummary`: 「{adult} 位大人」（為批次 2 預留、可暫不用）

### 8. 驗證

- [ ] `pnpm lint:fix` 通過
- [ ] `pnpm build` 通過
- [ ] `pnpm test`（既有 8 個 fare test 必須通過）
- [ ] 手動驗證 booking 流程：
  - Step 3 順序正確、加值服務區塊消失、特徵 chip 直接顯示
  - Step 4 聯絡人預填 LINE 名字、同聯絡人 checkbox 同步 / 取消保留
  - 備註 placeholder 顯示新文案
  - 送出訂單成功、Firestore 訂單含 contactName + passengerName
  - 既有訂單列表頁正常顯示（fallback）

### 9. Commit

- [ ] commit message（繁體中文）：

```
feat: booking 重構 v2 批次 1 - Step 3/4 重排 + 聯絡人乘車人欄位 + tagline schema

- Step 3: 移除加值服務區塊、期望特徵 chip 直接顯示、加「特殊需求請從下方選擇」提示
- Step 4: 新增聯絡人/乘車人欄位（LINE displayName 預填 + 同聯絡人 checkbox）、移除距離/時間/折扣明細、總價改一行「應付車資」
- Tag: booking 端 filter 掉 vehicleType group（拿到司機端用）
- Schema: FleetVehicle 加 optional tagline 三語欄位、Order 加 optional contactName/passengerName
- Admin: SettingsFleetVehicles 編輯彈窗加 tagline 三語輸入
- 備註 placeholder 改為「小孩需安全座椅、行李較多或特殊規格、多人數或特殊接駁需求」
- 計費邏輯零變動（Fare V2 + tagSurcharge max + 折扣 全部保留）
- passengerCount 拆分 + 車型卡 slider 留批次 2
```

---

## 批次 2：人數拆分 + Slider + Prod Push（另開視窗）

### 1. passengerCount 拆 adultCount + childCount

- [ ] `shared/pricing.ts` + `app/protocol/fetch-api/api/order/type.d.ts`: 加 `adultCount?: number` + `childCount?: number`、保留 `passengerCount` 向後相容
- [ ] `server/routes/nuxt-api/orders/index.post.ts`: accept 新欄位、容量校驗改 `adult + child ≤ capacity`、寫入 Firestore（同時保留 passengerCount = adult + child fallback）
- [ ] `server/routes/nuxt-api/orders/[orderId].get.ts`: 回傳 adultCount / childCount（fallback：adultCount = passengerCount, childCount = 0）
- [ ] `app/components/passenger/BookingStepOptions.vue`:
  - 移除單一 passenger stepper、加大人 stepper + 兒童 stepper
  - 容量校驗邏輯：`adult + child > capacity` → vehicle disabled
- [ ] `app/components/passenger/BookingStepConfirm.vue`: 訂單摘要顯示「大人 X / 兒童 Y」
- [ ] `app/pages/booking/index.vue` + `stores/7.store-order.ts`: state / draft 拆分
- [ ] Admin order 顯示頁:
  - `app/pages/admin/orders/index.vue`: 列表欄位顯示大人/兒童
  - `app/pages/admin/orders/[id].vue`（若有）: 詳情顯示
- [ ] Driver 端訂單顯示頁:
  - `app/pages/driver/trip.vue` 或 `driver/pending` 等: 顯示大人/兒童
- [ ] LINE 通知模板: 檢查 admin/settings line-management 內的 order template 是否有 `{passengerCount}` placeholder、若有需擴充（或保持 `{passengerCount}` = adult + child）
- [ ] 既有訂單 backward-compat: 顯示時若無 adultCount → fallback 顯示 passengerCount 為大人數
- [ ] `pnpm test` 寫 unit test for 容量校驗

### 2. 車型卡 Slider

- [ ] 評估 library: 推薦 `swiper`（mature、支援 snap / swipe / 鍵盤 / breakpoint）；若已裝其他 carousel 套件優先用既有
- [ ] `app/components/passenger/BookingStepOptions.vue`:
  - 車型卡 wrapper 改 swiper container
  - 設定 `slidesPerView: 1.5`、`spaceBetween: 12`、`centeredSlides: false`、`grabCursor: true`
  - 手機 swipe / 桌面左右按鈕（NavigationModule）/ snap 到卡片邊界
  - 保留 `is-active`「選中」狀態、`is-disabled`「容量不足」狀態
- [ ] SCSS：slider 容器寬度、卡片寬度 calc、按鈕樣式
- [ ] 響應式: 桌面顯示 2.5 張、平板 2 張、手機 1.5 張（用 swiper breakpoints）

### 3. 驗證

- [ ] `pnpm lint:fix` 通過
- [ ] `pnpm build` 通過
- [ ] `pnpm test`（含新增的容量校驗 test）
- [ ] 手動驗證:
  - Step 3 大人/兒童拆分 stepper、容量校驗正確
  - 車型卡 slider 手機 swipe / 桌面按鈕 / snap 行為
  - Admin order list 顯示大人/兒童
  - Driver 訂單頁顯示大人/兒童
  - 舊訂單 backward-compat 正確（顯示 passengerCount 為大人）
- [ ] Playwright e2e: 至少跑 booking happy path（如有既有 test、要更新欄位 assertion）

### 4. Commit + Push prod

- [ ] commit message（繁體中文）:

```
feat: booking 重構 v2 批次 2 - 人數拆大人/兒童 + 車型卡 slider

- Schema: 訂單加 adultCount + childCount（保留 passengerCount 向後相容）
- Step 3: 人數拆兩個 stepper（大人/兒童）、容量校驗改 adult+child ≤ capacity
- 車型卡: 改 swiper slider（手機 swipe / 桌面按鈕 / 1.5 張顯示 / 滑動 snap）
- 跨系統: admin order list/detail、driver 訂單頁、LINE 通知模板都改顯大人/兒童
- 既有訂單 backward-compat: 無 adultCount 時 fallback 顯示 passengerCount 為大人數
- Booking redesign v2 完整收尾
```

- [ ] `git push origin claude/unruffled-panini-3654e0`
- [ ] 視情況 merge 到 main / push prod（依專案 CI 流程）
- [ ] Firebase deploy（如 firestore.rules 有變動）

---

## 批次 3：Admin 後台手動操作（Brain AI 親自）

- [ ] Admin 後台 `/admin/settings → Fleet → Vehicles` 編 4 個級距:
  - sedan: label「經濟五人座 / Economy 5-seater / エコノミー 5 人乗り」、tagline「一般通勤 / 機場接送」三語、icon `mdi:car-hatchback`
  - suv: label「豪華五人座 / Luxury 5-seater / ラグジュアリー 5 人乗り」、tagline「商務洽談 / 體面接送」三語、icon `mdi:car-estate`
  - van: label「商務九人座 / Business 9-seater / ビジネス 9 人乗り」、tagline「大型團體 / 接駁包車」三語、icon `mdi:van-passenger`
  - premium: label「旗艦七人座 / Premium 7-seater / プレミアム 7 人乗り」、tagline「家庭旅遊 / 中團接送」三語、icon `mdi:car-luxury`
- [ ] Admin 後台 `Fleet → Extras` 評估:
  - 「兒童座椅」「寵物友善」「無障礙坡道」既有 extras 是否禁用（已納入 equipment tag）
  - 其他 extras 視情況保留 / 移除
- [ ] 司機端 vehicleType tag 標註 onboarding（若需要）:
  - 通知司機在 vehicleProfile 標 MPV / SUV / CUV / 轎車 / 9 人座 Van
  - 為批次 2 完成後的「派遣媒合」做準備
- [ ] OpenSpec change archive: `/opsx:archive 2026-05-22-booking-redesign-v2`
