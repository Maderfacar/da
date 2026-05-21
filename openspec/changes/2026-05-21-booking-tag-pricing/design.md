# Design — Phase 1D Booking 偏好標籤勾選 + 加價邏輯

## 1. 計價邏輯

### 1.1 加價函式

`shared/pricing.ts` 新增（不動既有 `calcFare` / fare V2 邏輯）：

```ts
// 對外 minimal API
export interface TagSurchargeIndexEntry {
  id: string
  group: TagGroup
  scope: TagScope
  surchargeAmount: number
  status: 'active' | 'archived'
}

export interface CalcTagSurchargeResult {
  surcharge: number               // max(selected tag.surchargeAmount)，未命中為 0
  matchedTagIds: string[]         // 真正命中的 id（過濾掉 archived / scope!==vehicle / 不存在）
  invalidTagIds: string[]         // 無效的 id（server 端用來回 400）
}

export function calcTagSurcharge(
  selectedTagIds: string[],
  tagIndex: ReadonlyMap<string, TagSurchargeIndexEntry>,
): CalcTagSurchargeResult
```

邏輯：
1. 對每個 `selectedTagIds`：
   - 不在 `tagIndex` → push invalid
   - `status !== 'active'` → push invalid
   - `scope !== 'vehicle'` → push invalid
   - 否則 push matched
2. `surcharge = matched.length === 0 ? 0 : Math.max(...matched.map(t => t.surchargeAmount))`
3. matched / invalid 分別回傳

### 1.2 unit test cases（加在 `shared/pricing.spec.ts` 或新檔）

- 空陣列 → surcharge=0、matched=[]、invalid=[]
- 單一有效 → surcharge=該值
- 多個有效 → surcharge=max
- 含 archived → archived 入 invalid，surcharge 用剩下的
- 含 scope=driver → driver 入 invalid
- 不存在 id → 入 invalid
- 全部無效 → surcharge=0、matched=[]、invalid=[全部]

## 2. 訂單偏好 snapshot

`shared/orderPreferences.ts`（新檔）：

```ts
export interface OrderPreferenceTagSnapshot {
  id: string
  name: { zh_tw: string; en?: string; ja?: string }  // 完整三語抓 snapshot
  group: TagGroup
  surchargeAmount: number   // 寫單時的 surcharge（鎖定）
  sortOrder: number
}

export interface OrderPreferencesSnapshot {
  tagIds: string[]                                // user 勾選的 id list（原樣）
  tagSnapshot: OrderPreferenceTagSnapshot[]       // 解析後的 snapshot（不含 invalid）
  tagSurcharge: number                            // max(snapshot.surchargeAmount)
  snapshotAt: string                              // ISO timestamp
}

export interface OrderPreferencesInput {
  tagIds?: string[]
}

export function buildPreferencesSnapshot(
  input: OrderPreferencesInput,
  tagIndex: ReadonlyMap<string, FullTagDocForSnapshot>,
): OrderPreferencesSnapshot
```

snapshot 寫進 order doc 後即固化，往後 tag.surchargeAmount 變動不影響舊單。

## 3. server 端整合

### 3.1 `POST /nuxt-api/orders/index.post.ts`（既有）

加入：
1. 從 body 接 `preferences.tagIds: string[]`（可選；無 → 跳過）
2. 從 `tags` collection 載 active tags（or pass cached index）
3. server 端 `validateOrderPreferences(input, tagIndex)`：
   - 形狀檢查
   - **mutex check**：single group 不可選 2+ 個 → return badRequestError
   - scope 必須 'vehicle'
   - active 必須 true
4. `buildPreferencesSnapshot(input, tagIndex)` → 寫進 order doc top-level：
   ```ts
   order.preferences = {
     tagIds, tagSnapshot, tagSurcharge, snapshotAt: now
   }
   ```
5. 最終 fare 計算：`finalTotal = baseFare + tagSurcharge - discountAmount`
   - 折扣碼 `minFare` 判定仍用 baseFare（不算 tagSurcharge）→ 避免靠 tag 拉高過 minFare 取得折扣

### 3.2 訂單 doc schema 變動

```ts
// orders/{orderId} 新增 top-level
preferences?: {
  tagIds: string[]
  tagSnapshot: OrderPreferenceTagSnapshot[]
  tagSurcharge: number
  snapshotAt: Timestamp
}
```

既有 `fare` / `discountAmount` 不動。新加 `finalTotal` 若已有就 reuse，否則計算 `baseFare + tagSurcharge - discountAmount` 寫入。

### 3.3 訂單變更 PATCH 不允許改 preferences

`server/routes/nuxt-api/orders/[orderId].patch.ts` 守則：忽略 body 中的 `preferences`（除非 admin 強制重算，本 phase 不支援）。

## 4. UI 規格

### 4.1 `app/components/booking/PassengerTagPreferencePicker.vue` 🆕

Props：
```ts
interface Props {
  modelValue: string[]        // selected tag ids
  tags: ActiveVehicleTagDto[] // server 載入的 active vehicle tags
  disabled?: boolean
}
```

Emits：`update:modelValue`。

UI（pug）：
```pug
.PassengerTagPreferencePicker(v-if="hasTags")
  .PassengerTagPreferencePicker__group(v-for="group in groupedTags" :key="group.key")
    .PassengerTagPreferencePicker__group-header
      span.PassengerTagPreferencePicker__group-name {{ groupLabel(group.key) }}
      span.PassengerTagPreferencePicker__group-meta
        | {{ group.multiplicity === 'single' ? $t('booking.preferences.singleHint') : $t('booking.preferences.multiHint') }}
    .PassengerTagPreferencePicker__chips
      button.PassengerTagPreferencePicker__chip(
        v-for="tag in group.tags"
        :key="tag.id"
        :class="{ 'is-selected': isSelected(tag.id) }"
        @click="ClickToggleChip(tag, group)"
        :disabled="disabled"
      )
        span {{ tag.name }}
        span.PassengerTagPreferencePicker__surcharge(v-if="tag.surchargeAmount > 0")
          | +NT$ {{ tag.surchargeAmount }}
```

