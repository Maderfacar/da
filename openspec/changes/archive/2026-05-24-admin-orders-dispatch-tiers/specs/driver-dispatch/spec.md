## ADDED Requirements

### Requirement: 司機分級 enum 對齊 dispatch level
系統 SHALL 在 `shared/types/driver-category.ts` 提供 `DRIVER_CATEGORY` 三級常數（`'0' NOVICE` / `'1' STANDARD` / `'2' PRO`），與 `orders/{orderId}.dispatchVisibility.currentLevel`（Wave 2B+2C 加入）對齊，使「driver.driverCategory >= order.currentLevel」可直接字串比較。

#### Scenario: enum 三級齊全
- **WHEN** 讀取 `shared/types/driver-category.ts`
- **THEN** 匯出 `DRIVER_CATEGORY.NOVICE === '0'` / `STANDARD === '1'` / `PRO === '2'`
- **AND** 匯出 `DRIVER_CATEGORY_VALUES` 為 `['0','1','2']`
- **AND** 匯出 `isDriverCategory` runtime 驗證 helper

#### Scenario: 三語顯示名稱
- **WHEN** 讀取 `DRIVER_CATEGORY_LABEL[level]`（level ∈ `'0'|'1'|'2'`）
- **THEN** 回傳 `{ zh, en, ja }` 三語物件，分別為「新手 / Novice / 新人」「標準 / Standard / 標準」「高級 / Pro / プロ」

### Requirement: Admin 可變更司機分級
Admin 在 `/admin/drivers/[uid]` 詳情頁 SHALL 可透過下拉選單變更該司機的 `driverCategory`。提交 MUST 經過二次確認（`UseAsk`），並呼叫既有 endpoint `PATCH /nuxt-api/admin/users/{uid}`，body 帶 `driverCategory: '0' | '1' | '2'`。

#### Scenario: 合法值更新成功
- **WHEN** admin 將某司機從 `'0'` 改為 `'2'` 並確認
- **THEN** `drivers/{uid}.driverCategory` 由 `'0'` 更新為 `'2'`
- **AND** API 回傳 `status.code === 200`

#### Scenario: 不合法值被拒
- **WHEN** body 帶 `driverCategory: '9'`
- **THEN** endpoint 回傳 `badRequestError`，訊息為「司機分級值不合法（限 0 / 1 / 2）」

#### Scenario: 未變動值不寫
- **WHEN** admin 選擇與原值相同的分級並提交
- **THEN** UI 顯示「分級未變更」並關閉編輯狀態，不發送 API

### Requirement: 司機分級變更寫入 audit log
Endpoint `PATCH /nuxt-api/admin/users/{uid}` 在 `driverCategory` 變動時 MUST 寫入一筆 `audit_logs` 文件，`action='driver.category_change'`、`targetType='driver'`、`targetId=uid`，payload MUST 含 `before.driverCategory` 與 `after.driverCategory`。`actorUid` 由 `writeAuditLog` 自動寫入（等同 adminId）。

#### Scenario: audit payload 含 before/after
- **WHEN** admin 將司機 `A` 從 `'1'` 改為 `'2'`
- **THEN** 寫入一筆 `audit_logs`，`payload.before.driverCategory === '1'`、`payload.after.driverCategory === '2'`
- **AND** `actorUid` 等於發起此次 PATCH 的 admin lineUid

#### Scenario: 既無 driver doc 時 before 為 null
- **WHEN** 對尚無 `drivers/{uid}` 文件的 user 設 `driverCategory='0'`
- **THEN** `payload.before.driverCategory === null`、`payload.after.driverCategory === '0'`

## 升級規則 stub（第一版未實作）

> 第一版僅提供 admin 手動變更入口，自動升級規則保留候選 metric 占位；待後續 phase 視運營實況加上。

候選 metric（三項取 AND，admin 仍可手動覆寫）：

| Metric | `→ '1' STANDARD` 門檻 | `→ '2' PRO` 門檻 | 觸發點 |
|---|---|---|---|
| `tripCount` 完成趟數 | ≥ 50 | ≥ 200 | 訂單 status 改為 `completed` 時 |
| `distanceKm` 累積里程 | ≥ 1000 | ≥ 5000 | 同上（從 `statusHistoryLocations` 累積） |
| `rating` 平均評分 | ≥ 4.5 | ≥ 4.8 | 乘客留評後 |

實作 hook（未來）：
- `server/utils/driver-category.ts` 加 `evaluateAutoUpgrade(stats): DriverCategory | null` pure function
- 訂單 `completed` 寫入路徑掛 trigger，命中即寫 `drivers/{uid}.driverCategory` + audit log `reason='auto-upgrade'`
- admin 手動仍可降級（覆寫）；降級不觸發自動升級重評（避免抖動）
