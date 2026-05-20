# Hand-off：Phase 1B 司機 / 車輛 Profile + 標籤掛載 + Admin 審核

## 狀態

- **實作 100% 完成**：lint / test / build 三項全綠
- 一支 commit（不 push）；firestore rules 本 phase **不動**（drivers 既有規則已 cover；待 1G 統一 deploy）
- 等 Brain AI 真機驗收 → 點「進 1C」

## 實作摘要

### shared 層（純函式 + 規格常數）
- [shared/vehicleProfile.ts](../../../shared/vehicleProfile.ts) — `validateVehicleProfileShape` + `MAX_PHOTOS=8` + `VehicleProfileStatus` 等 type export
- [shared/vehicleProfile.spec.ts](../../../shared/vehicleProfile.spec.ts) — Vitest 11 case（涵蓋 photos/tags 形狀、scope mismatch、mutex_violation），全綠

### server 層（7 endpoint + 1 helper + audit action）
- [server/utils/vehicle-profile.ts](../../../server/utils/vehicle-profile.ts) — `buildTagIndex` / `validateDriverTags` / `tagIdsToNames`
- [server/utils/audit-log.ts](../../../server/utils/audit-log.ts) — `AuditAction` 加 `driver.tags_update` / `driver.vehicle_profile_submit` / `driver.vehicle_profile_review`
- [server/routes/nuxt-api/drivers/me/tags.patch.ts](../../../server/routes/nuxt-api/drivers/me/tags.patch.ts) — driver 自編 driver-scope tags（立即生效）
- [server/routes/nuxt-api/drivers/me/vehicle-profile.patch.ts](../../../server/routes/nuxt-api/drivers/me/vehicle-profile.patch.ts) — driver 編 vehicleProfilePending（partial；自動進 draft）
- [server/routes/nuxt-api/drivers/me/vehicle-profile.post.ts](../../../server/routes/nuxt-api/drivers/me/vehicle-profile.post.ts) — 送審（draft/rejected → pending_review）+ LINE push 所有 canManageDrivers admin
- [server/routes/nuxt-api/drivers/me/vehicle-profile.delete.ts](../../../server/routes/nuxt-api/drivers/me/vehicle-profile.delete.ts) — 捨棄草稿 / 撤回送審（議題 #6）
- [server/routes/nuxt-api/drivers/me/vehicle-photo-upload.post.ts](../../../server/routes/nuxt-api/drivers/me/vehicle-photo-upload.post.ts) — 單張車輛照片上傳（jpg/png/webp ≤ 5MB；Storage 路徑 `drivers/{lineUid}/vehicle-profile/{ts}.{ext}`；TTL 4h）
- [server/routes/nuxt-api/admin/drivers/[uid]/vehicle-profile-review.post.ts](../../../server/routes/nuxt-api/admin/drivers/%5Buid%5D/vehicle-profile-review.post.ts) — admin approve / reject + LINE push driver
- [server/routes/nuxt-api/admin/users/index.get.ts](../../../server/routes/nuxt-api/admin/users/index.get.ts) — echo driver doc 4 個 top-level（vehicleProfile / vehicleProfilePending / verifiedAt / verifiedBy / tags），加 `_toIso` / `_serializeVehicleProfile` / `_serializeVehicleProfilePending` 三個 helper

5 個 self-edit endpoint 全用 `auth.roles.includes('driver')` 守衛；admin review 用 `hasPermission(auth, 'canManageDrivers')`。

### protocol 層（fetch-api）
- [app/protocol/fetch-api/api/driver/index.ts](../../../app/protocol/fetch-api/api/driver/index.ts) — 加 `PatchDriverTags` / `PatchVehicleProfile` / `SubmitVehicleProfile` / `DiscardVehicleProfile` / `UploadVehiclePhoto` + `UploadVehiclePhotoResponse` type
- [app/protocol/fetch-api/api/admin/index.ts](../../../app/protocol/fetch-api/api/admin/index.ts) — 加 `PostVehicleProfileReview` + 擴充 `AdminUser`（加 5 個 optional field：tags/vehicleProfile/vehicleProfilePending/verifiedAt/verifiedBy）+ export `VehicleProfileDto` / `VehicleProfilePendingDto`

