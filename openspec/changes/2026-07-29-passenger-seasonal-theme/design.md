# Design — Passenger Seasonal Theme

## 架構總覽

沿用專案既有「後端可配置」樣板（`fleet-config.ts` + `/config/fleet` + Pinia cache + admin CRUD + seed）。

```
Firestore                         Server                          Client (乘客端 only)
─────────                         ──────                          ────────────────────
site_themes/{id}      ──┐
  name / tokens / hero   ├─▶ site-theme-config.ts ──▶ GET /config/theme ──▶ StoreTheme (Pinia)
  enabled / isDefault    │     resolveActiveTheme()      (public, TTL 快取)         │
site_config/theme     ──┘     seedIfEmpty()                                         ▼
  { activeThemeId }                                              useSiteThemeInject (SSR head)
                                                                  <style>[data-da-theme]{--da-*}</style>
                                                                         │
                                                       front-desk / marketing layout 掛 data-da-theme
                                                                         │
                                                      cascade → 全乘客端 var(--da-*) 自動換色
```

## 資料模型

### `shared/site-theme.ts`（新，前後端共享）

```ts
// 可被主題覆寫的 --da-* token 白名單（對齊 _theme-colors.css）
export const DA_THEME_TOKEN_KEYS = [
  'da-cream', 'da-off-white',
  'da-amber', 'da-amber-light', 'da-amber-pale',
  'da-dark', 'da-dark-mid',
  'da-gray', 'da-gray-light', 'da-gray-pale',
  'da-stripe-yellow', 'da-stripe-dark',
  'da-glass-bg', 'da-glass-border',
] as const;
export type DaTokenKey = typeof DA_THEME_TOKEN_KEYS[number];

export interface I18nLabel { zh: string; en: string; ja: string; }

export interface SiteThemeHero {
  bgImage?: string;      // public asset URL 或 http(s)（例：/themes/christmas/hero.webp）
  stripeYellow?: string; // 斜紋亮色（缺省 → tokens['da-stripe-yellow'] → 預設）
  stripeDark?: string;   // 斜紋暗色
  tagColor?: string;     // hero tag 強調色（缺省 → da-amber）
}

export interface SiteTheme {
  id: string;
  name: I18nLabel;
  tokens: Partial<Record<DaTokenKey, string>>; // hex 覆寫，缺項 fallback
  hero: SiteThemeHero;
  enabled: boolean;
  sortOrder: number;
  isDefault: boolean;    // 唯一一筆 true，作為 base + fallback
}

// GET /config/theme 回傳（已解析、已合併）
export interface ResolvedTheme {
  activeThemeId: string;
  name: I18nLabel;
  tokens: Record<DaTokenKey, string>; // 完整（default base 上疊 active）
  hero: Required<Pick<SiteThemeHero, 'stripeYellow' | 'stripeDark' | 'tagColor'>> & { bgImage?: string };
}
```

**Hex 驗證**：`isHexColor(v)` — `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`。glass-bg/border 允許 `rgba(...)` → 另一條 validator（W1 先鎖 hex，rgba token 不開放覆寫，維持預設即可，避免注入字串風險）。

### 解析邏輯 `resolveActiveTheme(db)`

1. seedIfEmpty（`site_themes` 空 → 寫 `DEFAULT_SITE_THEMES`；`site_config/theme` 缺 → 寫 `{ activeThemeId: 'default' }`）
2. 讀 `site_config/theme.activeThemeId`
3. 讀該 theme doc；若不存在或 `enabled=false` → fallback `isDefault` theme
4. 合併：`tokens = { ...defaultTheme.tokens, ...activeTheme.tokens }`（default 保證每 key 有值）
5. 回傳 `ResolvedTheme`

## SSR 注入（FOUC-free 核心）

### `app/composables/useSiteThemeInject.ts`

```ts
export const useSiteThemeInject = () => {
  const store = StoreTheme();
  // SSR + client 首次：確保 resolved theme 已載入（useAsyncData，payload 帶到 client）
  // 產出 CSS 字串：[data-da-theme]{--da-amber:#..;...} + hero 變數
  const css = computed(() => buildThemeCss(store.resolved));
  useHead({ style: [{ id: 'da-theme-vars', innerHTML: css }] });
};
```

- **注入選擇器** `[data-da-theme]`（非 `:root`）→ 只作用掛了此屬性的乘客 layout 子樹。
- **hero 變數**一併注入（`--da-hero-bg`, `--da-hero-stripe-yellow`, `--da-hero-stripe-dark`, `--da-hero-tag`），index.vue 直接吃。
- **載入時機**：在 `front-desk.vue` / `marketing.vue` 的 `<script setup>` 呼叫 `useSiteThemeInject()`；用 `useAsyncData('site-theme', () => $api.GetSiteTheme())` 確保 SSR 先解析、payload 序列化到 client、hydration 不重打不閃。

