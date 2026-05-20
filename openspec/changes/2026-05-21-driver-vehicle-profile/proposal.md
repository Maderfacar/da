# Phase 1B — Driver / Vehicle Profile 擴充 + 標籤掛載 + Admin 審核（2026-05-21）

> 接 Phase 1A（[2026-05-21-vehicle-tag-taxonomy](../2026-05-21-vehicle-tag-taxonomy/)）。
> 本 phase 只擴充司機個人 / 車輛資料模型 + 標籤掛載 + 照片上傳 + admin 審核 UI；
> **不動 booking / 配對 / pricing**（留 1D 起）。

## Why

Phase 1A 已建立標籤治理基礎設施（24 個預設標籤 + admin CRUD）。但司機與車輛目前還沒有掛標籤的欄位 — 標籤無法綁到實體上。

需求：
1. 司機 doc 加 `tags[]`（scope=driver 的標籤 id 陣列）
2. 司機 doc 加 `vehicleProfile`（含 photos[] + tags[]，scope=vehicle 的標籤 id 陣列）
3. 司機端 UI 可自己選標籤 + 上傳車內多角度照片 → 進 pending 狀態
4. Admin 端可審核 pending vehicleProfile（approve 升級為 `verified` / reject 退回）
5. 所有變更寫 audit log

## What Changes

### 範圍（Phase 1B only）

- 擴充 `drivers/{lineUid}` doc 加 4 個 top-level 欄位：
  - `tags: string[]`（driver-scope tag id 陣列；driver 可自編，無需 admin 審核）
  - `vehicleProfile: { photos, tags, status, ... }`（vehicle-scope 屬性集合，**改動需 admin 審核**）
  - `vehicleProfilePending: VehicleProfile | null`（driver 編輯中但未送審 / 退回後重編的快照）
  - `verifiedAt: Timestamp | null`、`verifiedBy: string | null`（最近一次 admin approve 時間）
- 司機端 `/driver/profile` 加「車輛資料」section：
  - 多 group 標籤 picker（依 multiplicity single/multi，scope=driver 立刻生效；scope=vehicle 寫入 pending）
  - 照片上傳（最多 8 張，每張 ≤ 5MB；Storage 路徑 `drivers/{lineUid}/vehicle-profile/{ts}.{ext}`）
  - 「送審」按鈕（把 vehicleProfilePending 提交給 admin）
- Admin 端 `/admin/drivers` 列表加 pending 待審徽章；點進 `/admin/drivers/[uid]` 詳情頁加「車輛 profile 審核」section：
  - 顯示 current 與 pending diff
  - approve（pending → 取代 current，寫 verifiedAt）/ reject（pending 留著加 reason，回 driver 端可繼續編輯）
