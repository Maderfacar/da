# Design — Booking Redesign v2

## Step 3 詳細編排

```
┌────────────────────────────────────────────┐
│  PASSENGERS                                │
│  大人 [- 2 +]    兒童 [- 1 +]             │  ← 兩個 stepper（批次 2 拆）
│  ※ 批次 1 暫保留 passengerCount 單一 stepper│
├────────────────────────────────────────────┤
│  LUGGAGE                                   │
│  行李類型 stepper 列表（既有保留）         │
│  SU 總計顯示                               │
├────────────────────────────────────────────┤
│  VEHICLES                                  │
│  ◀  ┌─────────┐ ┌─────────┐ ...  ▶       │  ← 批次 2：slider
│     │ 經濟5座 │ │ 豪華5座 │              │  ← 批次 1：保留 vertical list
│     │ 🚗      │ │ 🚙      │              │
│     │ 1-4 人  │ │ 1-4 人  │              │
│     │ NT$ 800 │ │ NT$ 1200│              │
│     │ +25/km  │ │ +30/km  │              │
│     │ 一般通勤│ │ 商務洽談│ ← tagline    │
│     └─────────┘ └─────────┘              │
├────────────────────────────────────────────┤
│  💡 如有特殊需求請從下方選擇               │  ← 提示文案
├────────────────────────────────────────────┤
│  EXPECTATIONS                              │
│  動力  [純電][油電][汽油][柴油]            │
│  產地  [進口][國產]                        │
│  內裝  [真皮][航空椅][隔音]                │
│  設備  [兒童座椅][寵物][無障礙]            │
│  司機  [英文][日文][商務][女司機]          │
│  （vehicleType group 不顯示）              │
├────────────────────────────────────────────┤
│  [上一步]              [下一步]            │
└────────────────────────────────────────────┘
```

## Step 4 詳細編排

```
┌────────────────────────────────────────────┐
│  CONFIRM ORDER                             │
├────────────────────────────────────────────┤
│  📞 聯絡資訊                               │
│  聯絡人 *                                  │  ← 新欄位
│  [LINE displayName 預填]                   │
│                                            │
│  乘車人 *                                  │  ← 新欄位
│  [____________]  ☑ 同聯絡人               │
│                                            │
│  聯絡電話 * [09xxxxxxxx]                   │  ← 既有
│                                            │
│  備註（小孩需安全座椅、行李較多或          │
│       特殊規格、多人數或特殊接駁需求）     │  ← 新 placeholder
│  [textarea]                                │
├────────────────────────────────────────────┤
│  🎟 折扣碼                                 │
│  [____] [套用]                             │
├────────────────────────────────────────────┤
│  📋 訂單摘要                                │
│  • 訂單類型 / 上下車 / 停靠                 │
│  • 大人 X 位 / 兒童 Y 位 / 行李 N 件        │
│  • 車型 / 期望特徵（chip 列表）             │
│  • 聯絡人 / 乘車人 / 聯絡電話 / 備註        │
│  （不顯：距離 / 時間 / tag 加價明細行 /    │
│   折前折後拆分行）                          │
├────────────────────────────────────────────┤
│  應付車資  NT$ X                           │  ← 一行總價
├────────────────────────────────────────────┤
│  [上一步]      [送出訂單]                  │
└────────────────────────────────────────────┘
```

## 同聯絡人同步邏輯

```typescript
// 預設行為
const sameAsContact = ref(true);

// 聯絡人變動時、若勾選同聯絡人 → 同步乘車人
watch(contactName, (val) => {
  if (sameAsContact.value) passengerName.value = val;
});

// 取消勾選 → 保留現有名字（不清空）、可繼續編輯
// 重新勾選 → 立即同步：passengerName = contactName

// 送出時：
// - 若 sameAsContact && passengerName 為空 → passengerName = contactName
// - 兩個欄位都會送到 server，server 不再做同步
```

## LINE displayName 預填

