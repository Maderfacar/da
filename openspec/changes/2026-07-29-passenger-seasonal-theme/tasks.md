# Passenger Seasonal Theme — Tasks

> 逐視窗切分。W1=引擎地基（L1），W2=Admin 換季 UI + Hero 主視覺（L2）。
> L3 裝飾層 / 排程 / 自由色票編輯 = 不在本變更（見 proposal「不在本變更」）。

## W1：主題引擎地基（L1，本視窗）

- [ ] **W1.1** 建立 OpenSpec change 四份 artifact（proposal / design / tasks / spec）✅ 本次
- [ ] **W1.2** `shared/site-theme.ts`（新）
  - [ ] `DA_THEME_TOKEN_KEYS` 白名單 + `DaTokenKey` type
  - [ ] `I18nLabel` / `SiteThemeHero` / `SiteTheme` / `ResolvedTheme` interface
  - [ ] `isHexColor()` validator
  - [ ] `buildThemeCss(resolved)` → 產出 `[data-da-theme]{--da-*;--da-hero-*}` 字串
  - [ ] `DEFAULT_SITE_THEMES`：`default`（現行 DA 調色盤，抽自 `_theme-colors.css`）+ 3 套節日包色票（Claude 定；hero.bgImage 先留空，W2 補圖）
- [ ] **W1.3** `server/utils/site-theme-config.ts`（新）
  - [ ] `seedSiteThemesIfEmpty(db)`（`site_themes` 空 → 寫 defaults；`site_config/theme` 缺 → `{ activeThemeId: 'default' }`）
  - [ ] `resolveActiveTheme(db)` → 讀 pointer + theme doc + 合併 default → `ResolvedTheme`（disabled/缺失 fallback default）
- [ ] **W1.4** `server/routes/nuxt-api/config/theme.get.ts`（新）— 公開 GET，短 TTL 快取，`successResponse(resolved)`
- [ ] **W1.5** `app/protocol/fetch-api/api/config/`（改）— 加 `GetSiteTheme()` + 回傳型別
- [ ] **W1.6** `app/stores/2.store-theme.ts`（改）— 移除 dummy（`primaryTest`/color maps/`ChangeTheme`），改 `resolved` + `setResolved`（先確認 `useColorMode` 無他處引用）
- [ ] **W1.7** `app/composables/useSiteThemeInject.ts`（新）— `useAsyncData` 撈 → `setResolved` → `useHead` 注入 scoped `<style id="da-theme-vars">`（SSR + hydration 不重打）
- [ ] **W1.8** `app/layouts/front-desk.vue` + `marketing.vue`（改）— 根容器加 `data-da-theme` + 呼叫 `useSiteThemeInject()`
- [ ] **W1.9** `firestore.rules`（改）— `site_themes` / `site_config` public-read / admin-write + `firebase deploy --only firestore:rules`
- [ ] **W1.10** `shared/site-theme.spec.ts`（新）— hex 邊界 / resolve 合併 / disabled fallback / buildThemeCss selector / DEFAULT_SITE_THEMES 全通過驗證
- [ ] **W1.11** 終局檢查：`pnpm lint:fix && pnpm build && pnpm test` 全綠（build 必跑，注入涉及 head/SSR）
- [ ] **W1.12** git commit + push origin main（直推 prod）
- [ ] **W1.13** 驗證 prod：`curl /nuxt-api/config/theme` 回 200 + default resolved；乘客首頁 view-source 有 `#da-theme-vars` style；admin/driver 端外觀不變
- [ ] **W1.14** 寫 W2 handoff prompt（單塊 code block，無嵌套 fence）給 Brain AI

## W2：Admin 換季 UI + Hero 主視覺（L2）✅ 上 prod 2026-07-30（commit 884043b）

> 決策變更：Brain 拍板 Hero 圖來源＝**後台上傳圖檔**（非 Claude committed SVG/webp）。
> 故 W2.3 由「commit public assets」改為「Storage 上傳端點 + admin 上傳 UI」；同時解掉 seed doc backfill 問題（上傳直接寫既有 doc 的 hero.bgImage）。

- [x] **W2.1** admin endpoints（`server/routes/nuxt-api/admin/config/themes/`）
  - [x] `index.get.ts` — list 全部主題（canManageThemes 預設僅 super）
  - [x] `active.put.ts` — 切換 activeThemeId（guard「不可設為 disabled 主題」400）+ audit `site_theme.switch` + invalidate 快取
  - [x] `[id]/enabled.patch.ts` — 啟用/停用（default 不可停用 400）+ audit `site_theme.enabled`
  - [x] `[id]/hero.patch.ts` — 設定/清除 hero.bgImage（過 isSafeThemeImageUrl）+ audit `site_theme.hero_update`
  - [x] `upload-hero-image.post.ts` — Storage 上傳（makePublic 優先→失敗 fallback 1yr signed URL）
- [x] **W2.2** `app/protocol/fetch-api/api/config/` — 加 GetAdminThemes / PutActiveTheme / PatchThemeEnabled / PatchThemeHero / UploadThemeHeroImage + DTO
- [x] **W2.3**（改）Hero 主圖後台上傳：`upload-hero-image` 端點 + admin 卡片上傳 UI（取代原「Claude 做 public/themes 圖」）
- [x] **W2.4** `app/pages/index.vue` — hero-bg / stripe / runway / tag 綁 `var(--da-hero-*)`，缺省 fallback 現值（default 純色 hero）
- [x] **W2.5** `/admin/settings` — 加「季節主題」tab + `AdminSettingsSeasonalThemes` 子元件（主題卡 + swatch + hero 縮圖上傳 + enabled toggle + 設為生效）
- [x] **W2.6**（依既有 admin 頁慣例走繁中硬編，非 i18n；主題 name 三語來自 Firestore data model）
- [x] **W2.7** 測試：resolveTheme disabled/缺項/非法 hex/bgImage fallback + isSafeThemeImageUrl signed URL 白名單（HTTP handler 測試非本專案慣例，未加）
- [x] **W2.8** 終局檢查 lint / build（×2 exit 0）/ 695 tests 全綠 + firestore rules deployed
- [x] **W2.9** git commit + push origin main（884043b）
- [x] **W2.10** prod 端點驗證：公開 GET 200 + default；4 新 admin 端點 gated 401 envelope（無洩漏）確認部署上線 — 視覺切換驗收留 Brain（需 2FA）
- [ ] **W2.11** 交付 Brain AI 逐套視覺驗收清單（見下方 handoff；需 admin 2FA 登入上傳 + 切換）

## 不在本變更（後續可選 wave）

- **W3（可選）** L3 裝飾層 overlay（飄雪/櫻花/燈籠，reduced-motion 尊重）
- **FU-排程** `site_themes` 加 `schedule` + SSR 每請求解析「今日生效」（自動換季）
- **FU-色票編輯** admin 自由改色 + 對比/可讀性護欄
- **FU-Hero 上傳** 後台上傳 Hero 圖到 Storage（取代 committed public asset）

## 驗收標準（Definition of Done，W1+W2）

- 乘客端可由 admin 手動切換 ≥ 4 套主題，整組配色 + Hero 主圖跟著換
- 首頁 SSR view-source 已含注入 style，實測無 FOUC 閃色
- admin 端、司機端外觀完全不受換季影響（token 隔離驗證）
- `default` 主題 == 現況（換季系統不改變「未套主題」的樣子）
- lint / build / test 全綠；firestore rules 已 deploy