- 三語系 i18n（driver 端文字維持繁中規格 [#14]，但**標籤名稱本身**透過 `localizedTagName` helper 依乘客 lang 顯示）

### 議題拍板（10 個）

| # | 議題 | 拍板 |
|---|---|---|
| 1 | driver-scope tag 需審核嗎？ | **不需要**（語言能力 / 性別 等司機自評；admin 抽查機制 1B 不做） |
| 2 | vehicle-scope tag 需審核嗎？ | **需要**（與照片綁送審；單獨改 tag 也走 pending） |
| 3 | photos 上傳格式 | jpg / png / webp，≤ 5MB / 張，最多 8 張 |
| 4 | photos 取代策略 | 一次 set 整組（不做局部增刪）；driver 端 UI 自行管理增刪後一起送審 |
| 5 | 多車司機 | **不支援**（一車制；vehicleProfile 單一物件） |
| 6 | pending 沒送審就刪掉 | driver 可在 pending UI 點「捨棄變更」清空 vehicleProfilePending |
| 7 | reject 後資料保留 | 保留 vehicleProfilePending（status='rejected', rejectReason）讓 driver 可基於上次內容重編 |
| 8 | verified 徽章顯示位置 | Phase 1C 公開檔案頁才顯示；本 phase 只寫資料 |
| 9 | 既有司機 doc 沒這些欄位 | server 端讀取一律 `?? []` / `?? null` fallback；不寫 migration |
| 10 | driver tag 改動寫 audit 嗎？ | 寫（共用既有 `audit_logs` collection，新增 action `driver.tags_update` / `driver.vehicle_profile_submit` / `driver.vehicle_profile_review` 三種） |

## Impact

### Affected code (Phase 1B only)

| 檔案 | 動作 |
|---|---|
| `shared/vehicleProfile.ts` | 🆕 VehicleProfile 型別 + validation（驗證 tag id 屬於正確 scope/group + 群組互斥規則） |
| `shared/vehicleProfile.spec.ts` | 🆕 Vitest 單元測試 |
| `server/utils/vehicle-profile.ts` | 🆕 取 active tags 索引 + validation helper（呼叫 shared validation + 對 tags collection 查 scope/group） |
| `server/routes/nuxt-api/drivers/me/tags.patch.ts` | 🆕 driver 自編 driver-scope tags |
| `server/routes/nuxt-api/drivers/me/vehicle-profile.patch.ts` | 🆕 driver 編 vehicleProfilePending |
| `server/routes/nuxt-api/drivers/me/vehicle-profile.post.ts` | 🆕 driver 送審（pending status: draft → pending_review） |
| `server/routes/nuxt-api/drivers/me/vehicle-profile.delete.ts` | 🆕 driver 捨棄 pending |
| `server/routes/nuxt-api/drivers/me/vehicle-photo-upload.post.ts` | 🆕 上傳單張車輛照片（複用 driver/upload 邏輯，但路徑改 `vehicle-profile/`；回 signed URL） |
| `server/routes/nuxt-api/admin/drivers/[uid]/vehicle-profile-review.post.ts` | 🆕 admin approve / reject pending |
| `app/protocol/fetch-api/api/driver/index.ts` | 改：加 `PatchDriverTags` / `PatchVehicleProfile` / `SubmitVehicleProfile` / `DiscardVehicleProfile` / `UploadVehiclePhoto` |
| `app/protocol/fetch-api/api/admin/index.ts` | 改：加 `PostVehicleProfileReview` + DriverApplication 型別擴充 |
| `app/pages/driver/profile/index.vue` | 改：加「車輛資料」section（tag picker + photo grid + 送審 / 捨棄按鈕） |
| `app/components/driver/VehicleProfileEditor.vue` | 🆕 包多 group tag picker + photo uploader 的 sub-component |
| `app/components/driver/TagGroupPicker.vue` | 🆕 共用元件：依 group multiplicity 渲染單選 / 多選 chip |
| `app/pages/admin/drivers/[uid].vue` | 改：加「車輛 profile 審核」section（current / pending diff + approve/reject 按鈕 + reason input） |
| `app/components/admin/VehicleProfileReview.vue` | 🆕 內嵌 admin drivers 詳情頁的審核子元件 |
| `server/utils/audit-log.ts` | 改：`AuditAction` union 加 3 個 case；無新 collection |
| `firestore.rules` | 不動（drivers collection 既有 rules 已 cover；vehicle photos 走 Storage rules，本 phase 沿用 driver-docs 既有規則） |
| `i18n/locales/{zh,en,ja}.js` | 改：加 `driver.vehicleProfile.*` + `admin.driverReview.*`；en/ja 暫沿用繁中 |

### 不影響

- 既有 driver application（駕照 / 行照 / 保險卡 / 良民證）審核流程
- Booking / pricing / 配對
- Phase 1A `tags` / `tag_audit_logs` collections（只讀，不寫）

## 整體計畫進度

| Phase | 狀態 |
|---|---|
| 1A | ✅ 完成（commit 1affc41，未 push） |
| **1B** ◀ 本次 | 📐 規格中 |
| 1C | 待開 |
| 1D-1G | 待開 |

部署策略不變：**每 phase commit 不 push**，最後 1G 統一 push prod + deploy rules。

## 驗收標準（Phase 1B）

### Driver 端
- [ ] 進 `/driver/profile` 看到「車輛資料」section
- [ ] 6 個標籤 group（power 單選 / vehicleType 單選 / origin 單選 / interior 多選 / equipment 多選 / driverSkill 多選）正常渲染
- [ ] driverSkill group 改選後立即生效（無 pending）
- [ ] 其他 5 個 group + photos 改後進 vehicleProfilePending（status='draft'）
- [ ] 「送審」按鈕：pending status='draft' → 'pending_review'，draft 不可再編
- [ ] 「捨棄變更」按鈕：清空 vehicleProfilePending

### Admin 端
- [ ] `/admin/drivers` 列表：有 pending_review vehicleProfile 的司機顯示徽章
- [ ] `/admin/drivers/[uid]` 看到「車輛 profile 審核」section
- [ ] 顯示 current 與 pending diff（標籤名稱 + 照片縮圖）
- [ ] approve：current ← pending；pending 清空；driver doc 寫 verifiedAt / verifiedBy
- [ ] reject：pending status='rejected' + rejectReason；driver 端可看到原因 + 重新編輯

### 共通
- [ ] Audit log：3 個新 action 都有寫進 audit_logs
- [ ] 標籤驗證：嘗試提交不屬於正確 scope/group 的 tag id → server 400
- [ ] 標籤互斥驗證：power group 提交 2 個 tag id → server 400
- [ ] `pnpm lint` 全綠
- [ ] `pnpm test` 全綠（含 vehicleProfile.spec）
- [ ] `pnpm build` 全綠
- [ ] 一支 commit：`feat: Phase 1B — driver/vehicle profile + 標籤掛載 + admin 審核`
- [ ] **不 push** / **不 deploy rules**
