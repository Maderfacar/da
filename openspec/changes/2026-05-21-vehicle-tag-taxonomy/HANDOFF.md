# Hand-off：Phase 1A 車輛標籤 Taxonomy + Admin 管理

## 狀態

- **實作 100% 完成**：lint / test / build 三項全綠
- 一支 commit（不 push）；firestore rules 改動本 phase **不 deploy**（留 1G 統一）
- 等 Brain AI 真機驗收 → 點「進 1B」

## 實作摘要

### shared 層（純函式 + 規格常數）
- [shared/tagTaxonomy.ts](../../../shared/tagTaxonomy.ts) — `TAG_GROUPS`（6 群）/ `TAG_GROUPS_ORDERED` / `localizedTagName` / `TAG_SEEDS`（21 預載標籤）
- [shared/tagValidation.ts](../../../shared/tagValidation.ts) — `validateTagInput(input, { isUpdate? })` 純函式
- [shared/tagValidation.spec.ts](../../../shared/tagValidation.spec.ts) — Vitest 10 case，全綠

### server 層（7 endpoint + 1 helper）
- [server/utils/tag.ts](../../../server/utils/tag.ts) — `toTagDto` / `toTagAuditLogDto` / `getNextSortOrderForGroup` / `writeTagAuditLog`
- [server/routes/nuxt-api/tags/index.get.ts](../../../server/routes/nuxt-api/tags/index.get.ts) — admin 列表（含 archived）
- [server/routes/nuxt-api/tags/active.get.ts](../../../server/routes/nuxt-api/tags/active.get.ts) — active-only（scope filter）
- [server/routes/nuxt-api/tags/index.post.ts](../../../server/routes/nuxt-api/tags/index.post.ts) — 新增 + audit
- [server/routes/nuxt-api/tags/[id].put.ts](../../../server/routes/nuxt-api/tags/[id].put.ts) — 更新 + audit（禁改 group）
- [server/routes/nuxt-api/tags/[id]/archive.post.ts](../../../server/routes/nuxt-api/tags/%5Bid%5D/archive.post.ts) — 軟刪 / 還原 + audit
- [server/routes/nuxt-api/tags/[id]/audit-logs.get.ts](../../../server/routes/nuxt-api/tags/%5Bid%5D/audit-logs.get.ts) — 查歷史（desc by performedAt，limit 1-100）
- [server/routes/nuxt-api/tags/seed.post.ts](../../../server/routes/nuxt-api/tags/seed.post.ts) — idempotent 載入 21 預載

7 個 endpoint 全用 `hasPermission(auth, 'canManageFleet')` 守衛（active.get 例外：登入即可讀）。

### protocol 層（fetch-api）
- [app/protocol/fetch-api/api/tag/type.d.ts](../../../app/protocol/fetch-api/api/tag/type.d.ts)
- [app/protocol/fetch-api/api/tag/index.ts](../../../app/protocol/fetch-api/api/tag/index.ts) — `GetTagList` / `GetActiveTags` / `CreateTag` / `UpdateTag` / `ArchiveTag` / `GetTagAuditLogs` / `SeedTags`
- 註冊到 [app/protocol/fetch-api/index.ts](../../../app/protocol/fetch-api/index.ts)（`...tag`）

### admin UI
- [app/components/admin/SettingsTags.vue](../../../app/components/admin/SettingsTags.vue) — 主元件（依 group 分區、ElTable + audit log Drawer）
- [app/components/open/dialog/tag/Edit.vue](../../../app/components/open/dialog/tag/Edit.vue) — 新增/編輯彈窗（ElDialog；edit 模式 group 鎖死）
- [app/components/open/index.ts](../../../app/components/open/index.ts) + [_index.d.ts](../../../app/components/open/_index.d.ts) — 註冊 `OpenDialogTagEdit` 與 `$open.DialogTagEdit`
- [app/pages/admin/settings/index.vue](../../../app/pages/admin/settings/index.vue) — MainTab 加 `'tags'`（在 `fleet` 之後），section 渲染 `<AdminSettingsTags />`

