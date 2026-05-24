# HANDOFF — admin-orders-dispatch-tiers

> 跨視窗接手用 prompt 集中於此。Brain AI 視需要複製整段 code block 到新視窗。

## 視窗依賴鏈

```
Step 0 (this) ── docs commit + push main
  ├─ Step 1 ── 獨立可上 prod（純 UI）
  ├─ Step 2 ── 獨立可上 prod
  └─ Step 3 ── 獨立可上 prod
       └─ Step 4 ── 依賴 3
            └─ Step 5 ── 依賴 4 + archive change
```

Step 1 / 2 / 3 可平行；Step 4 / 5 強順序。

---

## Step 1（視窗 2）— Wave 1A：admin/orders 列表派單按鈕

```
Step 1/6 — Wave 1A：admin/orders 列表加發布/重發按鈕

先讀：
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/proposal.md
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/design.md（§6.1）
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/tasks.md「Phase 1A」section
- .claude/projects/*/memory/MEMORY.md（特別 project-da / 既有 wave context）
- CLAUDE.md

任務範圍（純前端，後端 endpoint 不動）：
1. app/pages/admin/orders/index.vue 列表 action column 依狀態切換按鈕：
   - !dispatchAt → 「📤 發布需求單」(call ClickDispatchFlow)
   - dispatchAt && !assignedDriverId → 「🔁 重新發佈」+ dispatchCount > 1 時加 ×N chip
   - assignedDriverId → 「✓ 已指派」disabled
2. 兩按鈕點擊先 UseAsk() 二次確認：
   - 發布：「確定發送需求單給司機？」
   - 重發：「已發送 N 次，確定再次發送？」
3. 確認後 call 既有 endpoint：
   - POST /nuxt-api/admin/orders/{orderId}/dispatch
   - POST /nuxt-api/admin/orders/{orderId}/redispatch
4. 不刪 Edit modal 內既有「📤 發出需求單」按鈕（列表只是新增入口）
5. 三語 i18n（zh / en / ja）對齊既有翻譯檔

驗收：
- pnpm lint:fix / pnpm test / pnpm build 全綠
- 本機 dev 驗 3 場景（未發 / 已發未派 / 已指派）

完成後：
- commit msg: "feat(admin): orders 列表加發布/重發需求單按鈕"
- push main
- 報 commit hash + 給 Brain AI prod 驗收清單（3 場景）
- 不 archive change（最後 Step 5 才 archive）

注意：本步驟不動 dispatchVisibility schema（那是 Step 4 範圍）；發布表單暫時不選首發等級（後端 dispatch.post.ts 不接此參數，Step 4 才加）。
```

---

## Step 2（視窗 3）— Wave 1C：訂單 tag 後修 + 車資重算

```
Step 2/6 — Wave 1C：訂單 tag 後修 + 車資重算 + 折扣碼重檢

先讀：
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/proposal.md
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/design.md（§4）
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/tasks.md「Phase 1C」section
- .claude/projects/*/memory/MEMORY.md（特別 project-fare-v2 / project-discount-codes / project-da）
- CLAUDE.md

關鍵：先讀 shared/pricing.ts 確認 Fare V2 calculate 是否易於從 PATCH endpoint 呼叫；若 inline 寫死在 orders/index.post.ts，先抽 shared/fare/calculate.ts 公用 util（單獨一個 commit 不夾雜邏輯變動）。

任務範圍：
1. server/utils/discount-recheck.ts 🆕 helper 重檢折扣碼（過期 fallback 原 discount + 回傳 warning='expired_fallback'）
2. server/routes/nuxt-api/admin/orders/[orderId].patch.ts 擴充：
   - 接 body.preferences.tagIds
   - 狀態守則：pending / dispatched 可改；assigned 後 forbiddenError
   - 重 snapshot（複用 Phase 1D buildPreferencesSnapshot）+ 重算 fare + 重檢 discount
   - 寫 audit log: action='order.tag-update.price-recalc'
   - 回傳 success + 新 finalTotal + warning
3. server/routes/nuxt-api/admin/orders/[orderId]/recalc-preview.post.ts 🆕：
   - dry-run 不寫 doc
   - 回傳 { before, after, diff, warnings }
4. app/pages/admin/orders/index.vue Edit modal 加 tag 編輯區塊：
   - 複用 PassengerTagPreferencePicker.vue
   - reactive watch tagIds debounce 300ms → call ApiRecalcPreview
   - 顯示「原價 → 新價 → 差額」卡片
   - 折扣碼過期 warning
   - 確認 UseAsk → call ApiUpdateOrderTags
   - assigned 狀態 disabled + tooltip
5. 三語 i18n
6. **不**通知乘客（不寫 LINE push）

驗收：
- pnpm lint:fix / pnpm test（含新 case ≥ 80% coverage）/ pnpm build 全綠
- 本機 dev 驗 4 場景：
  · pending tag 改動 → 預覽 → 確認 → 寫成功 + audit log
  · dispatched tag 改動 → 同上
  · assigned tag 改動 → 403 + UI disabled
  · 有 discount code 且碼過期 → warning + fallback

完成後：
- commit msg: "feat(admin): 訂單後修 tag 觸發車資重算"
- push main
- 報 commit hash + 給 Brain AI prod 驗收清單
- 不 archive change

注意：若需抽 Fare V2 公用 util，先做一個獨立 refactor commit（feat 或 refactor: 抽 Fare V2 為公用 util），再做 feat commit。
```

