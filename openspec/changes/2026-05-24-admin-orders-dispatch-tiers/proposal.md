# Admin Orders 派單強化 + 訂單後修 + 司機分級派單（2026-05-24）

> Umbrella change，分 5 個 phase（Wave 1A / 1C / 2A / 2B+2C / 2D）依序上線。
> 每個 phase 各自一次 `commit + push prod`；最後一 phase 完成才 `openspec archive`。

## Why

### 1A — 列表派單入口缺失
目前 `admin/orders` 列表每列只有「查看詳情 >」按鈕（`app/pages/admin/orders/index.vue:750-781`），admin 必須點開 modal 進編輯模式才能發布需求單（modal 內 842-845 行的「📤 發出需求單」）。批次處理大量訂單時非常費操作。**列表需直接顯示「發布」/「重新發佈」按鈕**，並顯示已重發次數（`dispatchCount`），點按時 `UseAsk()` 二次確認避免誤觸。

### 1C — 訂單建立後 tag 無法後修，車資與實況脫鉤
乘客 booking 時勾選的喜好標籤（`preferences.tagIds`）會影響車資（既有 `tag_surcharge = max(snapshot.surchargeAmount)`，Phase 1D 上線）。但訂單建立後：
- Edit modal **沒有 tag 編輯 UI**（942 行只「顯示」`preferences.tagSnapshot`）
- 乘客若臨時提需求變更，admin 無法在後台調整 → 只能取消重建單，破壞訂單連續性與司機已搶單狀態

**admin 需能後修 tag**，且後修必須**觸發車資重算**（避免 admin 改了 tag 但價格沒動，導致司機接走後對不上）。重算邏輯需考慮：
- 若訂單已套折扣碼，重算時要重檢折扣碼是否仍有效（若已過期，fallback 原 discount + UI 警告）
- 已派單狀態仍可改（dispatched）；已指派司機（assigned）後鎖死
- 不通知乘客（admin 後台行為）

### 2 — 全車隊平等開放需求單，無法激勵高品質司機 / 保護新司機
目前 `dispatched-orders.get.ts:56-57` 對所有 `approved=true` 司機開放所有 `pending && dispatchAt!=null && !assignedDriverId` 的訂單。無分級機制：
- 高品質司機（評分高 / 趟數多）沒有「優先看單」的優勢
- 新註冊未驗證的司機可看到所有訂單，包括長途包車這類需經驗的單
- LINE multicast 一次推全車隊，無謂噪音

`driverCategory` 欄位已存在於 P18 collection-split（`drivers/{uid}.driverCategory: '0' | '1' | '2'`），但**從未被使用**。需要把這欄位接上派單系統，達成**分級可見性**：高級司機先看到，X 分鐘後降一級開放給次級，再 Y 分鐘後全開。

## What Changes

### Phase 1A — admin/orders 列表派單按鈕（純 UI）
- 列表 action column 依 `dispatchAt` + `assignedDriverId` 切換按鈕：
  - `!dispatchAt` → 「📤 發布需求單」
  - `dispatchAt && !assignedDriverId` → 「🔁 重新發佈」+ `dispatchCount` chip
  - `assignedDriverId` → 隱藏
- 兩按鈕點擊 `UseAsk()` 二次確認
- 後端 endpoint `dispatch.post.ts` / `redispatch.post.ts` **不動**
- Edit modal 內既有「發出需求單」按鈕保留（不刪），列表只是新增入口

### Phase 1C — 訂單 tag 後修 + 車資重算
- Edit modal 加 tag multi-select（讀 tags library，預選 `tagSnapshot`）
- 後端 endpoint 支援更新 `preferences.tagIds` → 重新 snapshot → 呼叫 Fare V2 calculate（若需抽公用 util）
- 預覽流程：admin 改動 → dry-run 算新價 → 顯示「原價 X → 新價 Y → 差額 Z」+ 折扣碼警告（如有）→ `UseAsk()` 確認 → 寫
- 折扣碼重檢：碼過期則 fallback 原 discount + 警告
- 狀態守則：`pending` / `dispatched` 可改，`assigned` 後 403
- audit log: `action=order.tag-update.price-recalc`，含 before/after fare + tag diff
- **不**通知乘客

### Phase 2A — driverCategory 編輯 UI
- `admin/drivers/[uid].vue` 加 `driverCategory` 編輯區塊（select '0' novice / '1' standard / '2' pro，目前 181 行只能讀）
- 二次確認 + audit log `driver.category-changed`
- 提交呼叫既有 PATCH `/nuxt-api/admin/users/[uid]`（line 183-184 已支援，無需新 endpoint）
- 升級規則 spec stub（未實作，留 hook）：候選 metric trip count / 里程 / 評分

### Phase 2B + 2C — Order 分級 schema + 發布表單首發等級 + filter + bid 守則 + LINE 分批 + 倒數
- Order schema 加 `dispatchVisibility = { startLevel, currentLevel, openedAt, levelHistory: [{level, openedAt, openedBy, reason}] }`
- `reason` enum: `'init' | 'auto-downgrade' | 'manual-downgrade' | 'force-open-all'`
- 發布表單加「首發等級」select（'2' pro 優先 / '1' standard 起 / '0' 全開 / '暫不發布'）
- `dispatched-orders.get.ts` 加 server-side filter：`driver.driverCategory >= order.dispatchVisibility.currentLevel`
- **不符合等級的司機完全看不到該訂單**（client 根本拿不到資料）
- `bid.post.ts` transaction 守則加等級檢查：若 driver.category < currentLevel → 403 + log anomaly（防直打 API，正常 client 不會走到此分支因 server filter 已過濾）
- LINE multicast 改成 `multicastByLevel(orderId, level)` helper，只推符合等級的司機
- 司機端訂單卡顯示「即將降級倒數」（`openedAt + duration[currentLevel] - now`）
- Migration 一次性 script：既有訂單 backfill `dispatchVisibility.currentLevel='0'`（全開），避免上線後既有訂單突然沒人看到

