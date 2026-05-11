# Hand-off — P23 Fleet 設定動態化（給下個 Session）

## 進度狀態（2026-05-11 收工）

| Stage | 範圍 | 狀態 |
|---|---|---|
| 1 | Firestore schema + seed + GET 公開 + admin CRUD endpoints | ✅ commit `3183f3c` |
| 2 | client StoreConfig + plugin + API protocol + shared/pricing.ts 退役 | ✅ 併入 commit `4668e06` |
| 3 | 8 caller 切 store + booking 行李 SU 制 + order schema (luggageItems) | ✅ commit `4668e06` |
| 4 | fleet 頁讀動態 config | ✅ 已併進 Stage 2 |
| 5 | **admin/settings 加 3 個 CRUD 區塊（車型 / 行李類型 / 加值服務）** | 🔴 **下個 session 開工** |
| 6 | order schema + driver/admin modal 顯示明細 | ✅ 已併進 Stage 3 |

**branch**: `claude/cranky-mccarthy-2df56a`（worktree）

## 下個 Session 開場做這些

### 第一件事：讀文件（~5 分鐘）

1. `CLAUDE.md`（強制規範）
2. **本 HANDOFF**
3. `openspec/changes/2026-05-11-p23-fleet-admin-config/proposal.md`（必讀）
4. `openspec/changes/2026-05-11-p23-fleet-admin-config/tasks.md` Stage 5 段落
5. `app/pages/admin/settings/index.vue`（712 行，**先讀過再動**）
6. `server/utils/fleet-config.ts`（Stage 1 寫的 — 型別 + validator + defaults）
7. `app/stores/8.store-config.ts`（Stage 2 寫的 — getter + Reload）
8. `app/protocol/fetch-api/api/config/index.ts`（CRUD API 已備齊）

### 第二件事：Stage 5 任務拆解

目標：admin 在 `/admin/settings` 能編輯車型 / 行李類型 / 加值服務三個 collection，含三語 label 編輯。

#### 5.1 抽出三個 CRUD 組件（建議放 `app/components/admin/`）

| 檔案 | 用途 |
|---|---|
| `SettingsFleetVehicles.vue` | 車型表格 + 編輯彈窗 |
| `SettingsFleetLuggageTypes.vue` | 行李類型表格 + 編輯彈窗（admin 可改 SU 值） |
| `SettingsFleetExtras.vue` | 加值服務表格 + 編輯彈窗（任意新增/刪除） |

每個組件結構：
- `<table>`：列出 `StoreConfig().vehicles` / `luggageTypes` / `extras`，含 enabled toggle、編輯 / 刪除按鈕
- 「新增」按鈕開彈窗（用既有 `$open` 全域工具或直接 inline modal）
- 編輯彈窗欄位：
  - 三語 label（zh / en / ja 三個 ElInput）
  - 數值欄位（vehicles: capacity / luggageSU / baseFare / perKmRate；luggage: su；extras: price）
  - icon 欄位（先單純字串輸入，例 `mdi:car-side`）
  - sortOrder（整數）
  - enabled（switch）
- 確認後呼叫對應 API：
  - 新增：`$api.CreateFleetVehicle(body)` / `CreateFleetLuggageType` / `CreateFleetExtra`
  - 更新：`$api.UpdateFleetVehicle(id, body)` 同三組
  - 刪除：`$api.DeleteFleetVehicle(id)` 同三組
- 操作後 `await StoreConfig().Reload()` 刷新

#### 5.2 整合進 `app/pages/admin/settings/index.vue`

712 行已有 Tab 結構（admin / driver 兩個 Tab 區塊），新增第三個區塊「Fleet 設定」含三個子 tab 或 accordion。

#### 5.3 i18n（可選）

driver/admin 端**不做 i18n**（CLAUDE.md 規範），所以 admin/settings 的 UI label 寫死中文即可，但彈窗內編輯的「label.zh / label.en / label.ja」三欄要清楚標示給 admin 知道是「乘客 fleet 頁顯示的三語」。

### 第三件事：commit + push

建議拆 1-2 個 commit：
- 純 component 建立 + index.vue 整合一個 commit
- 訊息：`feat(p23): Stage 5 — admin/settings 加車型 / 行李 / 加值服務 CRUD 區塊`

完成後：
- 整個 P23 收尾，建議 update `docs/decision-log.md` 記一筆 P23 條目
- update `docs/tasks.md` P23 完成

## 關鍵已驗證設計（不用再對齊）

