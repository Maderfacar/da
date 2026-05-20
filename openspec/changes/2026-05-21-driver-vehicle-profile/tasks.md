# Phase 1B 任務拆解

> 依 `design.md` 實作。本 phase 完成後 `commit`（不 push），等 Brain AI 點「進 1C」。
> 期間：批次工具呼叫、不額外問 yes/no、遇不明處才中斷。

## 0. 準備 / 探勘（10 min）

- [ ] 讀本目錄 `proposal.md` + `design.md`
- [ ] 讀已完成的 `openspec/changes/2026-05-21-vehicle-tag-taxonomy/HANDOFF.md`（1A 落定狀態）
- [ ] Grep `server/routes/nuxt-api/admin/drivers/[uid]/document-review.post.ts`（學審核 endpoint 結構）
- [ ] Grep `server/routes/nuxt-api/drivers/me/document-replace.post.ts`（學 driver self + LINE push）
- [ ] Grep `server/routes/nuxt-api/driver/upload.post.ts`（學 multipart + Storage signed URL）
- [ ] Read `app/pages/driver/profile/index.vue` 確認 section 插入點
- [ ] Read `app/pages/admin/drivers/[uid].vue` 確認 section 插入點
- [ ] Grep `methods.postMultipart\|methods.delete` 確認 fetch-api 是否支援；若無看 announcement / discount-code 多媒體上傳作法

## 1. shared 層（30 min）

- [ ] `shared/vehicleProfile.ts` 🆕
  - export `VehicleProfileStatus` type
  - export `VehicleProfileInput` interface
  - export `VehicleProfileValidationError` type
  - export `validateVehicleProfileShape(input, options?)` function
- [ ] `shared/vehicleProfile.spec.ts` 🆕（Vitest）
  - 至少 8 cases（見 design §2.2）
  - 跑 `pnpm test` 全綠

## 2. server 層（90 min）

- [ ] `server/utils/vehicle-profile.ts` 🆕
  - `buildTagIndex(db)` → `Map<id, { group, scope, nameZh }>`
  - `validateDriverTags(tags, index)` → string | null
- [ ] `server/utils/audit-log.ts` 改：`AuditAction` union 加 3 case
- [ ] `server/routes/nuxt-api/drivers/me/tags.patch.ts` 🆕
- [ ] `server/routes/nuxt-api/drivers/me/vehicle-profile.patch.ts` 🆕
- [ ] `server/routes/nuxt-api/drivers/me/vehicle-profile.post.ts` 🆕（送審）
- [ ] `server/routes/nuxt-api/drivers/me/vehicle-profile.delete.ts` 🆕（捨棄/撤回）
- [ ] `server/routes/nuxt-api/drivers/me/vehicle-photo-upload.post.ts` 🆕
- [ ] `server/routes/nuxt-api/admin/drivers/[uid]/vehicle-profile-review.post.ts` 🆕
- [ ] 確認 admin/users 列表 endpoint 有 echo `vehicleProfilePending`（若無補上）

## 3. protocol（fetch-api 介面）（20 min）

- [ ] `app/protocol/fetch-api/api/driver/index.ts` 改：加 5 個 driver method
- [ ] `app/protocol/fetch-api/api/admin/index.ts` 改：
  - 加 `PostVehicleProfileReview`
  - `DriverApplication` / `AdminUser` 型別擴充 `vehicleProfile` / `vehicleProfilePending` / `verifiedAt` / `verifiedBy`
  - export `VehicleProfileDto` + `VehicleProfilePendingDto`

## 4. driver UI（90 min）

- [ ] `app/components/driver/TagGroupPicker.vue` 🆕（共用 chip picker）
- [ ] `app/components/driver/VehicleProfileEditor.vue` 🆕（5 group + photo + 送審 / 捨棄）
- [ ] `app/pages/driver/profile/index.vue` 改：
  - 載入 active tags（GetActiveTags）
  - 加「司機能力標籤」section（driverSkill TagGroupPicker；change 立即 PatchDriverTags）
  - 加「車輛資料」section（嵌入 VehicleProfileEditor）

## 5. admin UI（60 min）

- [ ] `app/components/admin/VehicleProfileReview.vue` 🆕（diff + approve/reject）
- [ ] `app/pages/admin/drivers/[uid].vue` 改：
  - 載入 active tags 組 tagIndex
  - 加「車輛 Profile 審核」section（嵌入 VehicleProfileReview）
- [ ] `app/pages/admin/drivers/index.vue` 改：列表加 ⚠ 待審徽章（依 vehicleProfilePending.status）

## 6. i18n（10 min）

- [ ] `zh.js` 加 `driver.vehicleProfile.*` + `driver.driverSkill.*` + `admin.driverReview.*`
- [ ] `en.js` 加同 keys（值暫沿用繁中）
- [ ] `ja.js` 加同 keys（值暫沿用繁中）

## 7. 驗證 + commit（15 min）

- [ ] `pnpm lint` 全綠（必要時 `pnpm lint:fix`）
- [ ] `pnpm test` 全綠
- [ ] `pnpm build` 全綠
- [ ] `git status` 確認檔案清單
- [ ] `git add` 相關檔案（**不要** `git add -A`，避開 `.env.dev` / `.claude/settings.local.json`）
- [ ] `git commit -m "feat: Phase 1B — driver/vehicle profile + 標籤掛載 + admin 審核"`
- [ ] **不 push**
- [ ] 寫 `HANDOFF.md`（依 1A HANDOFF 樣板：實作摘要 + 留尾 + 真機驗收 checklist）

## 8. 真機 smoke（10 min，可選但建議）

依 `proposal.md` §「驗收標準」走一輪 driver + admin 流程。

## 完工確認

- [ ] 三項 lint / test / build 全綠
- [ ] commit 一支（不 push）
- [ ] HANDOFF.md 寫好
- [ ] 在對話結尾回報「Phase 1B 完工，等 Brain AI 點『進 1C』」並列出留尾項