### Layout 掛載

```pug
//- front-desk.vue / marketing.vue
.LayoutFrontDesk(data-da-theme)
  //- 既有內容
```

admin（back-desk）、driver layout **不掛** `data-da-theme` → 永遠吃 `:root` 預設，不受換季影響。

## Hero 綁定（L2，index.vue）

現況 hero-bg = `var(--da-cream)`、runway/stripe = 寫死 rgba/hex。改為：

```scss
.PageLanding__hero-bg {
  background: var(--da-hero-bg, var(--da-cream)); // 有主題圖用圖，否則色
  background-size: cover; background-position: center;
}
.PageLanding__stripe {
  background: repeating-linear-gradient(-45deg,
    var(--da-hero-stripe-yellow, #F5C842) 0 12px,
    var(--da-hero-stripe-dark, #1A1814) 12px 24px);
}
```

Hero 圖由 Claude 每套做一張，commit 到 `public/themes/{id}/hero.webp`，seed 的 `hero.bgImage` 指向它。`default` 主題 `bgImage` 留空 → 維持現行純色 hero（換季不改變現況）。

## API 端點

| Method | Path | 權限 | 用途 |
|--------|------|------|------|
| GET | `/nuxt-api/config/theme` | 公開 | 回傳 ResolvedTheme（乘客端 SSR/client） |
| GET | `/nuxt-api/admin/config/themes` | super | 列全部主題包（含 disabled） |
| PUT | `/nuxt-api/admin/config/theme/active` | super | body `{ activeThemeId }` → 切換生效 |
| PATCH | `/nuxt-api/admin/config/themes/{id}/enabled` | super | body `{ enabled }` → 啟用/停用 |

- 錯誤處理走 `@@/utils/response`（`return` 非 `throw`，三語訊息）。
- 切換 active 寫 audit log（沿用既有 audit 樣板，action `site_theme.switch`）。
- 公開 GET 快取：沿用 fare/fleet 的短 TTL 模式（30s），換季後最多 30s 生效。
- **PIN gate**：切換屬中低敏感（視覺、可逆），首發只掛 super gate，不強制 PIN（與 fare rules 的 PIN 有別）；Brain 若要可後加。

## Pinia：重構 `2.store-theme.ts`

移除 dummy（`_lightColorsMap` / `_darkColorsMap` / `primaryTest` / `ChangeTheme` colorMode 佔位）。改為：

```ts
export const StoreTheme = defineStore('StoreTheme', () => {
  const resolved = ref<ResolvedTheme | null>(null);
  const setResolved = (t: ResolvedTheme) => { resolved.value = t; };
  return { resolved, setResolved };
});
```

（若 `useColorMode` 尚有他處引用需先確認；grep 顯示僅本 store 使用 → 可安全移除。）

## Firestore Rules

```
match /site_themes/{id}    { allow read: if true; allow write: if isAdmin(); }
match /site_config/{doc}    { allow read: if true; allow write: if isAdmin(); }
```

（對齊既有 `fleet_*` public-read / admin-write 樣式；實際 helper 名以 rules 現況為準。）

## Admin UI（W2）

`/admin/settings` 加「季節主題」section（或掛既有 tabbed settings）：

- 主題卡列表：每卡顯示 name（三語）+ 4–5 色 swatch + Hero 縮圖 + enabled toggle。
- 目前生效以 radio / highlight 標示；點「套用」→ PUT active。
- 停用中的主題不可被設為 active（前端 disable + 後端 guard）。
- 預覽：swatch + hero 縮圖即可；不做 iframe 全頁預覽（YAGNI，可後補）。

## 測試（Vitest）

- `shared/site-theme.spec.ts`：`isHexColor` 邊界、`resolveActiveTheme` 合併（default 疊 active / active disabled fallback / 缺 key fallback）、`buildThemeCss` 產出正確 selector 與變數、DEFAULT_SITE_THEMES 每套 tokens 都通過 hex 驗證。
- endpoint 層：切換 active 更新 pointer；停用 theme 不能設 active（400）。
- 目標沿用專案慣例（既有 600+ tests 持續綠）。

## 風險與緩解

| 風險 | 緩解 |
|------|------|
| FOUC / SSR 閃色 | 注入走 SSR head + payload；`useAsyncData` 確保 hydration 不重打 |
| 誤染 admin/driver | 用 `[data-da-theme]` scope，非 `:root`；admin/driver layout 不掛屬性 |
| 節日色對比爛、看不清 | 色票由 Claude 做、Brain 審；每套上 prod 前人工驗收（首發不開放自由改色） |
| glass rgba token 注入字串風險 | W1 只開放 hex token 覆寫，glass-bg/border 維持預設不覆寫 |
| 換季後舊快取殘留 | 短 TTL（30s）；可接受 |
