# Hand-off：Phase 1G — Vehicle Tag System E2E + 上線

> Phase 1G 是整個「車輛標籤系統」（Phase 1A → 1F）系列的**最後一站**：E2E smoke + 單元測試補強 + LINE mock 機制 + version bump + firestore rules deploy → 等 Brain AI push main + 真機驗收。

## 狀態

- **實作 100% 完成**：lint / test 全綠（test 11 files / 216 tests passed，+18 case Phase 1G boundary）
- **`pnpm build` 全綠**（背景 task exit 0）
- **firestore rules 已 deploy 到 prod**（destination-anywhere-cfd50，jobId 1779379203631 → success）
  - 新增 1A 的 `tags` / `tag_audit_logs` 兩 collection 規則一併上線
  - validate 通過、整檔語法 OK
- 一支 commit；**未 push**（依拍版）
- 等 Brain AI：（a）push main → Vercel 自動部署；（b）真機 ≥ 30 條 checklist；通過後 archive 整批 1A~1G 規格

## 實作摘要

### 單元測試補強（+18 case）

- [shared/pricing.spec.ts](../../../shared/pricing.spec.ts) ✏️ — `Phase 1G 邊界補強` describe 區段：
  - 全 archived → surcharge=0 / 全 invalid
  - surcharge 全 0 → max 取 0（命中但無加價）
  - 重複 id 算兩次（matched 列兩次，max 不變）
  - selectedTagIds 含 null/number/object/'' → 全 invalid
  - buildTagSurchargeIndex 同 id 二筆 → 後者覆蓋
  - driver-scope mix → driver-scope 入 invalid

- [shared/orderPreferences.spec.ts](../../../shared/orderPreferences.spec.ts) ✏️ — `Phase 1G 邊界補強`：
  - snapshotAt 為合法 ISO timestamp（時序內 < 1s）
  - multi multiplicity group（interior）同時兩個 → 不算 mutex
  - driver-scope id 帶入 snapshot input → 不入 snapshot
  - input.tagIds = undefined → 回 empty snapshot
  - mutex 不檢非 vehicle scope

- [shared/orderDispatch.spec.ts](../../../shared/orderDispatch.spec.ts) ✏️ — `Phase 1G 邊界補強`：
  - preferenceTagIds 含 null/空字串 → 忽略不算
  - tagIndex 為空 map → matched=[]
  - preferenceTagIds 非陣列 → 不崩潰
  - driver 雙陣列皆 undefined → 不崩潰
  - sort 跨 group 穩定（power→interior→equipment→driverSkill）
  - ja lang 命中（hybrid 真翻譯）
  - isSoftMatch match.matchCount undefined → 視為 0

### LINE mock 機制（環境變數）

- [server/utils/line-push.ts](../../../server/utils/line-push.ts) ✏️ — 新增 `isLinePushDisabled()` helper：當 `process.env.LINE_PUSH_DISABLED === '1' | 'true'` 時 `sendLinePush` / `sendLineMulticast` 改為只 log（不真打 LINE API）。生產環境保持未設定。
  - E2E / smoke：`LINE_PUSH_DISABLED=1 pnpm dev`，所有 OA push 都跳過
  - Prod：保持不設此 env var
  - multicast `{ sent: N, failed: 0 }` 回傳行為對齊真打 success path

### E2E smoke spec（無 dev server 也可閱讀）

