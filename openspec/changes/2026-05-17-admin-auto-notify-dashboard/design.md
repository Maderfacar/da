# 管理員自動通知 + Admin Dashboard — 設計文件

> 日期：2026-05-17
> 狀態：設計提案（待 Brain AI 拍板結尾決策點）

## 1. 目標與範圍

讓系統在三個關鍵事件發生時，自動以 LINE 推播通知具訂單管理權限的管理員；並新增一個只顯示「線上名單」的 admin dashboard。

範圍見 `proposal.md`。本文聚焦資料模型、收件人解析、推播實作、Dashboard 查詢。

## 2. 已拍板決策（Brain AI 已確認）

| 決策 | 結論 |
|---|---|
| 推播 OA channel | 共用 passenger OA |
| 收件人權限 | `canManageOrders` |
| 狀態更新範圍 | 全部狀態變更都推，含操作者本人 |
| 線上判定門檻 | 5 分鐘內活躍 |
| Dashboard 第一版 | 只做線上名單，不做待辦統計卡 |

## 3. Part A：管理員自動推播

### 3.1 收件人解析 — `server/utils/admin-recipients.ts`

`admins` collection：doc id = lineUid，欄位含 `level`（`super`/`admin`/`assistant`）、`permissions`（`Record<Permission,boolean> | null` 細粒度 override）。

`require-permission.ts` 既有的 `hasPermission(auth, perm)` 吃的是 `AuthOk`，不適用於「逐筆 admin doc 判定」。新增一個純函式，輸入 admin doc data、輸出是否具權限，邏輯與 `LEVEL_TABLE` + override 完全對齊：

```typescript
// server/utils/admin-recipients.ts
import type { Firestore } from 'firebase-admin/firestore';
import { LEVEL_TABLE, type Permission } from '@@/utils/require-permission';

type AdminLevel = 'super' | 'admin' | 'assistant';

/** 依 admin doc 的 level + permissions override 判定單一權限（與 hasPermission 同邏輯） */
function adminDocHasPermission(
  data: { level?: string; permissions?: Record<string, boolean> | null },
  perm: Permission,
): boolean {
  const level = data.level as AdminLevel | undefined;
  if (!level || !(level in LEVEL_TABLE)) return false;
  const override = data.permissions?.[perm];
  if (typeof override === 'boolean') return override;
  return LEVEL_TABLE[level].has(perm);
}

/** 回傳所有具指定權限的 admin lineUid（= admins doc id） */
export async function getAdminRecipients(
  db: Firestore,
  perm: Permission,
): Promise<string[]> {
  const snap = await db.collection('admins').get();
  return snap.docs
    .filter((d) => adminDocHasPermission(d.data(), perm))
    .map((d) => d.id);
}
```

> 設計取捨：直接 `.get()` 全表後在記憶體 filter。`admins` 是極小集合（個位數～數十筆），不值得為 `level` / `permissions` 建複合查詢；且 `permissions` override 是 map 欄位，Firestore 無法用單一 where 表達「override 優先於 level 預設」的邏輯。

### 3.2 推播分派 — `server/utils/notify-admins.ts`

`sendLinePush(client, to, messages)` 簽名：單一收件人、`Promise<void>`、內部 catch（silent fail，失敗寫 `line_api_errors`）。

`notifyAdmins` 解析收件人後逐一推播，整體 fire-and-forget：

```typescript
// server/utils/notify-admins.ts
import type { Firestore } from 'firebase-admin/firestore';
import { sendLinePush, type LineMessage } from '@@/utils/line-push';
import { getAdminRecipients } from '@@/utils/admin-recipients';

/**
 * 推播給所有具 canManageOrders 的 admin（passenger OA）。
 * 整體 fire-and-forget：呼叫端用 void 包起來，不阻塞、不影響主流程。
 * 個別 admin 推播失敗由 sendLinePush 內部吞掉並寫 line_api_errors。
 */
export async function notifyAdmins(db: Firestore, messages: LineMessage[]): Promise<void> {
  const recipients = await getAdminRecipients(db, 'canManageOrders');
  await Promise.allSettled(
    recipients.map((uid) => sendLinePush('passenger', uid, messages)),
  );
}
```

### 3.3 三個觸發點接入

所有觸發點都在「主資料寫入成功後」追加 `void (async () => { ... })()`，與既有乘客推播並列、互不影響。

| 觸發點 | 檔案 | 接入位置 |
|---|---|---|
| 訂單新增（乘客） | `orders/index.post.ts` | Firestore 寫入成功後，現有乘客推播 block（L271-298）旁 |
| 訂單新增（admin 手動） | `admin/orders/index.post.ts` | 訂單寫入成功後 |
| 訂單狀態更新 | `orders/[orderId].patch.ts` | `ref.update(updates)` 後（L332 後），現有乘客推播 block（L429-491）旁 |
| 司機提交申請 | `driver/apply.post.ts` | `driverRef.set(...)` 後（L202 後），現有司機推播（L205-208）旁 |

範例（訂單新增）：

```typescript
// orders/index.post.ts — 既有乘客推播 block 之後追加
void (async () => {
  try {
    const text = getAdminNotifyMessage('adminNotify.orderCreated', {
      orderId: orderId.slice(0, 8).toUpperCase(),
      pickup: body.pickupLocation.address,
      date: body.pickupDateTime.replace('T', ' ').slice(0, 16),
    });
    await notifyAdmins(db, [{ type: 'text', text }]);
  } catch (err) {
    console.error('[orders/post] admin notify failed:', err);
  }
})();
```

