# Design — admin-orders-dispatch-tiers

> 技術細節文件：schema / 流程 / 狀態機 / migration / 風險。對應 5 phase 拆解見 `tasks.md`。

## 1. Schema 變動

### 1.1 Order doc 新增 `dispatchVisibility`

位置：`orders/{orderId}.dispatchVisibility`

```ts
type DispatchLevel = '0' | '1' | '2'; // 與 driverCategory 對齊

interface DispatchVisibility {
  startLevel: DispatchLevel;          // admin 發布時選的首發等級
  currentLevel: DispatchLevel;        // 目前開放等級（含以下：currentLevel=1 → 1 與 2 都看得到）
  openedAt: FirebaseFirestore.Timestamp; // 當前等級開放時間（每次降級重置）
  levelHistory: Array<{
    level: DispatchLevel;
    openedAt: FirebaseFirestore.Timestamp;
    openedBy: 'system' | string;       // system = lazy 自動降級；string = adminId
    reason: 'init' | 'auto-downgrade' | 'manual-downgrade' | 'force-open-all';
  }>;
}
```

**初值寫入時機**：
- 首發（`dispatch.post.ts`）：`startLevel = 表單選的等級`，`currentLevel = startLevel`，`openedAt = serverTimestamp`，`levelHistory = [{level: startLevel, openedAt, openedBy: adminId, reason: 'init'}]`
- 重發（`redispatch.post.ts`）：`currentLevel = startLevel`（重置），新 push 一筆 `{level: startLevel, openedAt: serverTimestamp, openedBy: adminId, reason: 'init'}`

**Migration backfill**：既有訂單 `dispatchVisibility = { startLevel: '0', currentLevel: '0', openedAt: order.dispatchAt || order.createdAt, levelHistory: [{level: '0', openedAt, openedBy: 'system', reason: 'init'}] }`，等於全開（避免上線後既有訂單突然沒人看到）。

### 1.2 driverCategory enum 語意化

位置：`shared/types/driver-category.ts`（🆕）

```ts
export const DRIVER_CATEGORY = {
  NOVICE: '0',   // 新註冊預設、未驗證夠多趟
  STANDARD: '1', // 一般司機
  PRO: '2',      // 高品質司機（評分高 / 趟數多）
} as const;

export type DriverCategory = typeof DRIVER_CATEGORY[keyof typeof DRIVER_CATEGORY];

export const DRIVER_CATEGORY_LABEL: Record<DriverCategory, { zh: string; en: string; ja: string }> = {
  '0': { zh: '新手', en: 'Novice', ja: '新人' },
  '1': { zh: '標準', en: 'Standard', ja: '標準' },
  '2': { zh: '高級', en: 'Pro', ja: 'プロ' },
};
```

**升級規則 stub**（未實作，留 hook）：

```ts
/**
 * TODO（日後 phase）：依下列 metric 自動升級
 *  - tripCount: 完成趟數 ≥ 50 → 1, ≥ 200 → 2
 *  - distanceKm: 累積里程 ≥ 1000 → 1, ≥ 5000 → 2
 *  - rating: 平均評分 ≥ 4.5 → 至少 1, ≥ 4.8 → 至少 2
 *  - 三 metric 取 AND（同時滿足才升），admin 仍可手動覆寫
 *  - 觸發時機：訂單 completed 寫入時掛 trigger（Firestore function or hot path）
 */
```

第一版只有 admin 手動，spec 留 hook 便於日後接。

### 1.3 line_templates 加 entry

位置：`line_templates/dispatch.level-down`

| 欄位 | 說明 |
|---|---|
| `category` | `dispatch` |
| `subcategory` | `level-down` |
| `flex` | Flex Message JSON，含 placeholder：`{{orderId}}` / `{{orderType}}` / `{{dropoffArea}}` / `{{fareEstimate}}` / `{{etaWindow}}` / `{{newLevel}}` |
| `text` | 純文字 fallback（無 Flex 時用） |
| `lang.zh_tw` / `lang.en` / `lang.ja` | 三語版本 |
| `requiresSuperLevel` | `false`（admin 可編輯） |