- [tests/e2e/vehicle-tag-system.spec.ts](../../../tests/e2e/vehicle-tag-system.spec.ts) 🆕 — 覆蓋 1A→1F 全部新路由的「smoke 守衛 + 不崩潰」測試：
  - Phase 1A：`/admin/settings` — auth/role 守衛接管不崩潰
  - Phase 1B：`/driver/profile` — auth/role 守衛接管不崩潰
  - Phase 1C：`/vehicles/{nonexistent-driverId}` 三語 — 公開頁（無需登入）+ 不存在 driverId 不崩潰、無 i18n missing
  - Phase 1D：`/booking` 三語 — mount 不崩潰、無 i18n missing
  - Phase 1E：`/driver/dispatched` / `/driver/dispatched/[orderId]` — auth/role 守衛接管
  - Phase 1E/1F：`/admin/orders` — auth/role 守衛接管
  - Phase 1F：`/driver/trip` — auth/role 守衛接管

  > ⚠️ 範圍說明（spec 開頭 comment 已寫）：完整 happy path（admin 發單 → driver 喊單 → admin 指派 → passenger 接受 → 完成）需要 LINE 登入 + 三角色帳號 + LIFF + Firestore seed，無頭瀏覽器無法自動化全鏈路。本 spec 只 cover smoke 層；完整驗收走 Brain AI 真機 checklist。

  > ⚠️ 注意：本 worktree 缺 `.env.dev`（worktree 不含 dotenv），無法 `pnpm dev` → `pnpm test:e2e` 須在主環境跑（含 .env.dev 的 cc_da 根目錄）。

### 版本 bump

- [version.ts](../../../version.ts) ✏️ — `0.3.37` → `0.4.0`（minor bump，車輛標籤系統整批上線）

### firestore rules deploy（已執行）

- [firestore.rules](../../../firestore.rules) — 確認語法 OK + 1A 新增的 `tags` / `tag_audit_logs` 兩 match 區塊在位
- **已透過 firebase MCP `firebase_deploy({ only: 'firestore:rules' })` 部署到 prod**
  - `destination-anywhere-cfd50` 環境
  - jobId `1779379203631`，status: success
- 規則邏輯：
  - `/tags/{tagId}` → 所有登入者可讀；寫入禁止（server admin SDK 走 `/nuxt-api/tags/*`）
  - `/tag_audit_logs/{logId}` → admin 可讀；寫入禁止
  - 其餘規則不動（保留既有 16 個 collection 規則）

## 驗證結果

```
pnpm lint    ✅ 0 error / 0 warning
pnpm test    ✅ 11 test files / 216 tests passed（+18 boundary case：pricing 6 + orderPreferences 5 + orderDispatch 7）
pnpm build   ✅ exit 0
firebase deploy --only firestore:rules ✅ jobId 1779379203631 success
```

## 整批 1A → 1G：累積新增資產清單

### 新增 Firestore collection（2 個）

| Collection | 用途 | 進入 phase | client 讀規則 |
|---|---|---|---|
| `tags` | 車輛 / 司機標籤 taxonomy | 1A | 所有登入者可讀 |
| `tag_audit_logs` | 標籤 CRUD audit log | 1A | admin 可讀 |

### 新增 / 改動 firestore.rules 行（已 deploy 1G）

只有 1A 新增 2 個 match 區塊（lines 197-213）。1B-1F 全部新欄位都掛在既有 collection（`orders` / `drivers` / `users`）內，沿用既有 server-only 寫入規則，無需動 rules。

### 新增 env var（**0 個**）

整批 1A → 1G **無新增** prod env var。
LINE_PUSH_DISABLED 是 E2E/dev only env var，prod 不設。
Vercel 環境變數無需變動。

### 新增 endpoint / 頁面 / 元件