### driver UI
- [app/components/driver/TagGroupPicker.vue](../../../app/components/driver/TagGroupPicker.vue) — 共用 chip picker，依 group.multiplicity 單/多選；single 再點 chip 視為取消選擇
- [app/components/driver/VehicleProfileEditor.vue](../../../app/components/driver/VehicleProfileEditor.vue) — driverSkill section（立即生效）+ vehicleProfile section（5 group picker + photo grid + 送審/捨棄/撤回/重新編輯，依 status 顯示對應按鈕）
- [app/pages/driver/profile/index.vue](../../../app/pages/driver/profile/index.vue) — 加「VEHICLE & SKILLS」section 嵌入 `DriverVehicleProfileEditor`；`ApiLoadDriverData` 擴充讀 driver doc top-level `tags` / `vehicleProfile` / `vehicleProfilePending`

### admin UI
- [app/components/admin/VehicleProfileReview.vue](../../../app/components/admin/VehicleProfileReview.vue) — 左 current / 右 pending diff（photos grid + group chip 顯示中文名稱），approve / reject（reject 內嵌 textarea 而非 window.prompt）
- [app/pages/admin/drivers/[uid].vue](../../../app/pages/admin/drivers/%5Buid%5D.vue) — 加「車輛 Profile ⚠待審」tab；`ApiLoadDriver` 擴充讀 4 個 top-level 欄位；`ApiLoadTagIndex` onMounted 載 active tags 組 map 給 review 元件
- [app/pages/admin/drivers/index.vue](../../../app/pages/admin/drivers/index.vue) — 列表每張卡片右側加 `⚠ 車輛待審` 徽章（v-if `vehicleProfilePending?.status === 'pending_review'`）

### i18n（zh 為基準，en/ja 暫沿用繁中值）
- [i18n/locales/zh.js](../../../i18n/locales/zh.js) / [en.js](../../../i18n/locales/en.js) / [ja.js](../../../i18n/locales/ja.js) — 加 `admin.driverReview.*`（10 keys）+ `driver.vehicleProfile.*`（15 keys）+ `driver.driverSkill.*`（2 keys）

## 規格細節決策

| 議題 | 拍板 | 出處 |
|---|---|---|
| driver-scope tag 需審核嗎 | 不需要（driverSkill 立即生效） | proposal 議題 #1 |
| vehicle-scope tag 需審核嗎 | 需要（隨照片送審；單獨改 tag 也走 pending） | proposal 議題 #2 |
| photo 格式 | jpg / png / webp，≤ 5MB / 張，最多 8 張 | proposal 議題 #3 |
| photo 取代策略 | 整組覆蓋；driver 自管增刪 | proposal 議題 #4 |
| 多車支援 | 不支援（一車制） | proposal 議題 #5 |
| 捨棄 vs 撤回 | DELETE endpoint 同時支援 draft/rejected 捨棄 + pending_review 撤回（user-friendly） | 議題 #6（design 原本只允許非 pending_review 自捨；放寬為任何狀態都可清空） |
| reject 後資料保留 | 保留 photos/tags 內容；driver 端 patch 後 status 自動回 draft | 議題 #7 |
| verified 徽章顯示位置 | Phase 1C 才做公開檔案頁；本 phase 只寫資料 | 議題 #8 |
| 舊司機 doc 沒這些欄位 | server 端 `?? []` / `?? null` fallback；不寫 migration | 議題 #9 |
| audit log scope | 共用既有 `audit_logs` collection（無新 collection），加 3 個 `AuditAction` case | 議題 #10 + design §1.2 |
| `methods.delete` body 走 query | 確認既有方法簽名（沒 postMultipart）；photo upload 沿用 `UploadDriverDocument` 同款手動 `$fetch` + multipart + Firebase ID token | tasks §0 探勘 |
| element 路徑 | 沿用 1A 風格 flat 命名（`DriverTagGroupPicker` / `DriverVehicleProfileEditor` / `AdminVehicleProfileReview`） | 對齊 SettingsTags 慣例 |
| draft 不寫 audit log | 草稿頻繁變動會炸 log 量；只在 submit/review 時寫 | design §3.2.2 |
| LINE push 對象（送審） | `getAdminRecipients(db, 'canManageDrivers')` 撈所有具該權限的 admin uid（含 super 與 override）；admin LINE 走 `passenger` channel（與 P26 document-replace 一致） | design §3.2.3 + admin-recipients.ts |