預設文本（zh）：「📢 新需求單已開放給您！\n單號：{{orderId}}\n類型：{{orderType}}\n目的地：{{dropoffArea}}\n預估車資：NT$ {{fareEstimate}}\n出發時間：{{etaWindow}}\n\n👉 點此查看詳情」

## 2. 司機端 Filter 邏輯

### 2.1 Server-side filter (`dispatched-orders.get.ts`)

```ts
// 既有：limit(300) + orderBy('createdAt', 'desc') 之後在 memory filter
const driverDoc = await db.collection('drivers').doc(uid).get();
const driverCategory = driverDoc.data()?.driverCategory ?? '0';

const visibleOrders = pendingOrders.filter(order => {
  const orderLevel = order.dispatchVisibility?.currentLevel ?? '0'; // backfill safety
  return driverCategory >= orderLevel; // string compare OK because '0'/'1'/'2'
});
```

**核心原則**：不符合等級的司機在此就被過濾，client UI 根本拿不到資料 → 不存在「點搶但被拒」的 UX flow。

### 2.2 Bid endpoint 守則 (`bid.post.ts`)

Transaction 內：

```ts
const order = txn.get(orderRef);
const driver = txn.get(driverRef);

if (driver.driverCategory < order.dispatchVisibility.currentLevel) {
  // anomaly: 正常 client 不會走到這 (因為 server filter 已過濾)
  await logAnomalyAsync({
    type: 'bid.level-mismatch',
    driverId: uid,
    driverCategory: driver.driverCategory,
    orderId,
    orderCurrentLevel: order.dispatchVisibility.currentLevel,
  });
  return forbiddenError({ zh_tw: '...', en: '...', ja: '...' });
}
```

**不做 client toast UX**（Brain AI 拍板：client 根本看不到該訂單，這守則純粹防直打 API）。

## 3. 降級狀態機（Phase 2D）

### 3.1 三種觸發

```
                ┌─────────────┐
   admin click  │ currentLevel│  driver GET
                │      = 2    │   (lazy)
                └──────┬──────┘
                       │
        ┌──────────────┼─────────────────┐
        ▼              ▼                 ▼
  manual-downgrade  auto-downgrade  force-open-all
  (admin 點按鈕)    (now > openedAt   (admin 點全開放)
                    + duration[2])
        │              │                 │
        ▼              ▼                 ▼
                ┌─────────────┐
                │ currentLevel│
                │      = 1    │
                └──────┬──────┘
                       │
        ┌──────────────┴─────────────────┐
        ▼              ▼                 ▼
  manual-downgrade  auto-downgrade  force-open-all
        │              │                 │
        ▼              ▼                 ▼
                ┌─────────────┐
                │ currentLevel│   (終態，不再降)
                │      = 0    │
                └─────────────┘
```

### 3.2 OrderType 等級間距 config

位置：`server/utils/dispatch-duration.ts`（🆕）

```ts
const DISPATCH_DURATION: Record<OrderType, { '2->1': number; '1->0': number }> = {
  'airport-pickup':  { '2->1': 180,  '1->0': 300 },   // 3 分 / 5 分
  'airport-dropoff': { '2->1': 180,  '1->0': 300 },
  'transfer':        { '2->1': 480,  '1->0': 720 },   // 8 分 / 12 分
  'charter':         { '2->1': 1800, '1->0': 3600 },  // 30 分 / 60 分
};

export function getNextDowngradeAt(orderType: OrderType, currentLevel: DispatchLevel, openedAt: Timestamp): Timestamp | null {
  if (currentLevel === '0') return null; // 終態
  const key = currentLevel === '2' ? '2->1' : '1->0';
  const duration = DISPATCH_DURATION[orderType][key];
  return Timestamp.fromMillis(openedAt.toMillis() + duration * 1000);
}
```

第一版 hard-code，日後可搬 Firestore config doc。

### 3.3 Lazy check 流程（在 `dispatched-orders.get.ts` 內）

