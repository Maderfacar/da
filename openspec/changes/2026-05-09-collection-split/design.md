# Design — P18 Collection Split

## Context

DestinationAnywhere 是 Nuxt 4 + Firebase Firestore + LINE LIFF 的訂車平台。當前資料模型：
- `users/{lineUid}` 一個文件裝所有身分資料（passenger / driver / admin 三端混雜）
- `drivers/{driverId}` 獨立 collection 但只裝即時位置（driverId 為 `line:Uxxx` 格式）

P14 後 server-side 全部走 require-auth + ID token 驗證，Firestore 為 source of truth。
P17 後 userId 統一用「不帶 line: prefix 的 LINE userId」（與 users document key 對齊）。

本次重構基於兩個核心需求：
1. driver 將累積大量營運資料（累程 / 訂單 / 金額 / 評分）
2. admin 需要三層分權（super / admin / assistant）

## Goals

- `drivers/{lineUid}` 獨立 collection，整合即時狀態與營運統計
- `admins/{lineUid}` 獨立 collection，含 level 與 permission 機制
- `users.roles[]` 仍是身分認證唯一來源（middleware / require-auth 不改）
- 所有改動 zero-downtime（migration 期間既有功能正常）
- 既有測試資料能無痛搬家（因尚無 production 資料，手動 Firebase Console 操作即可）

## Non-Goals

- **不**改變 LINE LIFF 認證流程（line-exchange / Firebase custom token）
- **不**改變 roles[] 的設計（單一陣列，passenger 為基礎身分）
- **不**做進階 permission overrides（第一版 level 對應寫死的權限表，未來再加 permissions 欄位）
- **不**做 admin 操作日誌（audit log 屬下一階段）
- **不**做分區管理（`drivers.assignedRegions` 欄位預留但不實作邏輯）
- **不**做評分系統（`drivers.rating` 欄位預留但 server 不寫入）
- **不**自動 migration script（測試階段資料量小，使用者手動操作 Firebase Console，附詳細指引）

## Decisions

### 決策 1：drivers / admins 採用「同 key 對應」而非「外鍵關聯」

**選擇**：`drivers/{lineUid}` 與 `admins/{lineUid}` 的 document ID 與 `users/{lineUid}` 完全相同。

**替代方案**：
- 自動產生 driverId / adminId（UUID）+ users 內存 driverId 欄位 → 多一層 lookup，無實際好處
- 用 lineUserId（不帶 prefix）統一作為 key → 與 users 一致

**理由**：lookup 一次即可（read users/{uid} 取 roles → 同 key 直接 read drivers/{uid} 或 admins/{uid}），無 JOIN 成本。

### 決策 2：roles[] 仍是身分判斷唯一來源；level / permissions 只作為 admin 內部細分

**選擇**：
- middleware/role.ts、require-auth：只看 `users.roles[]` 判斷三端入口
- 進到 admin 端後的細粒度操作（管理 admin、broadcast、改訂單）：require-permission 看 `admins/{lineUid}.level`

**替代方案**：把 admin level 寫進 `users.roles[]`（如 `roles: ['passenger', 'admin:super']`）→ 違反 single-source 原則，混雜身分與權限

**理由**：身分（roles）與權限（permissions）關注點分離：身分是「能進哪一端」，權限是「能在那一端做什麼」。

### 決策 3：admin level 三層 + 寫死權限表（第一版）

**選擇**：
- level 列舉值：`'super' | 'admin' | 'assistant'`
- `server/utils/require-permission.ts` 內寫死 level → permission 對應表

**對應表**：
| Permission | super | admin | assistant |
|------------|-------|-------|-----------|
| canManageAdmins（加/移管理員、改 level） | ✓ | | |
| canManageDrivers（核准/拒絕/撤銷司機） | ✓ | ✓ | |
| canManageOrders（指派司機、改狀態） | ✓ | ✓ | ✓ |
| canBroadcast（LINE 全員推播） | ✓ | ✓ | ✓ |
| canViewFinance（金流頁面） | ✓ | ✓ | |

**替代方案**：`admins.permissions: { ... }` 自由配置 → 第一版需求單純，過度設計
**理由**：先用 level enum 簡單跑，未來如有「自訂 admin」需求再加 permissions 欄位 override level 預設。

### 決策 4：drivers/{driverId} 即時位置 collection 合併到 drivers/{lineUid}

**選擇**：取消 `drivers/{driverId}` 獨立 collection；位置欄位寫進 `drivers/{lineUid}.location` nested object。

**替代方案**：保留兩個 collection（drivers 統計 + driver_locations 即時位置）→ 一個司機要查兩個 doc，沒實質好處
**理由**：lineUid 與 driverId 本質是同一個 key（都是 line:Uxxx）；位置寫入頻率高（每分鐘）但 doc size 仍小（一個 nested object），同 doc 寫入即可，admin SDK 用 `set({...}, { merge: true })` 不會衝突其他欄位。

### 決策 5：driver/apply 時同步建 `drivers/{lineUid}` 預設文件

**選擇**：driver/apply.post.ts 在 `users.driverApplication` 寫入後，同步 `db.collection('drivers').doc(lineUid).set({...defaults}, { merge: true })`。

**替代方案**：等 admin 核准（approved=true）才建 drivers doc → 邏輯複雜化
**理由**：申請後就建 drivers doc 預設值（status='offline'、totalTrips=0 等），admin 核准後 driver 一登入即可開工，無 race condition。

### 決策 6：require-auth 載入 admin level；require-permission 是另一個 helper

**選擇**：
- `getAuthFromEvent` 增加 `level` 欄位（admin 才有，passenger / driver 為 undefined）：

