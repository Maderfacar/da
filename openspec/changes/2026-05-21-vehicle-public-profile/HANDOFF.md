# Hand-off：Phase 1C 車輛公開檔案頁

## 狀態

- **實作 100% 完成**：lint / test / build 三項全綠
- 一支 commit（不 push）；firestore rules 本 phase **不動**（公開資料走 server endpoint，不需新 rule）
- 等 Brain AI 真機驗收 → 點「進 1D」

## 實作摘要

### server 層（1 endpoint，無 auth）
- [server/routes/nuxt-api/vehicles/[driverId].get.ts](../../../server/routes/nuxt-api/vehicles/%5BdriverId%5D.get.ts) — 公開可讀；隱私守則嚴；photos 重簽 4h；tag 名稱依 lang query localized

### protocol 層（fetch-api）
- [app/protocol/fetch-api/api/vehicle/type.d.ts](../../../app/protocol/fetch-api/api/vehicle/type.d.ts) — `VehiclePublicDto` / `VehiclePublicTagDto` / `GetVehiclePublicLang`
- [app/protocol/fetch-api/api/vehicle/index.ts](../../../app/protocol/fetch-api/api/vehicle/index.ts) — `GetVehiclePublic(driverId, lang?)`
- [app/protocol/fetch-api/index.ts](../../../app/protocol/fetch-api/index.ts) — 註冊 `...vehicle`

### UI（page + 3 元件）
- [app/pages/vehicles/[driverId].vue](../../../app/pages/vehicles/%5BdriverId%5D.vue) — front-desk layout，**不掛 auth/role middleware**；`ssr: false` 避免 SSR hydration issue
- [app/components/vehicle/VehiclePublicProfile.vue](../../../app/components/vehicle/VehiclePublicProfile.vue) — 主元件，hero（含 verified 徽章）+ gallery + tag groups + disabled CTA；loading / 404 全處理；watch `[driverId, lang]` 切換時重抓
- [app/components/vehicle/VehiclePhotoGallery.vue](../../../app/components/vehicle/VehiclePhotoGallery.vue) — ElImage + `preview-src-list` 全螢幕大圖；響應式 2/3/4 cols
- [app/components/vehicle/VehicleTagChipGroup.vue](../../../app/components/vehicle/VehicleTagChipGroup.vue) — 依 group 分區 chip 純展示

### i18n（zh / en / ja 完整三語，**真翻譯**）
- [i18n/locales/zh.js](../../../i18n/locales/zh.js) / [en.js](../../../i18n/locales/en.js) / [ja.js](../../../i18n/locales/ja.js) — 加 `vehicle.public.*`（12 keys：title / verified / verifiedAt / completedOrders / driverSkills / vehicleFeatures / photoCount / bookCta / bookCtaHint / notFound / notFoundDesc / backHome）

## 規格細節決策

| 議題 | 拍板 | 出處 |
|---|---|---|
| 路由 | `/vehicles/[driverId]`（不用 /drivers/...） | proposal 議題 #1 |
| 公開可讀 | 不掛 middleware（passenger / guest 都可看） | 議題 #2 |
| 未驗證 / 不存在 → 404 | 用 `notFoundError`（三語訊息） | 議題 #3 |
| 司機名遮罩 | displayName 缺則 fallback `司機 / Driver / ドライバー {uid 後 4 碼}` | 議題 #4 |
| 顯示完成訂單數 | `data.completedOrders ?? 0`（沒寫就顯示 0；既有 driver doc 欄位） | 議題 #5 |
| Photo 開大圖 | ElImage + `preview-src-list` + `preview-teleported` | 議題 #7 |
| Tag 排序 | `TAG_GROUPS[group].sortOrder` 升 → `tag.sortOrder` 升 | 議題 #10 |
| CTA 按鈕 | disabled + hint 文案「即將開放（Phase 1D）」 | 議題 #11 |
| Verified 徽章 | sage 綠（rgba(80, 160, 90, ...)），對齊 cream theme | 議題 #13 |
| rejected pending 揭露 | 只看 verified `vehicleProfile`，pending 完全不 echo | 議題 #15 |
| server 端 cache | 不做（留 1G） | 議題 #16 |
| 響應式 | gallery 2/3/4 cols；CTA 卡片置中；hero font-size 對齊既有 PageOrderDetail | 議題 #17 |
| **vehicle 既有 i18n key 重用** | `vehicle.*` top-level 已存在（車種 sedan/suv/...），加 `public:` sub-key 不衝突 | 探勘發現 |
| **page 不開 SSR** | `ssr: false`：本頁靠 ClientOnly + `$api`，避開 vue-i18n SSR 缺 keys 問題 | 對齊 driver / admin pattern |
| **TagGroupPicker（1B）vs VehicleTagChipGroup（1C）** | 不共用：picker 可互動（單/多選）、chipGroup 純展示；分開易讀 | YAGNI |

## 驗證結果

```
pnpm lint   ✅ 0 error
pnpm test   ✅ 9 test files / 163 tests passed（無新增 case；本 phase 無單元測試，spec §4）
pnpm build  ✅ exit 0；新 endpoint chunk emit；page route 已 emit
```

## 真機驗收 checklist（Brain AI）

啟動 `pnpm dev`：

### 公開頁正流程