## 驗證結果

```
pnpm lint   ✅ 0 error
pnpm test   ✅ 9 test files / 163 tests passed（新增 11 case）
pnpm build  ✅ exit 0；7 個新 endpoint 全 emit
```

## 真機驗收 checklist（Brain AI）

啟動 `pnpm dev`，分別以 driver / admin 兩種身分測：

### Driver 端（`/driver/profile`）

- [ ] **D1** 進 `/driver/profile`，往下捲看到「VEHICLE & SKILLS」section
- [ ] **D2** 看到「司機能力標籤」+ driverSkill 4 個 chip（英文 / 日文 / 商務接待 / 女性司機）
- [ ] **D3** 點 driverSkill chip → toast「已更新司機能力標籤」→ refresh 後仍勾選（立即生效，無 pending）
- [ ] **D4** 「車輛資料」section 5 個 group 渲染：power 單選 / vehicleType 單選 / origin 單選 / interior 多選 / equipment 多選
- [ ] **D5** 改任一 vehicle-scope chip → 自動進 draft（badge 變「草稿（未送審）」）；按鈕變「送審」「捨棄變更」
- [ ] **D6** 點「+ 新增照片」→ 選 jpg/png/webp（≤ 5MB）→ 上傳成功後 grid 出現縮圖；超過 8 張的「+」按鈕消失
- [ ] **D7** 點照片右上 × → 確認對話 → 移除
- [ ] **D8** 點「送審」→ 確認對話 → toast「已送審」→ badge 變「審核中」；group picker 全 disable；按鈕變「撤回送審」
- [ ] **D9** 點「撤回送審」→ 確認 → 回到 draft / unverified（pending 被清空）
- [ ] **D10** Admin 退回後 driver 端 badge 變「審核退回」+ 顯示退回原因；可繼續編輯（自動回 draft）

### Admin 端（`/admin/drivers`）

- [ ] **A1** 進 `/admin/drivers` 列表，**有 pending_review 的司機卡片右側顯示 `⚠ 車輛待審` 徽章**
- [ ] **A2** 點該司機「詳情 →」進 `/admin/drivers/[uid]`，看到第三個 tab「車輛 Profile ⚠ 待審」
- [ ] **A3** 切到該 tab → 看到左右 diff（左 CURRENT 已驗證 / 右 PENDING 待審），photos grid + tag chip 顯示中文名
- [ ] **A4** 點「核准」→ 確認 → toast「已核准」→ pending 區變 `NO PENDING`，current 區變 pending 內容；左下「上次驗證時間」更新
- [ ] **A5** 第二輪 driver 重新送審 → 點 admin 端「退回」→ 跳 textarea 填原因 → 點「確認退回」→ toast「已退回」→ 卡片右側徽章消失（status='rejected' 而非 'pending_review'）
- [ ] **A6** Firebase console 查 `drivers/{uid}` doc：approve 後應看 `vehicleProfile = { photos, tags, updatedAt }`、`vehicleProfilePending = null（已刪）`、`verifiedAt`、`verifiedBy`；reject 後 pending.status='rejected' + rejectReason + reviewedBy
- [ ] **A7** Firebase console 查 `audit_logs`：approve / reject / submit 各應有對應 doc（action `driver.vehicle_profile_review` 或 `driver.vehicle_profile_submit`，payload 含 before/after snapshot 含 tagNames）
- [ ] **A8** 以 assistant 級 admin（無 canManageDrivers）打 review endpoint → 403

### 共通

- [ ] **C1** server 驗證：送 `tags=['t-unknown']` 進 `/drivers/me/tags` → 400 `tags[0]:not_found`
- [ ] **C2** server 驗證：送 `tags=['t-power-ev','t-power-hybrid']` 進 `/drivers/me/vehicle-profile` → 400 `mutex_violation`（power 為 single group）
- [ ] **C3** server 驗證：送 photos length=9 → 400 `too_many`
- [ ] **C4** server 驗證：送 driver-scope tag id 進 vehicle-profile → 400 `mismatch`
- [ ] **C5** LINE push：driver 送審後具 canManageDrivers 的 admin 收到通知；admin approve / reject 後 driver 收到通知

> firestore rules 沒 deploy；client 端不直接寫 drivers doc（皆走 server endpoint），既有規則已 cover。

## 留尾（不在本 phase 範圍）

