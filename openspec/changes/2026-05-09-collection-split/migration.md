# Migration — P18 Collection Split

> 此份指引給**使用者手動操作**用。測試階段資料量極小（< 10 個帳號 + 既有測試訂單已清空），不寫自動 migration script，直接 Firebase Console 操作。
>
> 順序：先建 admins / drivers，再清舊欄位，最後部署 rules + 驗證。

## 前置確認

1. 開 [Firebase Console](https://console.firebase.google.com/) → 選 `destination-anywhere-cfd50` 專案
2. 確認 production（`da-line-liff-app.vercel.app`）目前部署版本是「P18 改動已部署完成」commit
3. 列出**全部既有有 admin / driver role 的帳號 lineUid**（從 `users` collection 複製）

## Step 1：建立 admins/{lineUid} 文件（每個既有 admin）

對 `users.roles` 含 `'admin'` 的**每個**帳號：

1. Firestore → `admins` collection → **Add document**
2. Document ID：填**該 admin 的 lineUid**（不帶 `line:` prefix；與 users 同 key）
3. 欄位：
   - `lineUserId` (string)：同 ID
   - `displayName` (string)：複製 users 內的 displayName
   - `pictureUrl` (string)：複製 users 內的 pictureUrl
   - `level` (string)：**`super`**（既有 admin 全部設為 super，避免管理員失能）
   - `createdAt` (timestamp)：當下時間（用「Use server timestamp」）
4. Save

> **注意**：第一個建立的就是「最高管理員」。之後新加的 admin 可以是 `admin` 或 `assistant` level。

## Step 2：建立 drivers/{lineUid} 文件（每個既有 driver）

對 `users.roles` 含 `'driver'` 的**每個**帳號（含未核准）：

1. Firestore → `drivers` collection → **Add document**
2. Document ID：填**該 driver 的 lineUid**（不帶 `line:` prefix）
3. 欄位：
   - `lineUserId` (string)：同 ID
   - `displayName` (string)：複製
   - `pictureUrl` (string)：複製
   - `status` (string)：`offline`
   - `location`：null（先不填，司機開工時 location.put 會寫入）
   - `totalTrips` (number)：`0`
   - `totalEarnings` (number)：`0`
   - `totalDistanceKm` (number)：`0`
   - `todayTrips` (number)：`0`
   - `todayEarnings` (number)：`0`
   - `driverCategory` (string)：複製 users 內的 driverCategory（若有），沒有就填 `'0'`
   - `vehicleType` (string)：複製 users.driverApplication.vehicleType（若有）
   - `createdAt` (timestamp)：use server timestamp
   - `lastActiveAt` (timestamp)：use server timestamp
4. Save

## Step 3：合併既有 drivers/{driverId} 即時位置 collection（如有）

> 若你過去測試時 `drivers` collection 內已有 `line:Uxxx` 格式的 doc：

1. 對每個 `drivers/{line:Uxxx}` doc：
   - 複製其 `lat` / `lng` / `heading` / `updatedAt` / `status` 欄位
   - 寫進對應的 `drivers/{Uxxx}.location` nested object（去 prefix 的 doc）
   - 寫進 `drivers/{Uxxx}.status`（top-level 欄位）
2. 刪除 `drivers/{line:Uxxx}` 舊 doc

> 若沒有舊位置資料（從未啟動司機端 trip）→ 跳過此 step

## Step 4：清除 users 內的 driverCategory

對 `users.roles` 含 `'driver'` 的每個帳號：

1. 開該 user document → 找 `driverCategory` 欄位 → **Delete field**
2. 確認 driverApplication 等其他欄位不動

## Step 5：部署新版 firestore.rules

1. Firestore → **Rules** → 把 worktree 內 `firestore.rules` 內容貼上
2. **Publish**
3. 等 1 分鐘讓 rules 生效

## Step 6：驗證

### 6.1 admin 端登入測試
1. 用 super level 的 admin 帳號登入
2. 進 `/admin/settings` → 看得到管理員列表 + level
3. 應該也看得到「設定 level」「撤銷」按鈕（因為你是 super）

### 6.2 司機端 dashboard 顯示
1. 用 driver 帳號登入
2. 進 `/driver/dashboard` 應該看到 `totalTrips: 0`、`todayTrips: 0`、`totalEarnings: 0`（從新 drivers doc 讀）

### 6.3 完整 e2e 測試
1. passenger 訂一張車 → 訂單建立成功
2. admin 指派司機 → orderStatus → 'confirmed'
3. driver 端接到任務 → 改 'in_transit'
4. driver 完成行程 → orderStatus → 'completed'
5. 重整 driver/dashboard → `totalTrips=1`、`totalEarnings=該訂單金額`
6. 重整 admin/orders → 訂單狀態 'completed'

### 6.4 滲透測試
- 用 admin level（不是 super）登入 → 嘗試呼叫 `/nuxt-api/admin/admins`（GET）→ 預期 403
- 用 assistant level 登入 → 嘗試 broadcast → 預期 403（assistant 沒有 canBroadcast）

> 等等，確認設計：assistant **有** canBroadcast。請對照 design.md 表格再驗：assistant 嘗試 `canManageAdmins` 應該被擋；嘗試 `canBroadcast` 應該成功。

## 異常處理

### 案例 A：建 admins doc 但 admin 進 admin 端被踢
- 原因：admins doc level 欄位拼錯（如寫成 `Super` 或 `super_admin`）
- 解：確認 level 完全等於 `'super'`、`'admin'`、`'assistant'`（小寫）

### 案例 B：driver 訂單完成後 totalTrips 沒 increment
- 原因：drivers doc 不存在（未建立 / driverId 格式錯）
- 解：手動建 drivers/{lineUid} doc 後再次完成一張訂單測試
- 注意：assignedDriverId 在 orders doc 內格式應為 `line:Uxxx`，server 會去 prefix 對應 drivers doc

### 案例 C：firestore.rules 部署後 client 出現 permission denied
- 解：重整頁面或登出再登入（client SDK token 1 小時 TTL，會自動 refresh）；或 F12 Application 清 IndexedDB 強制重登

## 完成後

- [ ] 所有既有 admin 都有對應 admins doc，level='super'
- [ ] 所有既有 driver 都有對應 drivers doc，含預設統計欄位
- [ ] 舊 `drivers/{line:Uxxx}` 文件已合併到 `drivers/{Uxxx}` 並刪除
- [ ] users 內 driverCategory 欄位已刪除
- [ ] firestore.rules 已 publish
- [ ] 完成 6.1 - 6.4 驗證

migration 完成後告知 Brain AI（架構師），由他驗證並關閉本 spec change。