```ts
for (const order of pendingOrders) {
  const nextDowngradeAt = getNextDowngradeAt(
    order.orderType,
    order.dispatchVisibility.currentLevel,
    order.dispatchVisibility.openedAt,
  );
  if (nextDowngradeAt && Date.now() > nextDowngradeAt.toMillis()) {
    // Atomic transaction：避免兩個司機同時 GET 觸發兩次降級
    await db.runTransaction(async txn => {
      const fresh = await txn.get(order.ref);
      const freshLevel = fresh.data()?.dispatchVisibility?.currentLevel;
      if (freshLevel !== order.dispatchVisibility.currentLevel) return; // 已被另一 request 降過
      const newLevel = (parseInt(freshLevel) - 1).toString() as DispatchLevel;
      txn.update(order.ref, {
        'dispatchVisibility.currentLevel': newLevel,
        'dispatchVisibility.openedAt': FieldValue.serverTimestamp(),
        'dispatchVisibility.levelHistory': FieldValue.arrayUnion({
          level: newLevel,
          openedAt: Timestamp.now(),
          openedBy: 'system',
          reason: 'auto-downgrade',
        }),
      });
    });
    // Fire-and-forget LINE multicast 給新加入等級的司機
    await multicastByLevel(order.id, newLevel, 'dispatch.level-down');
  }
}
```

**Race condition 防範**：transaction 內 re-fetch + compare currentLevel，若已被其他 request 降過則跳過。

### 3.4 Multicast helper

位置：`server/utils/order-dispatch.ts`

```ts
export async function multicastByLevel(orderId: string, level: DispatchLevel, template: string) {
  // 載入 driverCategory >= level 的 approved drivers
  const drivers = await db.collection('drivers')
    .where('approved', '==', true)
    .where('driverCategory', '>=', level)
    .get();

  const lineIds = drivers.docs.map(d => d.data().lineId).filter(Boolean);

  // 載入 template + 渲染 + multicast
  const tpl = await loadTemplate(template);
  const message = renderTemplate(tpl, await loadOrder(orderId));
  await lineClient.multicast(lineIds, message);
}
```

**注意**：Firestore `where('driverCategory', '>=', level)` 對 `'0'/'1'/'2'` 字串比較 OK（字典序），日後若改數字型別需同步調整。

## 4. Tag 後修 + 車資重算（Phase 1C）

### 4.1 Endpoint：`PATCH /nuxt-api/admin/orders/[orderId]`（既有 endpoint 擴充）

Body：
```ts
{
  preferences?: {
    tagIds: string[];
  };
  // ...其他可編欄位
}
```

流程：
1. 讀 order doc，狀態守則檢查（`pending` / `dispatched` 可改，`assigned` 後 403）
2. 重 snapshot：`buildPreferencesSnapshot(tagIds, await loadActiveTagsCache(db))`（複用 Phase 1D helper）
3. 計算新 `tagSurcharge = max(snapshot.surchargeAmount)`
4. 重檢折扣碼：
   - 若 order 有 `discountCodeId`，重 load 折扣碼 doc
   - 若 expired or notUsable → `discountAmount` 維持原值 + response 加 `warning: 'discount_expired_fallback'`
   - 若仍有效 → 重算 discount
5. 計算新 fare：`finalTotal = baseFare + tagSurcharge - discountAmount`
6. Audit log: `action='order.tag-update.price-recalc'`，含 `before: { tagIds, fare, tagSurcharge, discountAmount }` + `after: { ... }` + `diff`
7. 寫回 order doc
8. **不**通知乘客（無 LINE push）

### 4.2 Dry-run 預覽 endpoint：`POST /nuxt-api/admin/orders/[orderId]/recalc-preview`（🆕）

同樣流程但不寫資料庫，回傳：
```ts
{
  before: { fare, tagSurcharge, discountAmount, finalTotal },
  after:  { fare, tagSurcharge, discountAmount, finalTotal },
  diff:   { fare: 0, tagSurcharge: 50, discountAmount: -20, finalTotal: 70 },
  warnings: ['discount_expired_fallback'] // 可選
}
```

Admin UI：改動 tag → call preview → 顯示差價卡片 → `UseAsk()` 確認 → 才 call 真 PATCH。

### 4.3 Fare V2 重算公用 util

