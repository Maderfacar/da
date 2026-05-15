# Hand-off：P20 Booking 表單擴充（contactPhone / flightNumber / terminal / notes）

## 狀態

- 規格文件齊備（proposal.md + tasks.md 同目錄）
- 實作 0%，**下個 session 直接開工**
- 目標：1 個 session 完成 + lint + build + commit + push

## 實作前必看：flight_registry 影響範圍縮小

**重要更新（2026-05-11）**：flight_registry tracker Stage 1+2 已上 prod（commit `fa1310b`）。原 spec 的 `flightNumber` / `terminal` 欄位**現在不需要使用者自行輸入** — booking 流程的 Step 1 (`BookingStepType.vue`) 已經透過 `/api/flight` 蒐集了完整 `FlightInfo`（含 flightNo、terminal、airline、起降機場）。

**新策略**：

| 欄位 | 是否需要 UI 收集 | 取得方式 |
|---|---|---|
| `contactPhone` | ✅ **需要新 UI**（必填） | 使用者新輸入欄位 |
| `flightNumber` | ❌ 不需新 UI | 從現有 `flightInfo.flightNo` ref pass-through 到 ClickSubmit |
| `terminal` | ❌ 不需新 UI | 從現有 `flightInfo.terminal` ref pass-through 到 ClickSubmit |
| `notes` | ✅ **需要新 UI**（optional） | 使用者新輸入欄位 |

→ **UI 工作從 4 欄變 2 欄（contactPhone + notes）**。FlightInfo 的 pass-through 由 ClickSubmit 直接讀 `flightInfo.value` 寫入 CreateOrder。

舊 `tasks.md` Stage 3 寫到「flightNumber / terminal：v-if 才顯示」可以**整段砍掉**，省掉 UiSelect / UiInput 兩個欄位。

## 既有 flight 流程沒問題的證據

`app/pages/booking/index.vue` line 33-51 已有：
```ts
const flightNo = ref('');
const flightInfo = ref<FlightInfo | null>(null);
// ...
watch(flightInfo, (info) => {
  if (!info) return;
  const place = TERMINAL_PLACE[info.terminal];
  if (orderType.value === 'airport-pickup') pickupLocation.value = place;
  else if (orderType.value === 'airport-dropoff') dropoffLocation.value = place;
});
```

`BookingStepType.vue` line 173-178 強制：
```ts
const canNext = computed(() => {
  // ...
  if (needsFlight.value && !localFlightInfo.value) return false;
  return true;
});
```

→ orderType 為 `airport-pickup` / `airport-dropoff` 時，使用者**必須**通過 API 查到航班才能進下一步。`flightInfo` 在 ClickSubmit 階段保證非 null。

唯一已知例外：API 完全找不到該航班時（LCC / 區域航空涵蓋率限制） → 使用者卡在 Step 1 無法 advance。這是 flight_registry 的後續工作（手動 fallback UI），不在 P20 範圍。

## 執行 Plan（取代 tasks.md Stage 3）

### Stage 1：server 端（與 tasks.md 一致）

`server/routes/nuxt-api/orders/index.post.ts`：
- `CreateOrderBody` 加 4 欄位
- 驗證 `contactPhone` 格式 `^09\d{8}$`
- 驗證 `notes` length ≤ 200
- Firestore set 寫入新欄位（undefined 時不寫）

### Stage 2：client API type（與 tasks.md 一致）

`app/protocol/fetch-api/api/order/type.d.ts`：
- `CreateOrderParams` 加 `contactPhone: string` (必填) + `flightNumber?: string` + `terminal?: string` + `notes?: string`

### Stage 3：booking 表單 UI（**簡化版**）

**只加 2 個欄位**：

#### 3.1 contactPhone

- 放置位置建議：**Step 4 (BookingStepConfirm)** 確認頁上方加一段「聯絡資訊」區塊
  - 理由：contactPhone 跟「電話」這種資料感覺屬於 review/submit 階段，不是訂車選項
  - 替代：放在 Step 1 (BookingStepType) 用車時間下方
- ElInput type="tel" inputmode="numeric" maxlength="10"
- 即時驗證 `^09\d{8}$`，不符 → 紅字 + disable 下方 submit
- 持久化：寫進 `storeOrder.draft.contactPhone`（draft schema 也要 sync 加欄位）

#### 3.2 notes

- 同放 Step 4 確認頁，放在 contactPhone 下方
- ElInput type="textarea" :rows="3" maxlength="200" show-word-limit
- 持久化：`storeOrder.draft.notes`

#### 3.3 ClickSubmit 改動

`app/pages/booking/index.vue` line 116-126：
```ts
const res = await $api.CreateOrder({
  // ...既有欄位
  contactPhone: contactPhone.value,           // 新增
  flightNumber: flightInfo.value?.flightNo ?? null,  // pass-through
  terminal: flightInfo.value?.terminal ?? null,       // pass-through
  notes: notes.value || null,                  // 新增
});
```