---

## Step 3（視窗 4）— Wave 2A：driverCategory 編輯 UI

```
Step 3/6 — Wave 2A：admin/drivers/[uid] 加 driverCategory 編輯 UI

先讀：
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/design.md（§1.2）
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/tasks.md「Phase 2A」section
- .claude/projects/*/memory/MEMORY.md（特別 project-da / project-p27-driver-application-migration）
- CLAUDE.md

任務範圍：
1. shared/types/driver-category.ts 🆕：
   - DRIVER_CATEGORY const enum（NOVICE='0' / STANDARD='1' / PRO='2'）
   - DRIVER_CATEGORY_LABEL 三語 record
   - DriverCategory type
2. server/utils/driver-category.ts 🆕：
   - re-export from shared
   - getCategoryLabel(level, lang) helper
   - 升級規則 stub（comment block 列三 metric 候選：tripCount / distanceKm / rating）
3. app/pages/admin/drivers/[uid].vue 加 driverCategory 編輯區塊（目前 181 行只能讀）：
   - ElSelect 三選一（中文 label + 等級號）
   - 「儲存」UseAsk() 二次確認
   - call ApiUpdateDriver({ driverCategory })
   - 顯示最後修改時間 + adminId（從 audit log）
4. server/routes/nuxt-api/admin/users/[uid].patch.ts 加 audit log：
   - 若 body.driverCategory 改動 → write driver.category-changed audit entry
   - 含 before / after / adminId / timestamp
5. 三語 i18n

驗收：
- pnpm lint:fix / pnpm test / pnpm build 全綠
- 本機 dev 驗：admin 改某司機 category → audit log 寫入 → driver doc 更新

完成後：
- commit msg: "feat(admin): drivers 詳情頁加 driverCategory 編輯"
- push main
- 報 commit hash
- 不 archive change

注意：第一版升級規則只留 comment stub，不實作自動升級邏輯。
```

---

## Step 4（視窗 5）— Wave 2B+2C：schema + 發布表單 + filter + bid 守則 + LINE 分批 + 倒數 + migration

```
Step 4/6 — Wave 2B+2C：訂單分級派單 schema + filter + 守則 + multicast 分批 + 倒數 UI + migration

先讀：
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/proposal.md
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/design.md（§1.1 / §2 / §3.2 / §5 / §6.3 / §6.5）
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/tasks.md「Phase 2B + 2C」section
- .claude/projects/*/memory/MEMORY.md（特別 project-p29-line-dual-channel / project-line-template-expansion / project-da）
- CLAUDE.md

**重要**：依 Brain AI 拍板，不符合等級的司機完全看不到該訂單。server filter 直接過濾，client 根本拿不到資料。bid endpoint 守則只防直打 API（403 + log anomaly），不存在 client toast UX flow。

任務範圍：
1. shared/types/dispatch-visibility.ts 🆕 + AdminOrder interface 加欄位
2. server/utils/dispatch-duration.ts 🆕：DISPATCH_DURATION hard-code config + getNextDowngradeAt() helper
   - airport-pickup/dropoff: 2→1=180s, 1→0=300s
   - transfer: 2→1=480s, 1→0=720s
   - charter: 2→1=1800s, 1→0=3600s
3. server/utils/order-dispatch.ts：
   - loadActiveDrivers 加 optional minCategory 參數
   - multicastByLevel(orderId, level, templateKey) helper
4. dispatch.post.ts + redispatch.post.ts 寫入 dispatchVisibility（首發 = startLevel；重發 reset currentLevel）
5. admin/orders/index.vue 列表發布按鈕 + Edit modal 都加「首發等級」select：
   - '2' / '1' / '0' / '__draft__'
   - '__draft__' 不 call endpoint，只儲存其他欄位
6. dispatched-orders/index.get.ts 加 server filter：
   - driver.driverCategory >= order.dispatchVisibility.currentLevel
   - 不符合司機完全拿不到資料
7. bid.post.ts transaction 守則加等級檢查：
   - driver.category < currentLevel → log anomaly + return forbiddenError
8. driver/dispatched/index.vue 訂單卡加倒數區塊：
   - app/composables/useCountdown.ts 🆕
   - openedAt + duration[currentLevel] - now，秒倒數
   - 到 0 顯示「即將降級」
   - 剩 ≤ 60s 變紅
9. server/scripts/backfill-dispatch-visibility.ts 🆕 migration：
   - 全 orders backfill startLevel='0' / currentLevel='0' / openedAt=dispatchAt ?? createdAt
   - --dry-run flag
   - batch 500
10. 三語 i18n

驗收：
- pnpm lint:fix / pnpm test（≥ 80% coverage）/ pnpm build 全綠
- 本機 dev 驗 5 場景：
  · pro 司機看得到 currentLevel=2
  · standard 司機看不到 currentLevel=2，看得到 ≤1
  · novice 看不到 ≥1，只看 0
  · novice 直打 bid API 對 currentLevel=2 訂單 → 403 + log
  · 重發訂單 → currentLevel reset 回 startLevel
- prod migration dry-run pass

完成後：
- commit msg: "feat(dispatch): 訂單分級派單 schema + filter + 守則"
- push main → Vercel deploy
- **prod migration 執行**（Claude 自己用 firebase MCP 跑，不丟 User）
- 報 commit hash + migration 結果（doc count / fail count）
- 不 archive change

留尾給 Step 5：lazy 自動降級 / admin 手動降級按鈕 / LINE level-down template
```

