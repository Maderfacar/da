# Tasks — P18 Collection Split

> 順序執行；每個 stage 完成後 verify 再進下一 stage。所有改動完成後一次 commit + push。
>
> Stage 0 → Stage 7。中途 lint 不過、type 不過就回頭修。

## Stage 0：理解現況（不改 code）

- [ ] 0.1 讀 `CLAUDE.md`、`docs/decision-log.md`（特別 P14/P17 條目）、`.claude/knowledge/backend-conventions.md`
- [ ] 0.2 讀 `openspec/changes/2026-05-09-collection-split/proposal.md` + `design.md` + `migration.md`
- [ ] 0.3 確認當前 commit `88be1fc` 已部署（require-auth roles Firestore 優先）
- [ ] 0.4 grep 一次 `drivers/` `admins/` `users.driverCategory` 確認影響範圍與 design.md 一致

## Stage 1：require-auth 增強（admin level 載入）

- [ ] 1.1 修 `server/utils/require-auth.ts` `AuthOk` 介面加 `level?: 'super' | 'admin' | 'assistant'` 與 `permissions?: { ... }`（optional）
- [ ] 1.2 `getAuthFromEvent`：當 `roles.includes('admin')` 時，多 read `admins/{lineUid}`，把 `level` 與 `permissions` 寫入回傳；非 admin 為 undefined
- [ ] 1.3 lint 通過
- [ ] 1.4 自我驗證：寫一個臨時 console.log 在 admin endpoint，dev 跑一次 `/admin/orders` 確認 `auth.level` 有值（驗證後刪除 log）

## Stage 2：require-permission helper

- [ ] 2.1 新建 `server/utils/require-permission.ts`：
  - export `Permission` type（`canManageAdmins | canManageDrivers | canManageOrders | canBroadcast | canViewFinance`）
  - export `LEVEL_TABLE`（design.md 對應表）
  - export `hasPermission(auth, perm)` function（支援 permissions overrides，fallback 到 level table）
- [ ] 2.2 lint 通過

## Stage 3：drivers collection schema + driver/apply 同步建 doc

- [ ] 3.1 修 `server/routes/nuxt-api/driver/apply.post.ts`：
  - 寫入 `users.driverApplication` 後（已有），同步 `db.collection('drivers').doc(lineUid).set({ ...defaults }, { merge: true })`
  - defaults：lineUserId / displayName / pictureUrl（從 users 同步取） / status='offline' / location=null / totalTrips=0 / totalEarnings=0 / totalDistanceKm=0 / todayTrips=0 / todayEarnings=0 / driverCategory='0' / vehicleType=body.vehicleType / createdAt=serverTimestamp / lastActiveAt=serverTimestamp
- [ ] 3.2 修 `server/routes/nuxt-api/admin/users/[uid].patch.ts`：
  - 當 admin 操作 `driverCategory` 時，**改寫 `drivers/{uid}.driverCategory`**（不再寫 users.driverCategory）
  - 當 admin 用 `removeRole='driver'`（拒絕司機）時，可選擇是否刪除 drivers doc — **不刪**（保留統計）
- [ ] 3.3 lint 通過

## Stage 4：drivers/[id]/location.put + drivers/[uid]/stats.get 改用新 schema

- [ ] 4.1 修 `server/routes/nuxt-api/drivers/[id]/location.put.ts`：
  - 寫入路徑改為 `db.collection('drivers').doc(lineUid).set({ status, location: { lat, lng, heading, updatedAt }, lastActiveAt }, { merge: true })`
  - id 兼容兩種格式（`line:Uxxx` 或 `Uxxx`）：去 prefix 後當作 lineUid
  - 注意：`drivers/{lineUid}` 文件已由 driver/apply 建立；merge:true 不影響統計欄位