### Stage 4：i18n（與 tasks.md 一致，但簡化掉 flightNumber/terminal 相關 keys）

只需要這幾個 key（zh / en / ja 三檔對齊，**P17 強制規範**）：
```
booking.form.contactPhone
booking.form.contactPhonePlaceholder
booking.form.contactPhoneError
booking.form.notes
booking.form.notesPlaceholder
booking.form.notesCount  // '{n}/200' 字數提示
```

### Stage 5：BookingStepConfirm 顯示新欄位

`app/components/passenger/BookingStepConfirm.vue` 在現有 confirm 卡片底部加：
- `contactPhone` 一行
- `notes` 一行（如有）
- 已有 flightInfo 區塊就不用動

### Stage 6：store-order draft schema 對齊

`app/stores/7.store-order.ts` line 6-16 跟 line 51-63 兩處 draft 預設值都要加 `contactPhone: ''` 跟 `notes: ''`。

### Stage 7：commit + push

- 一個 commit 推 main（fast-forward），或拆「server / client / i18n」三個 commit 都可
- 標題：`feat(booking): P20 表單擴充 — contactPhone（必填）+ notes + flight 資料 pass-through`

## Stage Gate（取代 tasks.md G5、調整 G4/G6/G7）

- [ ] G1 lint + build pass
- [ ] G2 booking 表單能填 contactPhone + notes + 提交成功
- [ ] G3 必填驗證：contactPhone 空 → submit 鈕 disable / 顯示錯誤
- [ ] G4 格式驗證：contactPhone 不是 09 開頭 / 非 10 碼 → 紅字錯誤
- [ ] G5 ~~條件顯示 flight 欄位~~ → **改為**：airport-pickup/dropoff 提交後 Firestore order doc 確實有 `flightNumber` + `terminal` 欄位（自 flightInfo pass-through）
- [ ] G6 driver/trip modal 看新訂單：contactPhone 顯示 + flightNumber + terminal + notes（如有）
- [ ] G7 既有訂單（無這些欄位）driver/admin modal 仍正常顯示「—」fallback
- [ ] G8 三語言 booking 表單 label 正確
- [ ] G9 admin/orders modal 也能正確顯示新欄位（既有 PatchOrderParams 已支援，server admin/orders endpoint 應該也回得出來；驗收時要確認）

## 既有檔案內容快速 ref（避免下次再讀）

| 檔案 | 行數 | 用途 |
|---|---|---|
| `app/pages/booking/index.vue` | 431 | 4 步驟 wrapper + ClickSubmit |
| `app/components/passenger/BookingStepConfirm.vue` | 219 | Step 4 確認卡片 — 新欄位放這裡 |
| `app/components/passenger/BookingStepType.vue` | 469 | Step 1 — flight 已 fully wired，**不要改** |
| `app/components/passenger/BookingStepOptions.vue` | 357 | Step 3 — passengers/luggage/vehicle/extras |
| `app/stores/7.store-order.ts` | 81 | draft schema — 加 contactPhone + notes |
| `app/protocol/fetch-api/api/order/type.d.ts` | 152 | CreateOrderParams + AssignedOrder（line 85-87 已宣告 flightNumber/terminal/notes 在 AssignedOrder，**這次只補 CreateOrderParams**） |
| `server/routes/nuxt-api/orders/index.post.ts` | 137 | CreateOrderBody + Firestore write |
| `i18n/locales/zh.js` | ~290（已含此 session 加的 orderType/vehicle/orders namespace） | 加 booking.form.* 區塊 |
| `i18n/locales/en.js` | ~250 | 同上 |
| `i18n/locales/ja.js` | ~250 | 同上 |

## 已知陷阱

1. **三語言對齊強制（P17）**：i18n 三檔結構必須完全一致，否則 LIFF 執行時會 `[vue-i18n] Not found` warning。每加 zh 一個 key，en / ja 必須同時加。
2. **Firestore schema 新欄位 nullable**：舊訂單沒這 4 欄位，driver/admin 端讀取時必須 `?? null` fallback 已驗證 OK（assigned.get.ts 已處理）。
3. **CLAUDE.md 規範**：ElInput 必須加 maxlength；ElSelect 搭 clearable 要加 `value-on-clear=""`（terminal 不需 UiSelect 已不適用）。
4. **commit message 繁中 + Conventional Commits**（已是專案慣例）。

## 工作量估算

- Stage 1 (server)：~30 行 diff
- Stage 2 (type)：~5 行
- Stage 3 (UI)：~80 行（含 SCSS）
- Stage 4 (i18n × 3)：~30 行
- Stage 5 (BookingStepConfirm)：~10 行
- Stage 6 (store)：~6 行

**總計 ~160 行 diff**，純 M 級，1 session 範圍內舒服完成 + 留 buffer 處理 LIFF 實機驗收。