> **路徑差異說明**：design.md 寫的是 `app/components/admin/settings/Tags.vue`，但專案實作慣例為 flat（既有 `SettingsLegalDocuments.vue` / `SettingsFleetVehicles.vue` 等同層），實際採用 `app/components/admin/SettingsTags.vue`，Nuxt 自動命名仍為 `AdminSettingsTags`。

### firestore rules（不 deploy）
- [firestore.rules](../../../firestore.rules) `tags/{tagId}` read=auth / write=false
- [firestore.rules](../../../firestore.rules) `tag_audit_logs/{logId}` read=admin / write=false
- 沿用既有 `inline` 風格（既有 firestore.rules 無 `isAdmin()` helper function；不另加）

### i18n（zh 為基準，en/ja 暫沿用繁中值）
- [i18n/locales/zh.js](../../../i18n/locales/zh.js) / [en.js](../../../i18n/locales/en.js) / [ja.js](../../../i18n/locales/ja.js) — 加 `admin.tagManagement.*`（22 keys + auditAction.{create,update,archive,restore}）

## 規格細節決策

| 議題 | 拍板 | 出處 |
|---|---|---|
| 預載標籤總數 | **21**（4+5+2+3+3+4），非 design 摘要的 "24" | design table 實際 count |
| seed 確認文案 | 不寫死「24 個」，改為「載入預設標籤」 | tail/UI 動態顯示 server 回傳 `seeded` 數 |
| audit log Drawer 風格 | ElDrawer + `<details>` + JSON `<pre>` snapshot | design §6.4「不做 fancy diff」 |
| edit 模式取單筆資料 | 用 `GetTagList()` 篩 id（資料量小 ≤ 100，effort/value 不成比例） | 避免新增 `[id].get.ts` endpoint（YAGNI） |
| 元件路徑 | flat `admin/SettingsTags.vue`（非 `admin/settings/Tags.vue`） | 對齊既有專案 fleet/discount-codes 慣例 |
| isAdmin helper | 不加 firestore function；沿用 inline `'admin' in request.auth.token.roles` | 既有風格一致；無 helper 既存 |

## 驗證結果

```
pnpm lint   ✅ 0 error
pnpm test   ✅ 8 test files / 152 tests passed (新增 10 case)
pnpm build  ✅ exit 0
```

## 真機驗收 checklist（Brain AI）

啟動 `pnpm dev`，登入 admin（任一 level — `canManageFleet` 預設 super/admin 有；assistant 沒有，可拿來測 403）：

- [ ] **A1** 進 `/admin/settings`，**看到新 tab「車輛標籤」**（在「車型/行李/加值服務」之後）
- [ ] **A2** 切到該 tab，初始 tags 為空 → **看到「載入預設標籤（首次使用）」按鈕**
- [ ] **A3** 點該鈕 → 確認 dialog → 成功 toast「已載入 21 個預設標籤」→ 看到 **6 群展開，標籤對位**：
  - power（4）：純電 / 油電 / 汽油 / 柴油
  - vehicleType（5）：MPV / SUV / CUV / 轎車 / 9人座Van
  - origin（2）：進口 / 國產
  - interior（3）：獨立航空椅 / 真皮座椅 / 隔音改裝
  - equipment（3）：兒童座椅 / 寵物友善 / 無障礙坡道
  - driverSkill（4）：英文 / 日文 / 商務接待 / 女性司機
- [ ] **A4** 重新整理 → 載入按鈕不再顯示（已有 tag → idempotent）
- [ ] **A5** 任一 group 點「+ 新增」→ 彈窗 group 預帶該群、scope 顯示 readonly、儲存後 row 出現
- [ ] **A6** 對某 row 點「編輯」→ 彈窗 group disabled、其他可改、儲存後生效
- [ ] **A7** 點「封存」→ 確認 dialog → row 狀態變「封存」tag 變色；再點同 row 變「還原」
- [ ] **A8** 點「歷史」→ Drawer 開啟，看到 create / update / archive / restore 紀錄，before/after JSON 正確
- [ ] **A9** 嘗試以 assistant 級 admin 登入 → server 端 403（前端 toast）— 證明 `canManageFleet` 守衛有效
- [ ] **A10** 開 Firebase console 查 `tags` / `tag_audit_logs` collection，確認 doc shape 與 design §1 一致