行為：
- 群組 multiplicity='single'：點同一群其他 chip → 取消舊、選新；點當前選中 → 取消（變未選）
- 群組 multiplicity='multi'：點 chip → toggle
- 內部維護 `selected: Set<string>` mirror prop

### 4.2 Booking 頁整合

`app/pages/booking/index.vue`（既有頁面，本 phase 改）：

在 fare summary 上方加：

```pug
.BookingPreferences
  .BookingPreferences__toggle(@click="ClickTogglePreferences")
    span {{ preferencesOpen ? '－' : '＋' }}
    span {{ $t('booking.preferences.title') }}
    span.BookingPreferences__count(v-if="selectedTagIds.length")
      | {{ $t('booking.preferences.selectedCount', { count: selectedTagIds.length }) }}
  PassengerTagPreferencePicker(
    v-if="preferencesOpen"
    v-model="selectedTagIds"
    :tags="activeVehicleTags"
  )
```

Fare summary 加一行：

```pug
.BookingFareSummary__row(v-if="tagSurcharge > 0")
  span.BookingFareSummary__row-label {{ $t('booking.preferences.surchargeRow') }}
  span.BookingFareSummary__row-value +NT$ {{ tagSurcharge }}
```

### 4.3 計算 reactive

```ts
const activeVehicleTags = ref<ActiveVehicleTagDto[]>([])
const selectedTagIds = ref<string[]>([])

onMounted(async () => {
  const res = await $api.GetActiveTags({ scope: 'vehicle' })
  if (res.status.code === 200) activeVehicleTags.value = res.data.tags
})

const tagIndex = computed(() => buildTagIndex(activeVehicleTags.value))
const tagSurcharge = computed(() => calcTagSurcharge(selectedTagIds.value, tagIndex.value).surcharge)

// 既有 fare summary 計算 + tagSurcharge
const finalTotal = computed(() => baseFare.value + tagSurcharge.value - discountAmount.value)
```

### 4.4 確認下單

`ClickConfirmOrder()` 流程修改：
1. 在送 `$api.CreateOrder({...既有, preferences: { tagIds: selectedTagIds.value } })` 前 client 端再 validate 一次（防呆）
2. server 接到 → re-validate + snapshot
3. 成功 → 訂單詳情頁顯示偏好

### 4.5 訂單詳情頁

`app/pages/orders/[id].vue`：
- 在既有 fare summary 區下方加「您的偏好」section
- 顯示 `order.preferences.tagSnapshot` chip list（依群組分區）
- 顯示 `order.preferences.tagSurcharge`（若 > 0）

Admin 訂單詳情頁同樣顯示（為 1E 配對 admin 看「乘客要什麼」做準備）。

## 5. i18n

```js
// zh
booking.preferences: {
  title: '期望特徵（可選）',
  hint: '勾選想要的車輛特色，配對時會優先考慮',
  singleHint: '單選',
  multiHint: '多選',
  selectedCount: '已選 {count} 項',
  surchargeRow: '喜好標籤加價',
  surchargeDetail: '此價格為您勾選標籤中加價最高的一項；其餘附贈',
  yourPreferences: '您的偏好',
  noPreferences: '無偏好設定',
}

// en
booking.preferences: {
  title: 'Preferences (optional)',
  hint: 'Choose your preferred vehicle features; we will prioritize during matching',
  singleHint: 'Single choice',
  multiHint: 'Multi choice',
  selectedCount: '{count} selected',
  surchargeRow: 'Preference surcharge',
  surchargeDetail: 'Surcharge equals the highest among your selections; others are complimentary',
  yourPreferences: 'Your Preferences',
  noPreferences: 'No preferences',
}

// ja（同結構，自行翻譯）
```

## 6. Tests

### 6.1 Unit
- `shared/pricing.spec.ts` 加 7+ case（見 §1.2）
- `shared/orderPreferences.spec.ts` 新檔，覆蓋：
  - 空 input → empty snapshot
  - 正常 → tagSnapshot 排序、surcharge=max
  - 含 invalid → invalid 不入 snapshot
  - 三語 name fallback

### 6.2 Integration
- server `orders.post.ts` smoke：帶 preferences 建單 → doc 內有 preferences；改 tag price → 重讀舊單不變

### 6.3 E2E
- 留 1G

## 7. 設計權衡與已知陷阱

1. **取 max 而非 sum**：若 admin 想藉「多 nice-to-have = 多收錢」鼓勵升級，這策略反方向。但拍版已定，後續若要改 sum 只需改 `calcTagSurcharge` 一處。
2. **driver-scope 不收費**：driverSkill（英文 / 商務）不影響定價，純為配對輔助。Phase 1E 配對時用。
3. **archived 標籤在訂單建立後改加價**：snapshot 鎖死，但若 admin 將原本 +600 的 tag archive 並重建 +1000，舊單仍按 +600 收。
4. **booking 頁載入 active tags 的時點**：onMounted 一次性載入；若 admin 在 booking 過程中改 tag，user refresh 才會看到。可接受（早期階段量不大）。
5. **PassengerTagPreferencePicker 與 1B DriverTagGroupPicker 不複用**：雖然行為類似，但乘客版要顯示加價金額、樣式對齊 cream theme、單選互斥取消邏輯不同（passenger 預設可全部不選）。**新建避免動 1B driver 端**。
