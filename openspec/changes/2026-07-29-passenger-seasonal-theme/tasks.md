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

## W2：Admin 換季 UI + Hero 主視覺（L2，下一視窗）

- [ ] **W2.1** admin endpoints（`server/routes/nuxt-api/admin/config/themes/`）
  - [ ] `index.get.ts` — list 全部主題（super gate）
  - [ ] `active.put.ts` — 切換 activeThemeId（super gate + guard「不可設為 disabled 主題」）+ audit log `site_theme.switch`
  - [ ] `[id]/enabled.patch.ts` — 啟用/停用
- [ ] **W2.2** `app/protocol/fetch-api/api/` — 加 admin theme 三支 method
- [ ] **W2.3** Hero 主圖：Claude 做 3–4 套 `public/themes/{id}/hero.webp`（WebP，壓縮，標明尺寸），seed 的 `hero.bgImage` 指向
- [ ] **W2.4** `app/pages/index.vue`（改）— hero-bg / stripe / tag 綁 `var(--da-hero-*)`，缺省 fallback 現值（default 主題維持純色 hero）
- [ ] **W2.5** `/admin/settings`（改）— 加「季節主題」section：主題卡（name 三語 + swatch + hero 縮圖 + enabled toggle）+ radio 切生效 + 「套用」
- [ ] **W2.6** i18n 三語 key（admin settings 主題區文案 + 各主題 name 若走 i18n）
- [ ] **W2.7** 測試：切換 active 更新 pointer / 停用主題不能設 active(400) / hero fallback 正確
- [ ] **W2.8** 終局檢查 `pnpm lint:fix && pnpm build && pnpm test` 全綠 + rules 若動再 deploy
- [ ] **W2.9** git commit + push origin main
- [ ] **W2.10** 驗證 prod：admin 切換聖誕 → 乘客首頁換色 + 換 Hero 主圖；admin/driver 端不變；切回 default 復原
- [ ] **W2.11** 交付 Brain AI 逐套視覺驗收清單（3–4 套 × 首頁/booking/orders/fleet 抽查）

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
