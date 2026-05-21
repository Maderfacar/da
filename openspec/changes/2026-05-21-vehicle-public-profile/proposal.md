# Phase 1C — 車輛公開檔案頁（2026-05-21）

> 整體計畫第 3 phase。前置：1A taxonomy（commit `eeaa6d3`+ `3fd6905`）/ 1B driver+vehicle profile（commit `5c51507`+ `e776853`）已完成。
> 本 phase 為**純讀寫分離 + 乘客端體驗**，不動司機端、不動 booking、不動配對。

## Why

1B 完成 driver 自編 vehicleProfile + admin 審核，`drivers/{lineUid}` doc 上已有 verified `vehicleProfile{photos,tags,updatedAt}` + `verifiedAt` + `verifiedBy`。**但乘客看不到。** 沒有公開檔案頁，標籤資訊只停在後台 — 乘客 booking 時無法建立「這台車真的有航空椅」的信任。

## What Changes

### 機制總覽

- 公開頁路由 `/vehicles/[driverId]`（passenger / guest 可讀，唯讀）
- 顯示：
  - 車輛照片 gallery（最多 8 張，可開大圖）
  - 車輛標籤群組（依 group 分區，chip 形式顯示 localized 名稱）
  - 司機 driver-scope 標籤（如英文 / 商務接待）
  - 司機名稱（**只顯示 displayName，遮罩 uid / phone / email**）
  - Verified 徽章 + 認證時間
  - 累積完成訂單數（drivers doc `completedOrders` 既存欄位）
- 不顯示：
  - 真實聯絡方式
  - `vehicleProfilePending`（pending 狀態）
  - audit fields / 內部狀態
- 隔離：無 verified vehicleProfile 的 driver → 404（不揭露 driver 存在）

## 17 個決策

| # | 議題 | 拍版 |
|---|---|---|
| 1 | 路由結構 | `/vehicles/[driverId]`（不用 `/drivers/...` 避免暗示直接聯絡司機） |
| 2 | 公開頁需登入嗎 | **不需登入**（passenger guest 可看；分享連結友善） |
| 3 | 未驗證車輛 | **404**，不揭露 driver 存在 |
| 4 | 司機名 | 顯示 displayName；無 displayName → 「司機 + uid 後 4 碼」 |
| 5 | 顯示完成訂單數 | 顯示（信任強化） |
| 6 | 顯示評分 | 不顯示（評分系統未做） |
| 7 | Photo 開大圖 | Element Plus ElImage preview group |
| 8 | Tag chip 顯示 | 依乘客 locale 選 zh_tw/en/ja name（缺則 fallback 繁中） |
| 9 | i18n | **乘客端三語完整翻譯** |
| 10 | 標籤排序 | 沿用 `group.sortOrder` → `tag.sortOrder` |
| 11 | 連結入口 | 本 phase 只做頁面；CTA 按鈕 disabled，留 1D booking 流程接 |
| 12 | SEO / OG meta | 不做（留 Phase 2 評估） |
| 13 | Verified 徽章樣式 | 對齊 Editorial Horizon cream theme |
| 14 | 沒 vehicleProfile 的 driver | 404 |
| 15 | rejected pending 揭露 | 不揭露任何 pending（只看 verified `vehicleProfile`） |
| 16 | server 端快取 | 不做（後付可掛 `verifiedAt` 為 cache key，留 1G 評估） |
| 17 | 響應式 | mobile / desktop 都要 |

## Impact

### Affected code (Phase 1C only)

| 檔案 | 動作 |
|---|---|
| `server/routes/nuxt-api/vehicles/[driverId].get.ts` | 🆕 公開 endpoint |
| `app/protocol/fetch-api/api/vehicle/index.ts` | 🆕 |
| `app/protocol/fetch-api/api/vehicle/type.d.ts` | 🆕 |
| `app/pages/vehicles/[driverId].vue` | 🆕 公開頁 |
| `app/components/vehicle/VehiclePublicProfile.vue` | 🆕 主元件 |
| `app/components/vehicle/VehiclePhotoGallery.vue` | 🆕 photo gallery |
| `app/components/vehicle/VehicleTagChipGroup.vue` | 🆕 chip 群組展示 |
| `i18n/locales/{zh,en,ja}.js` | 加 `vehicle.public.*` keys（三語完整翻譯） |

### 不影響

- driver / admin 既有頁面
- booking / 配對 / pricing
- 1A/1B 既有 schema 與 endpoint
- `firestore.rules`（本 phase 不動，drivers read 是 admin/owner only，公開讀走 server endpoint）

## 驗收標準

- [ ] 進 `/vehicles/{有 verified vehicleProfile 的 driverId}` 看到完整公開頁
- [ ] 進 `/vehicles/{沒 verified}` 或 `/vehicles/{不存在 driver}` → 404 頁面
- [ ] 切 locale zh/en/ja → 標籤名跟著切（缺翻譯 fallback 繁中）
- [ ] 點 photo 開大圖（ElImage preview group）
- [ ] mobile 響應式正常（375px / 768px / 1024px）
- [ ] 未登入訪客可直接開公開頁
- [ ] driverDisplayName 遮罩正確（無 displayName fallback 為「司機 ${uid 後 4 碼}」）
- [ ] CTA「預約此車」顯示但 disabled，hover 顯示「即將開放」
- [ ] `pnpm lint` / `pnpm test` / `pnpm build` 全綠