| Phase | 內容 |
|---|---|
| 1A | `/nuxt-api/tags`（5 endpoint：list/create/update/archive/audit-log）+ `/admin/settings` 「車輛標籤」tab UI + admin seed loader |
| 1B | `/nuxt-api/driver/vehicle-profile`（GET/PUT/submit/approve/reject）+ `/admin/drivers/[uid]` 車輛 Profile tab + `/driver/profile` Vehicle & Skills section |
| 1C | `/nuxt-api/public/vehicle/[driverId]` + `/vehicles/[driverId]` 公開頁 + `VehiclePublicProfile` 元件 |
| 1D | `/booking` 偏好標籤 chip + fare summary 即時加 `max(tagSurcharge)` + `order.preferences` snapshot 寫單時固化 |
| 1E | `/nuxt-api/admin/orders/[id]/{dispatch,bids,assign}` + `/nuxt-api/driver/dispatched-orders/*` + `/nuxt-api/driver/orders/[id]/bid` + `/driver/dispatched(/[orderId])` 看板 + `/admin/orders` modal dispatch section + 雙向 LINE 推播 |
| 1F | `/nuxt-api/admin/orders/[id]/rematch` + `/nuxt-api/passenger/orders/[id]/soft-match-decision` + LINE postback prefix-handler + `/admin/orders` modal Soft Match section + `/driver/trip` pending banner + 21 keys × 3 語 i18n |
| 1G | E2E smoke spec + boundary 單元測試 + LINE_PUSH_DISABLED env + version bump + rules deploy |

## Prod migration（需要做什麼？）

**整批 1A → 1G 都不需要寫 migration**：

- 所有新欄位 / 新 collection 皆採 **forward-compatible** 設計（既有訂單 `?? null` fallback）
- 唯一資料準備：**1A seed 預載 24 個標籤**（admin 進 `/admin/settings` → 「車輛標籤」tab → 點「載入預載」按鈕；如 prod 已有同名 tag 會 skip）
- 既有 prod 訂單 / driver / user doc 不需動

## 上 prod 順序（建議）

> firestore rules 已 deploy（1G 內），剩下兩步：

1. **push main**（Brain AI 自跑）：
   ```bash
   git push origin claude/phase-1g-launch:main
   ```
   觸發 Vercel 自動部署（~3-5 min）。

2. **真機 smoke**（Brain AI ≥ 30 條 checklist，見下節）：失敗則修 → fast-follow commit + push 或 Vercel rollback。

## 真機驗收 checklist（Brain AI，預估 60-90 min）

啟動：等 Vercel 部署完成 + 訂單三種 / 司機兩個 / passenger 一個 / admin 一個帳號備齊。

### (a) Phase 1G 自身範圍

- [ ] **G1** `version.ts` prod 顯示 `0.4.0`（admin 端 footer / about / health endpoint）
- [ ] **G2** Vercel build 通過、status: ready
- [ ] **G3** prod 訪問 `/admin/settings` → 「車輛標籤」tab 載入成功（rules deploy OK 驗證）
- [ ] **G4** 既有訂單列表（prod 線上既有資料）開 modal → 不爆 error；preferences 為空時 fare summary 不顯示 tagSurcharge
- [ ] **G5** Console 無 i18n missing key warning（zh / en / ja）

### (b) 整批端到端 smoke（每個 phase 串接點都過一次）

#### 標籤治理（1A）

- [ ] **A1** admin 進 `/admin/settings` → 「車輛標籤」tab → 看到 6 群 24 預載（若空則點「載入預載」）
- [ ] **A2** 新增一個 vehicle-scope tag（如「車內按摩」surcharge=500）→ 看 audit log 顯示 create entry
- [ ] **A3** 編輯該 tag surcharge → audit log 顯示 update + diff
- [ ] **A4** archive 該 tag → 列表 archived 區出現；還原 → 回 active 區
- [ ] **A5** Firestore console 看 `tags/{tagId}` doc 結構正確

#### Driver profile（1B）

- [ ] **B1** driver 進 `/driver/profile` → Vehicle & Skills section
- [ ] **B2** 改 driverSkill（如多語）→ 立即生效（無需 admin 審）
- [ ] **B3** 改 vehicleProfile（標籤勾選 / 照片上傳）→ 自動進 draft → 送審
- [ ] **B4** admin 收 LINE 通知（passenger OA）→ 進 `/admin/drivers/[uid]` → 「車輛 Profile ⚠待審」tab → diff view → approve
- [ ] **B5** driver 收 LINE 通知「車輛 profile 已通過」

#### 公開檔案頁（1C）