- [ ] 4.2 修 `server/routes/nuxt-api/drivers/[uid]/stats.get.ts`：
  - 改從 `drivers/{lineUid}` 讀 totalTrips / totalEarnings / todayTrips / todayEarnings
  - 不再用 `where('assignedDriverId', '==', uid)` 計算（改用累積欄位）
  - 容錯：若 drivers doc 不存在（例如歷史 admin 帳號）→ 回 0
- [ ] 4.3 修 `server/routes/nuxt-api/drivers/available.get.ts`：
  - query 改 `drivers/{lineUid}` collection，`where('status', 'in', ['online', 'busy'])`
  - 回傳格式不變（drivers/[id]/location.put 與 drivers/available.get 是 admin 戰情室和司機端共用的對外格式）
- [ ] 4.4 lint 通過

## Stage 5：order completion 觸發 driver 統計累加

- [ ] 5.1 修 `server/routes/nuxt-api/orders/[orderId].patch.ts`：
  - 當 `orderStatus` 改為 `'completed'` 時，read order doc 取 `assignedDriverId` 與 `estimatedFare` 與 `distanceKm`
  - 對 `drivers/{assignedDriverId}` 執行：
    - `totalTrips: FieldValue.increment(1)`
    - `totalEarnings: FieldValue.increment(estimatedFare)`
    - `totalDistanceKm: FieldValue.increment(distanceKm)`
    - `todayTrips: FieldValue.increment(1)`
    - `todayEarnings: FieldValue.increment(estimatedFare)`
    - `lastTripAt: FieldValue.serverTimestamp()`
  - 注意：assignedDriverId 格式（line:Uxxx 還是 Uxxx）需要對齊 drivers doc key（去 prefix 後）
- [ ] 5.2 lint 通過
- [ ] 5.3 注意：「today 統計每日歸零」屬於後續工作（需 cron 或在每次讀取時依日期判斷），第一版**先實作 increment**，UI 顯示 todayTrips 時 client 端可加日期 guard 或暫接受隔日累加（記入 P18 後續 backlog）

## Stage 6：admins collection + admin/admins endpoints + 套 require-permission

- [ ] 6.1 修 `server/routes/nuxt-api/admin/users/[uid].patch.ts`：
  - 當 `addRole='admin'` 時，同步建 `admins/{uid}` doc（預設 level='admin'）；caller 必須有 `canManageAdmins` 權限
  - 當 `removeRole='admin'` 時，刪除 `admins/{uid}` doc；caller 必須有 `canManageAdmins` 權限
  - 開頭 guard 改用 `requirePermission(auth, 'canManageAdmins' || 'canManageDrivers')`：依 body 內容判斷需要哪個權限
    - body 含 admin 操作（addRole/removeRole='admin'）→ canManageAdmins
    - body 含 driver 操作（approved / rejectedAt / removeRole='driver' / driverCategory）→ canManageDrivers
- [ ] 6.2 新建 `server/routes/nuxt-api/admin/admins/index.get.ts`：列所有 admin（含 level + displayName）。需 `canManageAdmins`
- [ ] 6.3 新建 `server/routes/nuxt-api/admin/admins/[uid].patch.ts`：改 level（'admin' | 'assistant'，**不允許改成或撤銷 super**——super 撤銷需另寫保護機制；第一版限制：super 不可被改 level 也不可被刪）。需 `canManageAdmins`
- [ ] 6.4 修 `server/routes/nuxt-api/admin/broadcast.post.ts`：require-permission 改用 `canBroadcast`
- [ ] 6.5 修 `server/routes/nuxt-api/admin/orders/index.get.ts`：保持 admin role 即可（不另設 permission，admin/driver 都該看 orders）
  - 或改用 `canManageOrders` 統一管控
- [ ] 6.6 lint 通過

## Stage 7：client 端