**前置調查**：Phase 1C 第一個動作是讀 `shared/pricing.ts` 確認 Fare V2 既有 `calcFare` / `calcFareV2` 是否易於從 `[orderId].patch.ts` 呼叫。

若既有為 inline 寫死在 `orders/index.post.ts`（建單流程），需先抽 `shared/fare/calculate.ts` 或 `server/utils/fare-calculator.ts` 公用 util，並確保 `orders/index.post.ts` 也改用此 util（避免兩處邏輯漂移）。

## 5. Migration（Phase 2B+2C）

### 5.1 一次性 backfill script

位置：`server/scripts/backfill-dispatch-visibility.ts`（🆕）

流程：
1. Query 所有 `orders` collection（含 archived）
2. 對每筆 doc：若 `!dispatchVisibility` → batch update 寫入：
   ```ts
   {
     dispatchVisibility: {
       startLevel: '0',
       currentLevel: '0',
       openedAt: doc.dispatchAt ?? doc.createdAt,
       levelHistory: [{
         level: '0',
         openedAt: doc.dispatchAt ?? doc.createdAt,
         openedBy: 'system',
         reason: 'init',
       }],
     }
   }
   ```
3. Batch size 500（Firestore 限制）
4. Dry-run 模式（`--dry-run` flag）只 log 不寫
5. 完整模式 log 每筆 doc.id + 結果

執行順序：
- Step 4 視窗：本機 dev `pnpm tsx server/scripts/backfill-dispatch-visibility.ts --dry-run` → 確認 count
- 真實執行：`pnpm tsx server/scripts/backfill-dispatch-visibility.ts` → 由 Claude 用 firebase MCP 跑 prod migration

### 5.2 部署順序（critical）

1. 先 deploy code（含 filter + bid 守則 + multicastByLevel）
2. **再** 跑 backfill migration
3. 否則：deploy 後若 backfill 未跑，既有訂單 `dispatchVisibility=undefined` → filter 取 fallback `'0'` → 全開放，等同無變化（safe）
4. 但若先跑 migration 沒 deploy 新 code，新欄位寫進去但未被讀，無風險

**結論**：先 deploy code，再跑 migration（更乾淨）。

## 6. UI 規格

### 6.1 admin/orders 列表 action column（Phase 1A）

```pug
.PageAdminOrders__action
  template(v-if='!row.dispatchAt')
    ElButton(@click='ClickDispatchFlow(row)') 📤 {{ $t('admin.orders.dispatch') }}
  template(v-else-if='!row.assignedDriverId')
    ElButton(@click='ClickRedispatchFlow(row)')
      | 🔁 {{ $t('admin.orders.redispatch') }}
      ElTag(v-if='row.dispatchCount > 1') ×{{ row.dispatchCount }}
  span(v-else)
    | ✓ {{ $t('admin.orders.assigned') }}
```

### 6.2 admin/orders Edit modal — tag 後修區塊（Phase 1C）

```pug
.OrderEdit__tags
  h4 {{ $t('admin.orders.preferences') }}
  PassengerTagPreferencePicker(v-model='form.preferences.tagIds')
  .OrderEdit__price-preview(v-if='hasChange')
    .row 原價：NT$ {{ before.finalTotal }}
    .row 新價：NT$ {{ after.finalTotal }}
    .row.diff(:class='{ up: diff > 0, down: diff < 0 }')
      | 差額：{{ diff > 0 ? '+' : '' }}NT$ {{ diff }}
    .warning(v-if='warnings.includes("discount_expired_fallback")')
      | ⚠️ {{ $t('admin.orders.discountExpiredWarning') }}
  ElButton(@click='ClickSaveTagsFlow' :disabled='!hasChange') {{ $t('admin.orders.confirmTagUpdate') }}
```

### 6.3 admin/orders 發布表單 — 首發等級 select（Phase 2B+2C）

```pug
.DispatchForm__level
  ElSelect(v-model='form.startLevel')
    ElOption(value='2' label='高級司機優先（pro）')
    ElOption(value='1' label='中級起（standard+）')
    ElOption(value='0' label='全車隊（all approved）')
    ElOption(value='__draft__' label='暫不發布（save only）')
```