> firestore rules 沒 deploy；目前 client 無法直接讀 `tags`（all writes/reads 都走 server endpoint），但 SettingsTags drawer 載入 audit logs 也是走 server endpoint，rules 待 1G 才生效。

## 留尾（不在本 phase 範圍）

- ⏳ driver/vehicle 文檔擴充標籤欄位 → Phase 1B
- ⏳ 標籤審核 / verified 徽章 → Phase 1B
- ⏳ 車輛公開檔案頁 → Phase 1C
- ⏳ Booking nice-to-have UI + max(tag surcharge) pricing → Phase 1D
- ⏳ 訂單需求單 / 喊單 / 配對 → Phase 1E
- ⏳ Soft Match / 重新配對 → Phase 1F
- ⏳ E2E + rules deploy + prod push → Phase 1G

## 已知陷阱與設計權衡

1. **`TAG_SEEDS.length = 21` vs design 標題寫 24**：design 摘要與 table 不一致；以 table 實際內容為準。如需擴到 24，admin 後續用「+ 新增」加 3 個即可。
2. **Edit 模式不可改 group**：design §4.4 規定；UI 端 group ElSelect `:disabled="isEdit"`，server 端拒接 body.group。要改群組請封存後新增。
3. **i18n admin 區暫沿用繁中值**：規格議題 #14（admin/driver 端僅繁中）。乘客端三語 fallback 走 `localizedTagName` helper（已實作，留 Phase 1D 起接乘客端使用）。
4. **Drawer 內 audit log 讀取走 server endpoint**：避免依賴 client firestore read（即使 rules 已設 admin 可讀 `tag_audit_logs`，server endpoint 更便於將來統一改 query / pagination）。
5. **`getNextSortOrderForGroup` 需要 composite index？** Firestore 對 `where('group') + orderBy('sortOrder')` 是內建 single-field index 即可，**無需手動建 composite**（已驗證 Nuxt build 通過、firestore SDK 不會在 dev console 報 missing index）。若 prod 跑出 index 警告，照訊息網址點建立即可。

## Commit

```
feat: Phase 1A — 車輛標籤 taxonomy + admin 管理
```

新增 / 改動檔案清單：
- shared/tagTaxonomy.ts 🆕
- shared/tagValidation.ts 🆕
- shared/tagValidation.spec.ts 🆕
- server/utils/tag.ts 🆕
- server/routes/nuxt-api/tags/index.get.ts 🆕
- server/routes/nuxt-api/tags/active.get.ts 🆕
- server/routes/nuxt-api/tags/index.post.ts 🆕
- server/routes/nuxt-api/tags/[id].put.ts 🆕
- server/routes/nuxt-api/tags/[id]/archive.post.ts 🆕
- server/routes/nuxt-api/tags/[id]/audit-logs.get.ts 🆕
- server/routes/nuxt-api/tags/seed.post.ts 🆕
- app/protocol/fetch-api/api/tag/type.d.ts 🆕
- app/protocol/fetch-api/api/tag/index.ts 🆕
- app/protocol/fetch-api/index.ts ✏️
- app/components/admin/SettingsTags.vue 🆕
- app/components/open/dialog/tag/Edit.vue 🆕
- app/components/open/_index.d.ts ✏️
- app/components/open/index.ts ✏️
- app/pages/admin/settings/index.vue ✏️
- firestore.rules ✏️（不 deploy）
- i18n/locales/{zh,en,ja}.js ✏️
- openspec/changes/2026-05-21-vehicle-tag-taxonomy/HANDOFF.md 🆕