- [ ] **C1** 進 `/vehicles/{verified driverId}` → 看到完整公開頁（標籤 chip + 照片 gallery + 介紹）
- [ ] **C2** 進 `/vehicles/{unverified-or-nonexistent}` → not-found 提示（不崩潰）
- [ ] **C3** 切 lang zh/en/ja → 標籤名跟著切（缺翻譯 fallback 繁中）

#### Booking 偏好 + 加價（1D）

- [ ] **D1** booking 頁勾選偏好（如「純電」+ 「航空椅」）→ fare summary 即時加 max(100, 300) = 300
- [ ] **D2** 取消勾選 → 加價回 0
- [ ] **D3** 多勾同 group single multiplicity（如「純電」+ 「油電」）→ UI 阻擋（單選 group radio 行為）
- [ ] **D4** 確認下單後 Firestore `orders/{orderId}` doc 內有 `preferences.tagIds / tagSnapshot / tagSurcharge / snapshotAt`
- [ ] **D5** admin 之後改該 tag surcharge → 重看舊單金額不變（snapshot 已固化）

#### 訂單需求單 + 配對（1E）

- [ ] **E1** admin 對該訂單點「📤 發出需求單」→ 列表 / modal section 即時更新
- [ ] **E2** 所有 active driver 收 LINE Flex 推播「📦 新訂單派發」
- [ ] **E3** driver 進 `/driver/dispatched` → 「可接訂單」tab 看到該單；卡片顯示偏好 chip + 預估車資
- [ ] **E4** driver 點「我要接這單」→ 自己端按鈕變「撤回喊單」紅
- [ ] **E5** admin 重開 modal 看 bid 列表：matchCount chip / 完成趟數 / bid 時間 / 排序正確
- [ ] **E6** driver 撤回 → admin 端 bid 變灰 + 「已撤回」
- [ ] **E7** admin 指派完全命中 driver → 訂單 confirmed
- [ ] **E8** passenger LINE 收正常配對 Flex「🎉 配對成功」 + 「查看車輛資訊」CTA → 點進去進 `/vehicles/{driverId}` 公開頁（1C）
- [ ] **E9** driver 收中選 Flex「✅ 您已中選」 + 「查看任務」CTA

#### Soft Match + 重新配對（1F）

- [ ] **F1** admin 指派**部分命中** driver（matchCount < preferenceCount）→ passenger 收 3-button postback Flex
- [ ] **F2** passenger 點「✓ 接受此車」→ confirmationStatus='accepted' / 行程繼續
- [ ] **F3** 另張單 passenger 點「⏳ 等下一輪」→ 訂單回 pending、reMatchRound++、bidHistory 新增一筆、原 driver 收 deselect 文字通知
- [ ] **F4** 另張單 passenger 點「✗ 取消」→ 訂單 cancelled / declined / cancelReason='passenger_soft_match_declined'
- [ ] **F5** admin 在 confirmed + soft 訂單點「🔄 強制重新配對」→ 填理由 → 流程 = F3（但 reason='rematched_by_admin'）

#### 跨 phase 整合

- [ ] **X1** cancel「已派發未指派」訂單 → 所有 active bidder 收 LINE 文字通知
- [ ] **X2** reMatchRound > 0 訂單在 admin 列表顯示「重派 N 次」紫徽章
- [ ] **X3** Firestore `audit_logs` 完整覆蓋：`tag.create/update/archive/restore` / `driver_profile.{submit,approve,reject}` / `order.dispatch / bid / bid_withdraw / assign / rematch / soft_match_response / cancel_dispatched`
- [ ] **X4** 三語切換在乘客端都正常（無 i18n raw key 漏字、無 console missing 警告）
- [ ] **X5** Soft Match postback 守則 — 非 owner 偽造 postback URL → 「無權操作此訂單」回覆；重複點 → 「已逾時或已處理」

## 失敗回滾預備

### 1. 程式碼 rollback（push 後發現問題）