| 項目 | 拍板值 |
|---|---|
| SU 換算（admin 可改 seed） | 1 / 2 / 3 / 4（small/medium/large/special） |
| 車型 luggageSU 容量（seed） | sedan=4、suv=7、van=14、premium=4 |
| 超 SU 行為 | ≤capacity ok / ~1.5x warn 但可選 / >1.5x disable 紅字 |
| 配置儲存 | 完全 Firestore，admin 改完 Reload store 即生效 |
| 加值服務 | admin 任意新增 + 自訂價格 + 三語 label |
| 舊訂單 | 不兼容（user 確認測試訂單上線前清庫） |
| 權限 | `canManageFleet`（super + admin 預設有，assistant 無） |

## API 介面快速 ref（Stage 5 會用到）

```ts
// 全部位於 app/protocol/fetch-api/api/config/index.ts，已 export 進 $api
$api.GetFleetConfig()  // 公開，回 { vehicles, luggageTypes, extras }

$api.CreateFleetVehicle({ id?, label: {zh,en,ja}, capacity, luggageSU, baseFare, perKmRate, icon, sortOrder, enabled })
$api.UpdateFleetVehicle(id, body)  // body 同上但不帶 id
$api.DeleteFleetVehicle(id)

$api.CreateFleetLuggageType({ id?, label, su, sortOrder })
$api.UpdateFleetLuggageType(id, body)
$api.DeleteFleetLuggageType(id)

$api.CreateFleetExtra({ id?, label, price, icon, sortOrder, enabled })
$api.UpdateFleetExtra(id, body)
$api.DeleteFleetExtra(id)
```

Server endpoint route table（已 build 驗證）：
- `GET /nuxt-api/config/fleet` 公開
- `POST /nuxt-api/admin/config/:resource` 需 canManageFleet
- `PUT /nuxt-api/admin/config/:resource/:id`
- `DELETE /nuxt-api/admin/config/:resource/:id`
- resource ∈ `vehicles` / `luggage-types` / `extras`

## Store 用法快速 ref

```ts
const storeConfig = StoreConfig();

// 全部清單
storeConfig.vehicles       // FleetVehicle[]（含 enabled=false）
storeConfig.luggageTypes   // FleetLuggageType[]
storeConfig.extras         // FleetExtra[]（含 enabled=false）

// 只回 enabled
storeConfig.EnabledVehicles  // computed
storeConfig.EnabledExtras

// 單筆查找
storeConfig.GetVehicle('sedan')         // FleetVehicle | undefined
storeConfig.GetLuggageType('medium')
storeConfig.GetExtra('baby-seat')

// i18n
storeConfig.LabelOf(vehicle.label, 'zh' | 'en' | 'ja')

// 重撈
await storeConfig.Reload()  // admin 改完叫這個
```

## 已知陷阱

1. **Pug template 不支援多行箭頭函數**（admin/orders 已踩坑）。`@input` 多行邏輯 → 抽 script 寫 method，template 只呼叫。
2. **doc id slug 限制**：`^[a-z0-9][a-z0-9-]{0,49}$`（admin/config POST endpoint 驗證）。admin 在 UI 給 id 欄位時要提示這個。
3. **重複 id**：POST endpoint 已擋 `ID already exists`，UI 要 catch 顯示 badRequest 訊息。
4. **刪車型不影響舊訂單**：訂單 doc 內 `vehicleType` 是 string 快照，admin 刪 sedan 後既有 sedan 訂單仍可顯示（fallback 文字 = id）。但 admin/orders 編輯模式的車型 select 已加「（已停用或刪除）」option fallback，避免訂單卡死。
5. **三語 label 必填**：server `validateVehiclePayload` 等三個 validator 都檢查 zh/en/ja 三欄都得有字串。UI 要必填 3 個欄位。
6. **enabled 切換**：lint 不能直接帶 boolean 到 number 欄位 — sortOrder 必須是整數。
7. **CLAUDE.md 規範**：admin/settings 用 admin 端設計風格（CSS 寫法可參考 `app/pages/admin/orders/index.vue` 既有 modal 樣式）。

## Context 評估

當前 session 已做：Stage 1（server CRUD + spec）+ Stage 2-3（client store + 8 caller 切換 + booking SU UI + order schema）。Stage 5 admin UI 估 ~500 行（3 個 component + 1 個整合 page），單 session 範圍合理。

## 部署 / 環境（沿用既有）

- production: https://da-line-liff-app.vercel.app
- 分支模式：`git push origin <local-branch>:main` fast-forward
- 對話用繁中、commit message 用 Conventional Commits 繁中、attribution 已禁用
- 三端均用 `middleware: ['auth', 'role']` 守衛，admin/driver 端 `ssr: false`