- [ ] 7.1 修 `app/protocol/fetch-api/api/admin/index.ts`：新增 `GetAdmins`、`PatchAdmin` API 定義
- [ ] 7.2 修 `app/stores/5.store-auth.ts`：
  - 加 `level: ref<'super' | 'admin' | 'assistant' | null>(null)`
  - `_LoadRolesFromFirestore` 內：若 roles 含 admin，多 read `admins/{lineUid}` 取 level（client SDK，rules 必須允許 admin 讀自己的 admins doc）
  - export `level`、computed `isSuper`
- [ ] 7.3 修 `app/pages/admin/settings/index.vue`：
  - 「存取控制」區塊加管理員 level 編輯（dropdown：admin / assistant）
  - 列表多一欄顯示 level
  - 撤銷管理員按鈕只 super 可看（v-if="isSuper"）
- [ ] 7.4 修 `app/components/common/CommonHeaderUser.vue`（可選）：admin 用戶顯示 level 徽章
- [ ] 7.5 lint 通過

## Stage 8：firestore.rules 同步更新

- [ ] 8.1 修 `firestore.rules`：
  - 保留現有 users / orders / drivers 規則（drivers rules 中 driverId 改名為 lineUid 但語意不變）
  - 新增 admins rules：
    ```
    match /admins/{lineUid} {
      allow read: if request.auth != null && (
        request.auth.uid == 'line:' + lineUid ||
        ('roles' in request.auth.token && 'admin' in request.auth.token.roles)
      );
      allow write: if false;
    }
    ```

## Stage 9：文件 + commit

- [ ] 9.1 寫 `docs/decision-log.md` 補 P18 條目（背景 + 決策摘要 + 強制規範：「未來新增 user-specific resource 必須先評估該角色的 collection；統計類欄位必須與業務寫入端同步 increment」）
- [ ] 9.2 更新 `docs/tasks.md` v3.9：標記 P18 完成
- [ ] 9.3 一次性 commit（commit message 列出所有 stage 完成項）
- [ ] 9.4 push 到 main

## Stage 10：使用者操作（migration）

依 `migration.md` 提示使用者：
- [ ] 10.1 Firebase Console → Firestore → users collection 內每個既有 admin 帳號 → **手動建立 admins/{lineUid} doc**，level='super'（首位管理員為 super，避免管理員失能）
- [ ] 10.2 Firebase Console → 既有有 driver role 的 user → **手動建立 drivers/{lineUid} doc**（複製 driverCategory + 其他預設值）
- [ ] 10.3 既有 `drivers/{driverId}` 集合（即時位置）的 driverId 應該本來就是 line:Uxxx；使用者**檢查**並**清掉** `line:` prefix（rename doc id 需要：複製內容到新 doc + 刪舊 doc）
- [ ] 10.4 users collection 既有 driverCategory 欄位手動刪除（搬到 drivers 後不再使用）
- [ ] 10.5 部署新版 firestore.rules（Firebase Console → Firestore → Rules → 貼上 → Publish）

## Stage Gate（全部完成後驗證）

- [ ] G1 lint ✅
- [ ] G2 admin 端：登入後 `/admin/orders` `/admin/drivers` `/admin/notifications` `/admin/settings` 全部進得去
- [ ] G3 admin/settings 看得到管理員列表 + level；super 才看得到「設定 level」與「撤銷」按鈕
- [ ] G4 司機端：完成一張訂單後，`/driver/dashboard` 與 `/driver/profile` 顯示 totalTrips++、todayTrips++、totalEarnings += fare
- [ ] G5 戰情室 `/admin/war-room`：司機在線位置正常顯示（drivers/available.get 走新 schema）
- [ ] G6 滲透測試：用 assistant level 帳號 fetch admin/admins → 預期 403（無 canManageAdmins）
- [ ] G7 滲透測試：用 admin level 帳號 fetch admin/admins → 預期 403（不只 super 才能管理 admin）
- [ ] G8 滲透測試：super level 撤銷自己 → 預期 403（保護 last super admin）

如有 stage gate 失敗 → 回對應 stage 修復 → 再驗證。