### Phase 2D — Lazy 降級 + admin 手動降級 + LINE template
- `dispatched-orders.get.ts` 加 lazy check：`now > openedAt + duration[currentLevel]` → atomic update currentLevel-- + 寫 levelHistory + 觸發 multicast
- 不用 cron
- Admin 列表 + Edit modal 加「⬇️ 立即降級」/「🔓 全開放」按鈕（二次確認，currentLevel='0' 時 disabled）
- 兩按鈕對應新 endpoint：`POST /nuxt-api/admin/orders/{orderId}/dispatch-level/downgrade` 與 `/force-open`
- `line_templates` collection 加新 entry `dispatch.level-down`（Flex template 含 orderId / orderType / dropoffArea / fareEstimate / etaWindow，三語預設文本）
- 降級時前一級司機被降的等級無感，繼續看得到
- 降到 0 後不再降，第一版不做「全開後再提示 admin」

### orderType → 等級間距 Config（hard-code 在 server util）

| orderType | 2→1 | 1→0 | 理由 |
|---|---|---|---|
| `airport-pickup` / `airport-dropoff` | 3 分 | 5 分 | 時效強 |
| `transfer` | 8 分 | 12 分 | 一般市內 |
| `charter` | 30 分 | 60 分 | 包車可慢慢配 |

第一版 admin 不可調，日後再做 settings UI。

## Impact

### Affected code

| 檔案 | Phase | 動作 |
|---|---|---|
| `app/pages/admin/orders/index.vue` | 1A, 1C, 2B+2C, 2D | 列表按鈕 + Edit modal tag 多選 + 首發等級 select + 降級按鈕 |
| `app/pages/admin/drivers/[uid].vue` | 2A | 加 driverCategory 編輯區塊 |
| `app/pages/driver/dispatched/index.vue` | 2B+2C | 訂單卡加「即將降級倒數」 |
| `server/routes/nuxt-api/admin/orders/[orderId].patch.ts` | 1C | tag 後修 + 重算 + 狀態守則 + audit |
| `server/routes/nuxt-api/admin/orders/[orderId]/dispatch.post.ts` | 2B | 寫 `dispatchVisibility.startLevel + currentLevel + history` |
| `server/routes/nuxt-api/admin/orders/[orderId]/redispatch.post.ts` | 2B | 重發時 currentLevel 重置回 startLevel |
| `server/routes/nuxt-api/admin/orders/[orderId]/dispatch-level/downgrade.post.ts` | 2D | 🆕 |
| `server/routes/nuxt-api/admin/orders/[orderId]/dispatch-level/force-open.post.ts` | 2D | 🆕 |
| `server/routes/nuxt-api/driver/dispatched-orders/index.get.ts` | 2B+2C, 2D | filter by level + lazy check |
| `server/routes/nuxt-api/driver/orders/[orderId]/bid.post.ts` | 2B+2C | transaction 守則加等級檢查 |
| `server/utils/order-dispatch.ts` | 2B+2C, 2D | `multicastByLevel` helper + duration config |
| `server/utils/driver-category.ts` | 2A, 2B+2C | 🆕 enum + label + 升級規則 stub |
| `server/utils/fare-calculator.ts` 或 `shared/fare/calculate.ts` | 1C | 抽 Fare V2 calculate 公用 util（若既有為 inline） |
| `server/scripts/backfill-dispatch-visibility.ts` | 2B+2C | 🆕 一次性 migration script |
| `app/protocol/fetch-api/api/admin/index.ts` | 1C, 2B+2C | `AdminOrder` interface 加 `dispatchVisibility` |
| `shared/types/driver-category.ts` | 2A | 🆕 enum |
| `line_templates` collection | 2D | 加 entry `dispatch.level-down` |
| `i18n/locales/{zh,en,ja}.js` | all | 加 admin / driver / dispatch keys |

### 不影響

- 既有 Phase 1A-1E booking tag system / fare V2 既有公式 / 折扣碼基本邏輯
- `firestore.rules`（無新 collection；`line_templates` 已存在）
- `driverCategory` 數值定義（保持 `'0' | '1' | '2'`，不改 schema）
- LINE OA 既有 17 個 template（只新增 1 個，total 18）

## 驗收標準（Umbrella，每 phase 自己驗收見 tasks.md）

- [ ] Phase 1A 列表 3 場景按鈕切換正確
- [ ] Phase 1C tag 後修 4 場景（pending / dispatched / assigned 403 / 折扣碼過期 fallback）
- [ ] Phase 2A admin 改司機等級寫 audit log
- [ ] Phase 2B+2C 訂單可指定首發等級，三級司機可見性正確（pro 看 currentLevel=2、standard 看 ≤1、novice 只看 0）
- [ ] Phase 2B+2C 既有訂單 migration backfill 100% currentLevel='0'，0 fail
- [ ] Phase 2D Lazy 自動降級時間正確（airport 3/5、transfer 8/12、charter 30/60）
- [ ] Phase 2D Admin 立即降級 / 全開放按鈕觸發 multicast + LINE template
- [ ] `pnpm lint` / `pnpm test`（含新 case 80%+ coverage）/ `pnpm build` 各 phase 全綠
- [ ] Brain AI prod 三端 e2e 驗收綠後 archive