`__draft__` 選項 → 不 call dispatch endpoint，只儲存其他欄位。

### 6.4 admin/orders 列表 — 立即降級 / 全開放按鈕（Phase 2D）

```pug
.PageAdminOrders__dispatch-actions(v-if='row.dispatchAt && !row.assignedDriverId')
  ElButton(
    @click='ClickDowngradeFlow(row)'
    :disabled='row.dispatchVisibility.currentLevel === "0"'
  ) ⬇️ {{ $t('admin.orders.downgradeNow') }}
  ElButton(
    @click='ClickForceOpenFlow(row)'
    :disabled='row.dispatchVisibility.currentLevel === "0"'
  ) 🔓 {{ $t('admin.orders.forceOpenAll') }}
```

### 6.5 driver/dispatched 訂單卡 — 即將降級倒數（Phase 2B+2C）

```pug
.OrderCard__countdown(v-if='nextDowngradeAt')
  | 倒數 {{ formatCountdown(nextDowngradeAt) }}
  | 後將開放給更多司機
```

`formatCountdown` 用 `useTimer` composable 每秒更新，到 0 顯示「即將降級」並等下次 GET 觸發 lazy。

## 7. 風險清單

| # | 風險 | 緩解 |
|---|---|---|
| 1 | Fare V2 既有 calculate 函式為 inline 寫死，抽 util 工程量超預期 | Phase 1C 第一步先讀 `shared/pricing.ts` 確認，必要時拆兩個 commit（抽 util + 後修流程） |
| 2 | Migration backfill 漏掉某些 archived 訂單 | dry-run 先 count 對齊預期；分 batch + log 每筆 |
| 3 | Lazy check 在低流量時段（深夜）無司機 GET → 訂單卡在 currentLevel 不降 | Brain AI 接受（admin 可手動降級）；日後若必要加 cron / cloud function trigger |
| 4 | Multicast 對全 driverCategory>=level 司機推送，可能噪音 | 已是 Phase 2 of phase 2 目標（分級就是要減噪音）；若仍多，日後加 quiet hours / per-driver opt-out |
| 5 | bid 守則 race condition：lazy check 降級瞬間司機點搶 | transaction 內 re-fetch driver.category + order.currentLevel 比對，safe |
| 6 | 既有 fare V2 重算邏輯被 trigger 多次（admin 改 tag 多次）造成 discount code usage count 重複扣 | discount code 重算只算結果，不重新「使用」（不寫 usage_count）；若改動需要重算 discount 還可用，只觸發 read |
| 7 | admin 改 tag 時訂單已在司機 app 顯示中，司機看到的價格不同步 | 不通知乘客也不通知司機（Brain AI 拍板）；司機下次 refresh 會看到新價 |
| 8 | LINE template 數量已多，加 1 個是否超出某 quota | line_templates 為 Firestore collection 無 quota；admin/templates UI 自動列出 |

## 8. 與既有系統交互

| 既有系統 | 交互 |
|---|---|
| Fare V2 | 1C 重算呼叫；可能需要抽 util |
| Tag pricing (Phase 1D) | 1C tag 編輯複用 `buildPreferencesSnapshot` / `calcTagSurcharge` |
| Discount codes | 1C 重檢時讀；不重複扣 usage |
| LINE template system (W1-W8) | 2D 加 1 entry，admin UI 自動列出 |
| Audit log | 1C / 2A / 2D 都寫 |
| P18 collection split | 讀 `drivers/{uid}.driverCategory` 不寫 schema 變動 |
| Diagnostics (P43) | Anomaly log 用既有 `line_api_errors` 或新加 `dispatch_anomalies`？→ 用 `line_api_errors` 既有 collection（避免新增） |

## 9. 不做（Non-goals）

- ❌ 自動升級規則實作（只留 spec stub）
- ❌ Settings UI 調整 duration（hard-code 在 server util）
- ❌ Cron / scheduled function 主動降級（lazy + manual 夠用）
- ❌ 全開放後再次提示 admin（第一版略）
- ❌ 通知乘客 tag 變動 / 司機降級（admin 後台行為）
- ❌ Per-driver opt-out / quiet hours（日後若噪音問題明顯再加）
