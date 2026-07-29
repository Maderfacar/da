# Passenger Seasonal Theme — 乘客端季節/節日主題包（後端手動切換）

> Brain AI（架構師）與 Claude（Execution AI）2026-07-29 鎖定。
> 範圍：乘客端（front-desk / marketing layout）視覺主題可依季節/節日整組切換；**只影響乘客端**，司機端與 admin 端外觀完全不變。

## Why

乘客端希望能因應季節或節日（聖誕、農曆春節、夏日…）替換整體配色與首頁主視覺，營造氛圍、提升品牌記憶。現況有兩個阻礙：

- **主題色是半殘佔位**：`StoreTheme`（`app/stores/2.store-theme.ts`）只存兩個 dummy 色（`primaryTest` 綠/紅），`_theme-colors.css` 的 `:root.dark` 值與 `:root` 完全相同 → 實際上沒有可切換的主題，全站就是一套寫死的 `--da-*` token。
- **首頁 Hero 全寫死**：`app/pages/index.vue` 的背景、斜紋色、主視覺都在 scoped SCSS 硬編，無資料驅動，換季只能改 code + 重新部署。

好消息是全站都吃 `:root` 的 `--da-*` custom properties（~67 檔透過 `var(--da-amber)` 引用），**只要 runtime 覆寫這組 token，就能整組 cascade，不需碰那 67 個檔案**。這讓「季節換膚」從全站掃描降為「一個注入點」的工程。

## What Changes

### 核心概念：主題預設包（Theme Preset Pack）

一套主題包 = **一組 `--da-*` 調色盤覆寫 + 一組首頁 Hero 主視覺設定**。換季 = 後端切換「目前生效哪一套」。主題包由 Claude 預先做好（seed），Brain AI 用切換預覽審核。

### 已鎖定的決策（不需再拍板）

| 項目 | 決策 |
|------|------|
| 主題包來源 | Claude 做（seed 3–4 套），Brain 審 |
| 切換方式 | **後端手動切換**（admin 點選生效主題）；**不做日期自動排程** |
| 交付深度 | **L1 配色引擎 + L2 Hero 主視覺**；L3 裝飾層（飄雪/燈籠）暫不做 |
| 影響範圍 | **只乘客端**（front-desk / marketing）；司機/admin 不變 |
| admin 權限 | 首發只能「切換 / 啟用停用」，**不能自由改色值**（色票由 seed 定） |

### 新增 Firestore schema

- 新 collection `site_themes/{themeId}` — 每筆一套主題包：
  - `name: I18nLabel`（三語顯示名，例：聖誕限定）
  - `tokens: Partial<Record<DaTokenKey, string>>`（`--da-*` hex 覆寫，缺項 fallback 預設）
  - `hero: { bgImage?, stripeYellow?, stripeDark?, tagColor? }`（首頁主視覺）
  - `enabled: boolean` / `sortOrder: number` / `isDefault: boolean`
- 新 config doc `site_config/theme` — `{ activeThemeId: string }`（手動切換指標）
- Seed：`default`（現行 DA 調色盤）+ 3 套節日包（Claude 定色）

### 新增 / 修改程式碼（總覽，逐視窗細節見 tasks.md）

| 檔案 | 動作 |
|------|------|
| `shared/site-theme.ts`（新）| `DaTokenKey` 白名單 + `SiteTheme` / `ResolvedTheme` type + hex 驗證 + `DEFAULT_SITE_THEMES` seed |
| `server/utils/site-theme-config.ts`（新）| 撈 `site_themes` + `site_config/theme`、解析生效主題、seed if empty |
| `server/routes/nuxt-api/config/theme.get.ts`（新）| 公開 GET：回傳當前生效主題（含短 TTL 快取） |
| `server/routes/nuxt-api/admin/config/themes/*`（新，W2）| admin list / 切換 active / 啟用停用（super gate） |
| `app/stores/2.store-theme.ts`（改）| 清掉 dummy 佔位碼，改為載入/快取生效主題 |
| `app/composables/useSiteThemeInject.ts`（新）| SSR-safe 注入：把生效 token 以 scoped `<style>` 塞入乘客 layout（FOUC-free） |
| `app/layouts/front-desk.vue` / `marketing.vue`（改）| 掛 `data-da-theme` 容器 + 觸發注入（隔離乘客端） |
| `app/pages/index.vue`（改，W2）| Hero 背景/斜紋色綁定 `hero.*`，缺省 fallback 現值 |
| `app/pages/admin/settings/*`（改，W2）| 加「季節主題」區：列表 + 切換 + 啟用停用 + 預覽 |
| `public/themes/{id}/hero.webp`（新，W2）| Claude 做的每套 Hero 主視覺圖 |
| `firestore.rules`（改）| `site_themes` / `site_config` 公開讀、admin 寫 |

### Token 隔離做法（只換乘客端的關鍵）

現行 `--da-*` 在全域 `:root`，三端共用。改法：在乘客 layout 根容器掛 `data-da-theme` 屬性，注入的覆寫寫成 `[data-da-theme] { --da-amber: …; }`。CSS custom property 會 cascade 給容器內全部子孫元素，**覆蓋 `:root` 預設但不動 admin/driver layout**（它們沒有這個容器）。`_theme-colors.css` 的 `:root` 值保留為 fallback。

### FOUC-free（首頁是 SSR + AEO 命脈）

注入必須在 SSR 階段完成：plugin/composable 於 server 端先撈生效主題 → 寫進 Pinia + payload → 用 `useHead` 塞 scoped `<style>`。client hydration 讀 payload、不重打、不閃色。

## Impact

### Affected specs
- 新建：`passenger-seasonal-theme`

### Affected code
- 新增：`shared/site-theme.ts`、`server/utils/site-theme-config.ts`、`server/routes/nuxt-api/config/theme.get.ts`、`app/composables/useSiteThemeInject.ts`、admin theme endpoints（W2）、`public/themes/*`（W2）
- 修改：`app/stores/2.store-theme.ts`（清 dummy）、`app/layouts/front-desk.vue`、`app/layouts/marketing.vue`、`app/pages/index.vue`（W2）、`app/pages/admin/settings/*`（W2）、`firestore.rules`

### 不影響（明確保證）
- 計價引擎、訂單、司機派單、認證、LINE 通知 —— 完全不碰
- **司機端（driver layout）與 admin 端（back-desk layout）外觀** —— token 隔離，不受換季影響
- 現行 `:root` 的 `--da-*` 預設值保留（`default` 主題即等於現況，換季不改變「沒套主題時」的樣子）
- 頁面版型結構、字體、元件排列 —— L1+L2 只換顏色與 Hero 主圖，不重排版面

## 不在本變更（後續可選）

- **日期自動排程**（聖誕檔期自動生效）—— schema 預留但本次不建邏輯
- **admin 自由色票編輯器**（含對比/可讀性護欄）—— 首發只切換，不改色
- **L3 裝飾層**（飄雪 / 櫻花 / 燈籠 overlay）
- **司機/admin 端換季** —— 刻意鎖只乘客端
- **Hero 主視覺後台上傳**（Storage）—— 首發用 Claude committed public assets，後台換圖列後續

## 待 Brain AI 審核的產出（非阻塞）

- Claude 做的 3–4 套主題包色票與 Hero 主圖 —— 上 prod 後 Brain 用 admin 切換逐套視覺驗收