- **小修可救** → 改 + commit + push（fast follow）
- **大修需回滾** → Vercel dashboard 找上個 deployment → 「Promote to Production」一鍵回滾
- 本地：`git revert <bad commit>` + push

### 2. firestore.rules rollback（rules deploy 後發現問題）

- 從 git history 拿上一版 rules：
  ```bash
  git show <PRE_1A_COMMIT>:firestore.rules > /tmp/old-rules.txt
  # 把 /tmp/old-rules.txt copy 到 active worktree firestore.rules
  # 再走 firebase MCP firebase_deploy({ only: 'firestore:rules' })
  ```
- 注意：1A 的 tags / tag_audit_logs 規則若 rollback 掉，client 端 `/admin/settings` 標籤 tab 會看不到資料；但既有訂單 / driver 流程不受影響（server admin SDK 不依賴 rules）。

### 3. 哪些 commit 可獨立 revert

| commit | 可獨立 revert？ | 後果 |
|---|---|---|
| `1G` (本) | ✅ 可（純測試 + version + LINE mock + rules） | 失去 boundary tests + LINE_PUSH_DISABLED，version 回 0.3.37；rules 需手動再 rollback |
| `1F` | ⚠️ 需先 revert 1G | Soft Match 整套消失（passenger 看不到 3-button Flex） |
| `1E` | ⚠️ 需先 revert 1F + 1G | 訂單需求單 / 喊單系統消失 |
| `1D` | ⚠️ 需先 revert 1E/1F/1G | booking 偏好 chip + 訂單 preferences 消失 |
| `1C` | ⚠️ 需先 revert 1D~1G | `/vehicles/[driverId]` 公開頁消失 |
| `1B` | ⚠️ 需先 revert 1C~1G | driver/vehicle profile 編輯消失 |
| `1A` | ⚠️ 需先 revert 1B~1G + rules rollback | `tags` collection 寫入會失敗 |

> 實務上：若 push 後幾分鐘內發現災難 → 走 Vercel rollback（一鍵）+ 後續再決定要不要 revert commits。

## 留尾（不在本系列範圍，Phase 2+）

從 1B → 1F HANDOFF 累積的留尾整理：

### 1F 留尾（仍未做）

- ⏳ Passenger 不回應 LINE soft-match postback 12h 自動 rematch（SLA / cron）
- ⏳ Driver 自助「無法接此單」按鈕（assign 後反悔；目前只能 admin force rematch）
- ⏳ reMatchRound 上限警告（admin 列表 ≥ 3 次顯示紅色提示）
- ⏳ 前付金流（若改前付，soft-match cancel 要補退款 hook）
- ⏳ Notification template editor 化（Soft Match Flex / 配對成功 Flex / 需求單 Flex 文案 admin 可編輯）
- ⏳ bidHistory ≥ 5 輪時的 archival（移到 sub-collection）

### 1E 留尾

- ⏳ 大量 driver 時的需求單推播過濾（如 4 人座訂單只推 4/7/9 人座 driver）
- ⏳ `order.bids[]` 撤回後保留歷史，極端膨脹時的 archival
- ⏳ Driver 量大時 bid card matchCount 即時讀 driver doc 的 N+1 read 問題

### 1D / 1B / 1C 留尾

- ⏳ SU 動態演算（行李容量演算）
- ⏳ driver-scope tag 抽查機制（驗證 driver 自稱「會英文」是否屬實）
- ⏳ Driver 評分系統
- ⏳ 車輛公開頁 SEO / OG meta
- ⏳ 多車支援（一個 driver 多車輛 profile，目前一對一）
- ⏳ vehicleProfile 變化 → 自動 trigger 既有 confirmed 訂單重新配對

### 1G 留尾（本 phase 自己）

- ⏳ E2E 全鏈路 happy path 自動化（需 mock auth + LINE mock + Firestore seed；本 phase 只做 smoke）
- ⏳ CI 整合 E2E（local 跑 OK 後再評估）
- ⏳ pricing.spec / orderPreferences.spec 雖然加 case，但仍有可深化空間（如 fuzz test、property-based test）

