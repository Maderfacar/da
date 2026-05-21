# Phase 1C 任務拆解

> 依 `design.md` 實作。本 phase 完成後 `commit`（不 push），等 Brain AI 點「進 1D」。

## 0. 探勘（10 min）
- [ ] 讀 1B HANDOFF.md（`openspec/changes/2026-05-21-driver-vehicle-profile/HANDOFF.md`）確認 `vehicleProfile` / `vehicleProfilePending` / `verifiedAt` schema
- [ ] Grep `drivers/{` in `server/routes/nuxt-api/admin/users/index.get.ts` 確認 server 端讀 driver doc + photo signed URL 的 pattern
- [ ] Grep `getSignedUrl` 確認既有 photo URL 重簽 helper
- [ ] Grep `ElImage` + `preview-src-list` 確認既有 gallery 用法
- [ ] 讀 `app/layouts/front-desk.vue`（或 layouts 對應檔）確認是否強制 auth；若有則本頁需 `middleware: []` 覆寫
- [ ] 讀既有乘客端頁面（如 `app/pages/booking/index.vue` 或 `app/pages/orders/[id].vue`）取 cream theme 設計 reference

## 1. server 層（30 min）
- [ ] `server/routes/nuxt-api/vehicles/[driverId].get.ts` 🆕
  - 無 auth 守則
  - 讀 `drivers/{driverId}`
  - 處理 404（doc 不存在 / vehicleProfile null / verifiedAt null）
  - 解析 lang query param
  - 批次讀 active tags（只取 status==='active'）
  - localized name fallback 繁中
  - 排序：group.sortOrder → tag.sortOrder
  - signed URL 重簽 photos（TTL 4h）
  - 遮罩 driverDisplayName
  - 嚴守隱私（不 echo phone/email/verifiedBy/pending）

## 2. protocol（15 min）
- [ ] `app/protocol/fetch-api/api/vehicle/type.d.ts` 🆕
  - `VehiclePublicTagDto`、`VehiclePublicDto`、`GetVehiclePublicRes`
- [ ] `app/protocol/fetch-api/api/vehicle/index.ts` 🆕
  - `GetVehiclePublic(driverId, lang?)`

## 3. UI（90 min）
- [ ] `app/pages/vehicles/[driverId].vue` 🆕（layout='front-desk'，必要時 `middleware: []` 覆寫 auth）
- [ ] `app/components/vehicle/VehiclePublicProfile.vue` 🆕（主元件）
- [ ] `app/components/vehicle/VehiclePhotoGallery.vue` 🆕
- [ ] `app/components/vehicle/VehicleTagChipGroup.vue` 🆕
- [ ] 各元件 cream theme + 響應式（mobile 2 cols / tablet 3 cols / desktop 4 cols）

## 4. i18n（15 min）
- [ ] `i18n/locales/zh.js` 加 `vehicle.public.*`
- [ ] `i18n/locales/en.js` 加 `vehicle.public.*`（真翻譯）
- [ ] `i18n/locales/ja.js` 加 `vehicle.public.*`（真翻譯）

## 5. 驗證（10 min）
- [ ] `pnpm lint` 全綠
- [ ] `pnpm test` 全綠
- [ ] `pnpm build` 全綠

## 6. 真機 smoke（10 min）
- [ ] `pnpm dev`
- [ ] 進 `/vehicles/{有 verified 的 driverId}` 看完整頁
- [ ] 進 `/vehicles/{無 verified}` → 404
- [ ] 進 `/vehicles/{不存在}` → 404
- [ ] 切 lang zh/en/ja → 標籤名切換
- [ ] 點 photo 開大圖
- [ ] mobile devtool 響應式檢查
- [ ] 未登入訪客（隱身視窗）直接開頁

## 7. commit + HANDOFF
- [ ] git add 上述檔案
- [ ] `git commit -m "feat: Phase 1C — 車輛公開檔案頁"`
- [ ] **不 push**
- [ ] 寫 `openspec/changes/2026-05-21-vehicle-public-profile/HANDOFF.md`（格式參考 1B HANDOFF）
- [ ] 回報「Phase 1C 完工，等 Brain AI 點『進 1D』」