```ts
interface AuthOk {
  ok: true; uid; lineUid; roles; approved;
  level?: 'super' | 'admin' | 'assistant';   // 新增
}
```

- 新建 `requirePermission(auth, 'canManageAdmins')` 包裝權限判斷：

```ts
const auth = await getAuthFromEvent(event);
if (!auth.ok) return authFailResponse(auth);
if (!hasPermission(auth, 'canManageAdmins')) return forbiddenError(...);
```

**替代方案**：把 permission 檢查塞進 `getAuthFromEvent` → 違反單一職責（auth ≠ authz）
**理由**：clean separation：auth 解 token、查身分；permission 是另一層業務判斷。

### 決策 7：firestore.rules 同步更新

**選擇**：
- `drivers/{driverId}`：原本只給 admin 與 driver 自己讀，**保留現況不改規則**（剛好新 schema 的 doc ID 仍是 `line:Uxxx`，rules 內 `request.auth.uid == driverId` 直接適用）
- `admins/{lineUid}`：新增 rules，admin 可讀所有 admin、admin 自己可讀自己；寫入禁止 client（僅 admin SDK）
- `users/{lineUid}`：不改

**部署**：使用者手動到 Firebase Console → Firestore → Rules 貼上新版

## Driver Schema 細節

```typescript
// drivers/{lineUid}
interface DriverDoc {
  // 身分（與 users 同步，方便獨立查 drivers collection）
  lineUserId: string;
  displayName: string;
  pictureUrl: string;

  // 即時狀態（合併自原 drivers/{driverId} 集合）
  status: 'online' | 'offline' | 'busy';
  location: {
    lat: number;
    lng: number;
    heading?: number;
    updatedAt: Timestamp;
  } | null;

  // 累積統計（admin 看 dashboard、driver 看自己）
  totalTrips: number;       // 累計趟次
  totalEarnings: number;    // 累計收入（NTD）
  totalDistanceKm: number;  // 累計里程
  todayTrips: number;       // 今日趟次（cron 每天歸零或依日期判斷）
  todayEarnings: number;    // 今日收入

  // 業務設定
  driverCategory: '0' | '1' | '2';  // 搶單排序權重（從 users 搬過來）
  vehicleType: 'sedan' | 'mpv' | 'suv' | 'van';  // 從 driverApplication 同步

  // 評分系統（預留欄位，第一版不寫入）
  rating?: number;          // 平均評分（1-5）
  ratingCount?: number;     // 評分次數

  // 分區（預留欄位）
  assignedRegions?: string[];

  // 時間戳
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
  lastTripAt?: Timestamp;
}
```

**寫入時機**：
- 申請時建立預設 doc（driver/apply.post.ts）
- 司機接單完成 → totalTrips++、totalEarnings += fare、totalDistanceKm += km、todayTrips++、todayEarnings += fare、lastTripAt = now（**這部分需在 orders/[orderId].patch.ts 中：當 orderStatus 改為 'completed' 時，依 order.assignedDriverId 取對應 driver doc 並 increment**）
- 位置更新（drivers/[id]/location.put.ts）
- 上下線狀態切換（driver dashboard 操作）

## Admin Schema 細節

```typescript
// admins/{lineUid}
interface AdminDoc {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;

  level: 'super' | 'admin' | 'assistant';

  // 預留：細粒度 permission overrides（第一版不寫入，hasPermission 只看 level）
  permissions?: {
    canManageAdmins?: boolean;
    canManageDrivers?: boolean;
    canManageOrders?: boolean;
    canBroadcast?: boolean;
    canViewFinance?: boolean;
  };

  // 稽核（預留）
  createdBy?: string;       // 哪個 super admin 加的
  createdAt: Timestamp;
  lastLoginAt?: Timestamp;
}
```

**寫入時機**：
- super admin 在 admin/settings 加新 admin：admins/{newUid} 建立 + users/{newUid}.roles arrayUnion('admin')
- super admin 改 level：admins/{uid}.level 更新
- super admin 撤銷：admins/{uid} 刪除 + users/{uid}.roles arrayRemove('admin')
- migration：既有 admin 全部設 super（避免上線後沒人能管理）

## Permission 判斷邏輯

```typescript
// server/utils/require-permission.ts
type Permission =
  | 'canManageAdmins'
  | 'canManageDrivers'
  | 'canManageOrders'
  | 'canBroadcast'
  | 'canViewFinance';

const LEVEL_TABLE: Record<'super' | 'admin' | 'assistant', Set<Permission>> = {
  super: new Set(['canManageAdmins', 'canManageDrivers', 'canManageOrders', 'canBroadcast', 'canViewFinance']),
  admin: new Set(['canManageDrivers', 'canManageOrders', 'canBroadcast', 'canViewFinance']),
  assistant: new Set(['canManageOrders', 'canBroadcast']),
};

export function hasPermission(auth: AuthOk, perm: Permission): boolean {
  if (!auth.roles.includes('admin') || !auth.level) return false;
  // 優先看 admins.permissions overrides（第一版未寫入，全部看 level）
  if (auth.permissions?.[perm] !== undefined) return auth.permissions[perm];
  return LEVEL_TABLE[auth.level].has(perm);
}
```

## Migration 策略

詳見 `migration.md`。重點：
1. 使用者**手動到 Firebase Console** 操作（無 script，因測試階段資料量極小）
2. 順序：先建 admins / drivers，再清舊 driverCategory，最後驗證 require-auth 仍能正確識別 admin
3. 每個既有 admin 帳號的 admins doc 預設 `level='super'`（避免管理員失能）