### 3.4 文案 — i18n hard-code（不走模板化）

admin 通知是內部維運訊息，不需 admin 在後台編輯，**不進 `notification-templates`**。新增一個輕量 helper 取三語文案，依「收件 admin 的 lang」選語系：

- 既有 `getUserLang(db, lineUid)` 可取使用者語系；admin 也是 LINE 使用者，沿用
- 簡化做法：`notifyAdmins` 對每位 admin 各自取 lang → 組對應語系 text → 個別推播
- fallback：取不到 lang → `zh_tw`

i18n 新增鍵（`adminNotify.*`，三語對齊）：

| 鍵 | 內容（zh）骨架 |
|---|---|
| `adminNotify.orderCreated` | 🆕 新訂單 {orderId}｜{date}｜{pickup} |
| `adminNotify.orderStatusChanged` | 🔄 訂單 {orderId} 狀態：{from} → {to} |
| `adminNotify.driverApplied` | 🧑‍✈️ 司機申請待審：{name}｜{vehicleType} |

> 文案內的 LINE 訊息用純 `text`（非 Flex），陽春版足夠；訂單狀態名稱以三語對照表轉譯。

### 3.5 訂單狀態列舉

`orders/[orderId].patch.ts` 7 個狀態：`pending` / `confirmed` / `en_route` / `arrived_pickup` / `in_transit` / `completed` / `cancelled`。狀態更新通知會帶 `from → to`，皆需三語名稱對照（i18n `orderStatus.*` 若已存在則複用，否則新增）。

## 4. Part B：Admin Dashboard

### 4.1 線上名單 API — `server/routes/nuxt-api/admin/dashboard/online.get.ts`

```
GET /nuxt-api/admin/dashboard/online
```

權限：admin role 即可（read-only 維運總覽，不過度收斂；非 `canManageOrders` gate）。

邏輯：

```typescript
const cutoff = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);

const [passengersSnap, driversSnap] = await Promise.all([
  db.collection('users').where('lastSeenAt', '>=', cutoff).get(),
  db.collection('drivers').where('lastActiveAt', '>=', cutoff).get(),
]);
```

回應（統一響應格式 `{ data, status }`）：

```typescript
{
  data: {
    passengers: { count: number; list: OnlineUser[] },
    drivers:    { count: number; list: OnlineDriver[] },
    generatedAt: string,  // ISO，供前端顯示「資料時間」
  }
}

OnlineUser   = { uid, displayName, pictureUrl, lastSeenAt }
OnlineDriver = { uid, displayName, pictureUrl, lastActiveAt, driverStatus }
```

`lastSeenAt` / `lastActiveAt` 為 range query，Firestore 單欄位自動索引，無需建複合索引。

### 4.2 ⚠️ 已知限制：乘客 `lastSeenAt` 只在登入時更新

`users.lastSeenAt` 目前**僅由 `auth/line-exchange.post.ts` 在 LINE 登入交換時寫入**。因此「5 分鐘內線上乘客」實際語意為「5 分鐘內曾登入的乘客」，不是真正的即時在線。

司機 `drivers.lastActiveAt` 則由 status 變更 / GPS 上報持續更新，語意較接近真實在線。

→ 見結尾決策點 D2。

### 4.3 頁面 — `app/pages/admin/dashboard.vue`

- `back-desk` layout，SFC 結構依 `CLAUDE.md`（Pug template + SCSS scoped）
- 兩張卡：線上乘客、線上司機，各顯示數量 + 名單（頭像 + 名稱 + 活躍時間相對值）
- 30 秒 `setInterval` 輪詢 `online.get`，`onUnmounted` 清除
- 載入 / 空狀態 / 錯誤狀態處理
- 函式命名依慣例：`ApiGetOnline`、`RefreshFlow`

### 4.4 導覽選單

`app/layouts/back-desk.vue` 的 `ALL_NAV_ITEMS`（L21-31）新增：

```js
{ id: 'dashboard', icon: '📊', label: '儀表板', path: '/admin/dashboard' }
```

排序置於選單最前（dashboard 通常為首頁性質）。

## 5. 安全與品質

- 收件人解析、推播 util 皆 server-side；不暴露 admin 名單給前端
- Dashboard API 經 `getAuthFromEvent` + admin role 檢查
- 推播全程 fire-and-forget，任何失敗不影響訂單 / 申請主流程
- 單元測試：`adminDocHasPermission`（level × override 矩陣）、線上門檻邊界

## 6. 待 Brain AI 拍板的決策點

| # | 決策 | 選項 | 建議預設 |
|---|---|---|---|
| D1 | admin 手動建單（`admin/orders/index.post.ts`）是否也推 admin 通知 | 推 / 不推 | **推**（與「全部都推」一致） |
| D2 | 乘客 `lastSeenAt` 只在登入更新（見 4.2），是否補一個輕量 heartbeat（在常打的乘客 API 順手刷新 `lastSeenAt`） | A 接受限制陽春版 / B 補 heartbeat | **A**（陽春版接受；dashboard 文案標註「資料時間」） |
| D3 | admin 通知文案語系 | 依各 admin lang / 一律繁中 | **依各 admin lang，fallback 繁中** |
| D4 | Dashboard API 權限 | 任何 admin role / `canManageOrders` | **任何 admin role**（read-only 總覽） |

> 預設值已寫入本文。Brain AI 若照單全收，開工即用預設啟動。