```typescript
// app/pages/booking/index.vue
const storeSelf = StoreSelf();
const lineDisplayName = computed(() => storeSelf.self?.lineProfile?.displayName ?? '');

// Step 4 mount 時、contactName 為空才預填
onMounted(() => {
  if (!contactName.value && lineDisplayName.value) {
    contactName.value = lineDisplayName.value;
  }
});
```

## Tag 顯示 — Filter vehicleType group

```typescript
// 既有 ApiLoadActiveVehicleTags（app/pages/booking/index.vue）
const ApiLoadActiveVehicleTags = async () => {
  const res = await $api.GetActiveTags('vehicle');
  if (res.status?.code === $enum.apiStatus.success && res.data?.tags) {
    // 新增 filter：booking 端不顯示 vehicleType group
    activeVehicleTags.value = res.data.tags.filter(t => t.group !== 'vehicleType');
  }
};
```

## Schema 變動細節

### FleetVehicle 加 tagline

```typescript
// shared/pricing.ts
export interface FleetVehicle {
  id: string;
  label: I18nLabel;
  capacity: number;
  luggageSU: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  tagline?: I18nLabel;  // 新增、optional、向後相容
}
```

### Order schema 加聯絡人/乘車人

```typescript
// app/protocol/fetch-api/api/order/type.d.ts (CreateOrderParams)
interface CreateOrderParams {
  // ...既有
  contactPhone: string;
  contactName?: string;     // 新增
  passengerName?: string;   // 新增
  notes?: string | null;
}

// Firestore order doc 對應加同名欄位（optional）
```

### Admin Vehicle Payload

```typescript
// server admin vehicles endpoint
interface CreateVehiclePayload {
  // ...既有
  tagline?: I18nLabel;
}
interface UpdateVehiclePayload {
  // ...既有
  tagline?: I18nLabel | null;  // null 表示清除
}
```

## Step 4 移除明細的確切範圍

**保留的 row**：
- 訂單類型 / 航班 / 上車時間
- 上車地點 / 停靠 / 下車地點
- 大人/兒童/行李件數
- 車型名稱 / 期望特徵
- 聯絡人 / 乘車人 / 聯絡電話 / 備註

**移除的 row**：
- 「行駛距離 XX km」
- 「預計時間 XX 分鐘」
- 「喜好標籤加價 +NT$XX」（單獨明細行）
- 「折前 NT$XX」「折扣 -NT$YY」「折後 NT$ZZ」（拆分明細）

**取代為一行**：
- 「應付車資 NT$ X」（X = 最終計算結果 = fareV2.final + tagSurcharge - discount）
- 保留 cashNote「現場以現金支付」

## 批次切分理由

### 批次 1 不做的事

1. **`passengerCount` 拆 `adultCount + childCount`**：跨 server / admin / driver / LINE 通知 / backward-compat / 報表，要全系統 audit。批次 1 保留單一 stepper、欄位用 `passengerCount`。
2. **車型卡 slider**：互動細節（snap / swipe / 1.5 張顯示）需試錯，批次 1 保留 vertical card list。
3. **EnabledExtras 評估**：哪些 extras 移除是產品決策，由 Brain AI 在批次 3 親自評估。

### 批次 1 完成後使用者體驗

- ✅ Step 3 順序對齊新設計
- ✅ 期望特徵 chip 直接顯示（不再摺疊）
- ✅ vehicleType tag 從 chip 消失
- ✅ Step 4 聯絡人/乘車人欄位、總價單行
- ⚠️ 人數仍是單一 stepper（批次 2 拆）
- ⚠️ 車型卡仍是 vertical list（批次 2 改 slider）
- ⚠️ 加值服務區塊可能仍存在（批次 1 移除其呼叫，但 Firestore collection 不動）

## 風險與緩解

1. **既有訂單顯示**：新欄位 optional、舊資料不顯示時 fallback 顯示「-」或空白
2. **車資計算回歸**：批次 1 不動 calc 邏輯，回歸風險低
3. **批次 2 跨系統**：需 audit driver/admin/LINE template，工作量大但範圍清楚
4. **產品操作（批次 3）漏做**：admin 不改 label / tagline 的話、批次 1 的 UI 還是顯舊名稱 — Brain AI 親自完成