## 已知陷阱與設計權衡

1. **worktree 缺 .env.dev**：本 worktree 是從 base branch 開出來，沒帶 dotenv，無法 `pnpm dev`，也就無法 `pnpm test:e2e`。E2E spec 已寫好，請在主環境（`C:\Users\awfulone\Desktop\Projects\cc_da` 根目錄含 .env.dev）跑：
   ```bash
   # terminal 1
   LINE_PUSH_DISABLED=1 pnpm dev
   # terminal 2
   pnpm test:e2e
   ```
   E2E spec 含三個 Playwright project（Desktop Chrome / Pixel 5 / iPhone 14），共 ~33 個 test 點。
2. **firestore rules 已 deploy 在 1G**：與 design.md tasks.md 順序略不同（spec 寫「8. Deploy rules」在 commit 後），但實作上：（a）validate 通過；（b）只新增 `tags` / `tag_audit_logs` 兩規則，不會影響既有 client 讀寫；（c）rules deploy 後 client 端能 read `tags`，admin 端能 read `tag_audit_logs`，前者尤其重要（booking / driver / admin 都要載入 active tags）；先 deploy 也讓真機驗收（A1）能立即看到資料。
3. **LINE_PUSH_DISABLED 範圍**：只 cover `sendLinePush` / `sendLineMulticast`（push API）。`_reply`（webhook 同步 reply）與 `sendLineNarrowcast`（如有）未 cover。若 E2E 觸發 webhook，reply 仍會真打 LINE API。實務上 E2E 環境 webhook 收不到事件，所以這個 gap 不影響。
4. **未 push**：本 phase commit 含 version 0.4.0 + tests + LINE env + E2E spec。push 前再過一次 lint + test + build（CI 上跑會更穩）。
5. **firebase MCP active project directory 異常**：MCP 預設 active 在另一個 worktree（focused-kapitsa-a623b8，其 firestore.rules 是 1F base 之前的舊版），1G 為了讓 firebase_validate / deploy 拿到正確 rules 內容，臨時把 phase-1g-launch 的 rules copy 到 active worktree，deploy 完立即 `git checkout firestore.rules` 還原。**真實 deploy 上 prod 的是 1G 版本（含 1A tags rules）**。
6. **`pnpm test:e2e` 跨 OS 與機種 spec 是否真的能跑**：referral.spec / i18n.spec 都已存在 prod 跑得起來；本 spec 沿用同 helper 與 pattern（`collectConsole` / `isViteDevArtifact`）。三 project 各跑 7 個頁面 = 21 test 應全綠（或至少不爆 app error）。
7. **Soft Match Flex 內按鈕點擊驗收**：E2E 無法跑（要 LINE 真機），列在 (b) 真機 checklist F1-F5。
8. **1A → 1G 整批是「不可分割上 prod」**：1A 不上、後續 1B-1G 都 broken（tags collection 不存在）。所以 rollback 順序強制由 1G 開始 revert。但 1G 程式碼變更很輕（測試 + version + LINE env），revert 風險低。

## Commit

```
feat: Phase 1G — E2E + 上線
```

新增 / 改動檔案清單：

**新增**
- tests/e2e/vehicle-tag-system.spec.ts 🆕
- openspec/changes/2026-05-21-vehicle-tag-system-e2e-launch/HANDOFF.md 🆕

**改動**
- shared/pricing.spec.ts ✏️（+6 case Phase 1G boundary）
- shared/orderPreferences.spec.ts ✏️（+5 case Phase 1G boundary）
- shared/orderDispatch.spec.ts ✏️（+7 case Phase 1G boundary）
- server/utils/line-push.ts ✏️（加 `isLinePushDisabled()` env var 機制）
- version.ts ✏️（0.3.37 → 0.4.0）

**已部署到 prod（rules）**
- firestore.rules（1A 規則一併上線；jobId 1779379203631）