- [ ] **V1** 進 `/vehicles/{有 verified vehicleProfile 的 driverId}` → 看到完整頁面：
  - Hero：VEHICLE PROFILE 小標籤 + 司機名 + sage 綠 ✓ verified 徽章
  - meta：「已完成 N 趟 · 認證於 YYYY/MM/DD」
  - Photo gallery（最多 8 張，2/3/4 cols 響應式）
  - 車輛特色 section（依 group 分區 chip）
  - 司機能力 section（driverSkill chips）
  - CTA「預約此車」disabled + 「即將開放」hint
- [ ] **V2** 點 photo → 全螢幕大圖（preview-src-list）；左右切換；ESC 關閉
- [ ] **V3** mobile devtool（375px / 768px / 1024px）切換 → gallery cols 2/3/4 變化；hero font-size 適配

### 404 / 隔離

- [ ] **V4** 進 `/vehicles/{不存在的 driverId}` → 404 頁（🚗 + 「找不到車輛資訊」+ 回首頁鈕）
- [ ] **V5** 進 `/vehicles/{有 driver 但 vehicleProfile == null}` → 同 V4 404（不揭露 driver 存在）
- [ ] **V6** 進 `/vehicles/{driver 有 vehicleProfilePending 但 verifiedAt == null}` → 同 V4 404
- [ ] **V7** 進 `/vehicles/line:U...` 帶 prefix → server 端去 prefix 後正常找到（與既有 driver/orders endpoint 一致）

### 多語

- [ ] **V8** 切 vue-i18n locale 為 `en` → 標籤名顯示英文（如 `EV` / `Sedan`），司機名 fallback `Driver xxxx`
- [ ] **V9** 切 `ja` → 日文（`ハイブリッド` / `セダン`），司機名 fallback `ドライバー xxxx`
- [ ] **V10** 缺翻譯 tag（如 admin 後加無 en 翻譯的 tag）→ fallback 繁中

### 未登入 / 隱私

- [ ] **V11** 隱身視窗未登入直接開 `/vehicles/{verified driverId}` → 正常顯示（不會被 auth middleware 攔）
- [ ] **V12** 開 devtool Network 看 response → **沒有** `phone` / `email` / `vehicleProfilePending` / `verifiedBy` / 完整 uid 等欄位

### 邊界

- [ ] **V13** vehicleProfile.photos 為空 → 顯示「暫無照片」placeholder（不會空白）
- [ ] **V14** vehicleProfile.tags 為空 → 「車輛特色」section 不渲染
- [ ] **V15** driverSkillTags 為空 → 「司機能力」section 不渲染

> firestore rules 沒 deploy；本 phase 走 server endpoint（admin SDK），不依賴 client rules。

## 留尾（不在本 phase 範圍）

- ⏳ booking 結果區塊連結進公開頁（「查看車輛詳情」） → Phase 1D
- ⏳ SEO / OG meta + 分享連結預覽圖 → Phase 2
- ⏳ 評分系統 → Phase 2+
- ⏳ server 端 response 快取（key by `verifiedAt`） → Phase 1G 評估
- ⏳ E2E 測試 → Phase 1G

## 已知陷阱與設計權衡

1. **page `ssr: false`**：規格沒明說，但對齊 driver/profile / admin 子頁慣例；避開 vue-i18n SSR 注水 keys 不同步問題。如果未來要做 OG meta（SEO，留 Phase 2），需改為 SSR + 處理 hydration。
2. **`ClientOnly` wrap VehiclePublicProfile**：保險加 ClientOnly 與 `ssr: false` 二選一即可；目前都加是雙保險，無害。
3. **resignGcsUrl 對非 GCS URL fallback**：既有 helper 已處理；本頁若 driver 上傳的舊照片 URL host 不是 storage.googleapis.com（例如手填 placeholder），會直接顯示原 URL。
4. **completedOrders 來源**：直接讀 `drivers/{uid}.completedOrders`。**Phase 1B 未保證該欄位寫入**；若沒寫顯示 0。1D booking 完成後寫入由配對 / 結單 flow 負責（已存在於本專案其他 phase）。
5. **localizedTagName fallback**：tag.name 缺 en/ja 時 fallback 繁中（既有 helper 已實作），不會空字串。
6. **vehicle.public.* key 命名**：因 `vehicle.*` top-level 已被「車種」佔用，加 sub-namespace `public.*` 避免衝突。
7. **VehicleTagChipGroup 與 1B DriverTagGroupPicker 不共用**：picker 有 single/multi 互動邏輯與 disabled state；chipGroup 純展示且依 group 分區自帶 header。分開易讀。
8. **photo grid 用 ElImage 而非自寫 `<img>`**：取 lazy load + zoom + preview 一體；style 對齊 cream theme。

## Commit

```
feat: Phase 1C — 車輛公開檔案頁
```

新增 / 改動檔案清單：

**新增**
- server/routes/nuxt-api/vehicles/[driverId].get.ts 🆕
- app/protocol/fetch-api/api/vehicle/type.d.ts 🆕
- app/protocol/fetch-api/api/vehicle/index.ts 🆕
- app/pages/vehicles/[driverId].vue 🆕
- app/components/vehicle/VehiclePublicProfile.vue 🆕
- app/components/vehicle/VehiclePhotoGallery.vue 🆕
- app/components/vehicle/VehicleTagChipGroup.vue 🆕
- openspec/changes/2026-05-21-vehicle-public-profile/HANDOFF.md 🆕

**改動**
- app/protocol/fetch-api/index.ts ✏️（註冊 `...vehicle`）
- i18n/locales/zh.js ✏️
- i18n/locales/en.js ✏️
- i18n/locales/ja.js ✏️