---

## Step 5（視窗 6）— Wave 2D：Lazy 降級 + admin 手動 + LINE template + archive

```
Step 5/6 — Wave 2D：Lazy 自動降級 + admin 手動降級/全開放 + LINE template + archive

先讀：
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/proposal.md
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/design.md（§3 / §6.4）
- openspec/changes/2026-05-24-admin-orders-dispatch-tiers/tasks.md「Phase 2D」section
- .claude/projects/*/memory/MEMORY.md（特別 project-line-template-expansion / project-p40 / project-p43 / project-p44b）
- CLAUDE.md

任務範圍：
1. server/routes/nuxt-api/driver/dispatched-orders/index.get.ts 加 lazy check：
   - 對每筆 candidate order 判斷 now > getNextDowngradeAt()
   - transaction re-fetch + compare currentLevel 防 race
   - 觸發 multicastByLevel(orderId, newLevel, 'dispatch.level-down')
2. server/routes/nuxt-api/admin/orders/[orderId]/dispatch-level/downgrade.post.ts 🆕：
   - 守則 admin + pending + currentLevel != '0'
   - currentLevel-- + openedAt=now + reason='manual-downgrade'
   - multicast + audit log
3. server/routes/nuxt-api/admin/orders/[orderId]/dispatch-level/force-open.post.ts 🆕：
   - 守則同上
   - currentLevel='0' + reason='force-open-all'
   - multicast + audit log
4. app/pages/admin/orders/index.vue 加兩按鈕：
   - 「⬇️ 立即降級」+ 「🔓 全開放」
   - 兩按鈕 currentLevel='0' 時 disabled
   - UseAsk 二次確認
5. line_templates/dispatch.level-down 🆕 Firestore doc：
   - Flex template 含 placeholders（orderId / orderType / dropoffArea / fareEstimate / etaWindow / newLevel）
   - 三語 lang field
   - requiresSuperLevel=false
   - 用 firebase MCP 寫入 prod
6. 三語 i18n

驗收：
- pnpm lint:fix / pnpm test（≥ 80% coverage）/ pnpm build 全綠
- 本機 dev 驗 6 場景：
  · airport currentLevel=2 等 3 分鐘 → 自動降到 1 + standard 看到 + LINE push
  · 從 1 等 5 分鐘 → 降到 0 + novice 看到 + LINE push
  · transfer 8/12 min 正確
  · charter 30/60 min 正確
  · admin 立即降級 → 二次確認 → 降一級 + LINE push
  · admin 全開放 → currentLevel='0' + LINE push 全 approved
  · 兩司機同時 GET：transaction 不重複降級

完成後：
- commit msg: "feat(dispatch): 分級派單降級機制 + LINE level-down template"
- push main → Vercel deploy
- 跑 /opsx:verify 確認 5 phase tasks 全勾、0 critical
- 跑 /opsx:archive 2026-05-24-admin-orders-dispatch-tiers
- commit msg: "docs: archive admin-orders-dispatch-tiers"
- push main
- 報兩個 commit hash + 給 Brain AI prod e2e 驗收清單（6 場景）
- 寫 memory project-admin-orders-dispatch-tiers.md
```

---

## 留尾項追蹤（umbrella）

- **升級規則**：第一版只 stub，日後 phase 視需要做 trip count / distanceKm / rating 自動升級
- **Settings UI 調整 duration**：第一版 hard-code，日後若需要 admin 自調搬 Firestore config
- **Cron 主動降級**：第一版 lazy + manual 夠用，深夜無司機 GET 時訂單可能卡住等 admin 手動
- **全開後再次提示 admin**：第一版略
- **Per-driver opt-out / quiet hours**：日後若噪音問題明顯再加