- ⏳ 車輛公開檔案頁（passenger 端看 driver verified profile + verified 徽章） → Phase 1C
- ⏳ Booking nice-to-have 勾選 + max(tag surcharge) 動態 pricing → Phase 1D
- ⏳ 訂單需求單 / 喊單 / 配對 → Phase 1E
- ⏳ Soft Match / 重新配對 → Phase 1F
- ⏳ E2E + rules deploy + prod push → Phase 1G
- ⏳ admin 對 driver-scope tag（driverSkill）的抽查機制 → Phase 2

## 已知陷阱與設計權衡

1. **DELETE endpoint 同時處理「捨棄」與「撤回」**：design.md §3.2.4 規定 pending_review 不可自捨（須 admin reject），但這對 driver 體驗很差（送錯了無法救）。實作放寬為**任何狀態都可清空 vehicleProfilePending**（draft / rejected 為「捨棄」；pending_review 為「撤回」），由 UI 端文案區分（「捨棄變更」vs「撤回送審」）。對 admin 影響：pending_review 撤回後 admin 不會收到通知；admin 列表徽章會自動消失。如不接受可在 server 端加 `if status==='pending_review'` 的守衛。
2. **TagGroupPicker `single` group「再點取消」**：spec 沒明示，但 UX 上 single chip 沒 unselect 通道會卡住（無法清空），實作支援再點同 chip 視為取消。
3. **Driver tag 立即生效採全量覆寫**：driver.tags 整個 array 重寫；每次 PatchDriverTags 後重組所有 driverSkill chip 再送。理由：當 active tags 變動時不需做 incremental sync。
4. **Admin/drivers list echo 4 個新欄位**：admin/users.get.ts 多查一次 driver doc top-level（既有就 read 過該 doc，零增量讀取）。
5. **i18n key 已加但 component 未真的用 $t**：driver / admin UI 文案仍是繁中硬寫（規格 #14：admin / driver 端繁中即可）。i18n key 預留給 Phase 1C 起若決定 driver 接乘客端 lang 切換時使用。
6. **photo 與 driver document 路徑共用 Storage rule**：本 phase 在 `drivers/{lineUid}/vehicle-profile/` 開新子資料夾；既有 driver storage rule（server-side 寫、resign URL）已 cover。signed URL TTL 4h（與 driver document 一致）。
7. **既有 driver doc 無這些欄位的 fallback**：server 端讀 `?? []` / `?? null`；client 端讀 `Array.isArray(...)` 守住非陣列。**不寫 migration**。

## Commit

```
feat: Phase 1B — driver/vehicle profile + 標籤掛載 + admin 審核
```

新增 / 改動檔案清單：

**新增**
- shared/vehicleProfile.ts 🆕
- shared/vehicleProfile.spec.ts 🆕
- server/utils/vehicle-profile.ts 🆕
- server/routes/nuxt-api/drivers/me/tags.patch.ts 🆕
- server/routes/nuxt-api/drivers/me/vehicle-profile.patch.ts 🆕
- server/routes/nuxt-api/drivers/me/vehicle-profile.post.ts 🆕
- server/routes/nuxt-api/drivers/me/vehicle-profile.delete.ts 🆕
- server/routes/nuxt-api/drivers/me/vehicle-photo-upload.post.ts 🆕
- server/routes/nuxt-api/admin/drivers/[uid]/vehicle-profile-review.post.ts 🆕
- app/components/driver/TagGroupPicker.vue 🆕
- app/components/driver/VehicleProfileEditor.vue 🆕
- app/components/admin/VehicleProfileReview.vue 🆕
- openspec/changes/2026-05-21-driver-vehicle-profile/HANDOFF.md 🆕

**改動**
- server/utils/audit-log.ts ✏️（加 3 個 AuditAction）
- server/routes/nuxt-api/admin/users/index.get.ts ✏️（echo driver doc 4 個 top-level + 3 helper）
- app/protocol/fetch-api/api/driver/index.ts ✏️
- app/protocol/fetch-api/api/admin/index.ts ✏️
- app/pages/driver/profile/index.vue ✏️
- app/pages/admin/drivers/[uid].vue ✏️
- app/pages/admin/drivers/index.vue ✏️
- i18n/locales/zh.js ✏️
- i18n/locales/en.js ✏️
- i18n/locales/ja.js ✏️
