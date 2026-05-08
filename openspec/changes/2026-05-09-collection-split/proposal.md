# P18 Collection Split — drivers + admins 獨立 collection

## Why

目前所有使用者資料（passenger / driver / admin）全部寫在 `users/{lineUid}` 單一 document，隨著功能擴展會出現以下問題：

1. **Document 過於肥大且雜訊多**：driver 的累程 / 訂單統計 / 金額、admin 分權設定都塞 users，optional 欄位過多，閱讀與維護成本上升
2. **Query 寫法受限**：`where('roles', 'array-contains', 'driver').orderBy('totalTrips')` 需要 composite index（P12 才剛踩過 admin/users 的同類問題）
3. **寫入頻率衝突**：司機位置每分鐘寫一次、admin 偶爾改名、passenger 訂車一次，混在同 doc 易產生寫入競爭與成本浪費
4. **Rules 細緻度受限**：users 一張 rules 要兼顧三種讀寫模式
5. **Schema 演化耦合**：改 driver 欄位影響所有 user document
6. **admin 分權需求**：未來需區分「最高管理員 / 管理員 / 助理」三層權限，靠 roles[] 一個欄位無法表達

## What Changes

### 新增 collection

- **`drivers/{lineUid}`**：司機營運資料（即時狀態 / 累積統計 / 業務設定）
  - 合併現有 `drivers/{driverId}` 即時位置 collection（同一份資料，driverId 改用 lineUid）
- **`admins/{lineUid}`**：管理員分權與權限旗標
  - level 三層：`super` | `admin` | `assistant`
  - 三層權限對應寫死在 server-side helper（未來可加 permissions 欄位細粒度 override）

### 修改 collection

- **`users/{lineUid}`**：保留為「身分認證 source of truth」
  - 維持：`lineUserId`、`displayName`、`pictureUrl`、`roles[]`、`approved`、`createdAt`、`driverApplication`
  - 移除：`driverCategory`（搬到 `drivers`）

### 修改 server endpoints

10+ 個 endpoint 需要對應新 collection：
- driver/apply.post：寫 `users.driverApplication` + 同步建 `drivers/{lineUid}` 預設文件
- drivers/[id]/location.put：寫到 `drivers/{lineUid}` 同 doc（取代 `drivers/{driverId}`）
- drivers/[uid]/stats.get：從 `drivers/{lineUid}` 讀取 totalTrips/totalEarnings 等
- drivers/available.get：query `drivers/{lineUid}` collection（status='online'/'busy'）
- admin/users.patch：addRole='admin' 時同步建 `admins/{lineUid}`；removeRole='admin' 時刪除
- 新增 `admin/admins/*` endpoints：列管理員 / 設定 level / 移除（僅 super 可呼叫）
- require-auth helper 增強：載入 admins/{lineUid} 的 level（不影響身分判斷，僅用於 permission 細分）
- 新增 require-permission helper：依 level 對應 permission table 決定能不能執行

### 新增 client UI

- `app/pages/admin/settings/index.vue` 加 admin 分權編輯 UI（super 才能看到「level 設定」區塊）
- `app/components/common/CommonHeaderUser.vue` 顯示 level 徽章（super / admin / assistant）

### 修改 firestore.rules

- 新增 `drivers/{driverId}` rules（已存在的位置 collection rules 直接擴展為新 schema）
- 新增 `admins/{lineUid}` rules（owner 可讀自己、所有 admin 可讀全部）

## Capabilities

### New Capabilities

- `driver-collection`: 司機獨立 collection 含即時狀態與累積統計，支援高效 query 與將來累程/金額/評分等擴展
- `admin-permission`: 管理員三層分權（super / admin / assistant），server-side require-permission 統一驗證

### Modified Capabilities

- `user-roles`：仍是身分認證 source of truth，但「司機營運資料」與「管理員權限」拆出去獨立管理

## Impact

**程式碼層**：
- 新增：
  - `server/utils/require-permission.ts`（依 level 對應權限）
  - `server/routes/nuxt-api/admin/admins/index.get.ts`（列 admin）
  - `server/routes/nuxt-api/admin/admins/[uid].patch.ts`（改 level / 撤銷）
  - `app/protocol/fetch-api/api/admin/admin-permission.ts`（client API 定義）
- 修改：
  - server endpoints（10+，見上方清單）
  - `server/utils/require-auth.ts`：載入 admin level
  - `firestore.rules`：新 collection rules
  - `app/stores/5.store-auth.ts`：載入 admin level + permissions
  - `app/pages/admin/settings/index.vue`：分權編輯 UI

**資料層**：
- 既有測試使用者（含 admin）需 migration（手動 Firebase Console 操作，因為測試階段資料量小）
- 既有 `drivers/{driverId}` 即時位置文件需合併到 `drivers/{lineUid}`
- 詳見 `migration.md`

**安全層**：
- admin 操作分權：avoid「assistant 不小心啟動全員 broadcast」
- super admin 撤銷其他 admin 的能力，集中於 super 一人

**風險**：
- migration 期間若漏 admin doc → 該 admin 無法操作 admin endpoint（解法：tasks.md 的 stage gate 嚴格驗證）
- 既有 `drivers/{driverId}` 與新 `drivers/{lineUid}` 過渡期：location.put 必須一次性切換，避免雙寫不一致

**未來擴展預留**：
- `admins.permissions: { canBroadcast, canManageDrivers, ... }`：第一版用不到，但欄位先預留
- `drivers.assignedRegions: string[]`：分區管理 / 分區搶單預留
- `drivers.rating + ratingCount`：評分系統預留
