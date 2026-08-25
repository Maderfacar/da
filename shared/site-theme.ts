// 乘客端季節/節日主題包 — 前後端共享核心（W1）
//
// 一套主題包 = 一組 --da-* 調色盤覆寫 + 一組首頁 Hero 主視覺設定。
// 換季 = 後端切換「目前生效哪一套」（site_config/theme.activeThemeId）。
//
// 設計要點：
//   - 只開放 hex 色 token 覆寫（glass-bg/border 的 rgba 不列入白名單，維持預設避免注入字串風險）
//   - 注入選擇器為 [data-da-theme]（掛在乘客 layout），非 :root → admin/driver 不受影響
//   - default 主題色值 == 現行 app/assets/styles/css-class/_theme-colors.css，確保「未套主題」== 現況
//
// 驗證採手寫（與 fleet-config.ts / fare-rules-cache.ts 一致，專案未於此層引入 zod）。

// ── 可被主題覆寫的 --da-* token 白名單（hex only）─────────────────────────────
export const DA_THEME_TOKEN_KEYS = [
  'da-cream',
  'da-off-white',
  'da-amber',
  'da-amber-light',
  'da-amber-pale',
  'da-dark',
  'da-dark-mid',
  'da-gray',
  'da-gray-light',
  'da-gray-pale',
  'da-stripe-yellow',
  'da-stripe-dark',
] as const;

export type DaTokenKey = typeof DA_THEME_TOKEN_KEYS[number];

export interface I18nLabel {
  zh: string;
  en: string;
  ja: string;
}

export interface SiteThemeHero {
  /** Hero 背景圖 URL（public asset 如 /themes/christmas/hero.webp 或 https）；缺省 → 首頁維持純色 hero */
  bgImage?: string;
  /** 斜紋亮色；缺省 → tokens['da-stripe-yellow'] */
  stripeYellow?: string;
  /** 斜紋暗色；缺省 → tokens['da-stripe-dark'] */
  stripeDark?: string;
  /** Hero tag 強調色；缺省 → tokens['da-amber'] */
  tagColor?: string;
}

export interface SiteTheme {
  id: string;
  name: I18nLabel;
  /** --da-* hex 覆寫；缺項 fallback default 主題 */
  tokens: Partial<Record<DaTokenKey, string>>;
  hero: SiteThemeHero;
  enabled: boolean;
  sortOrder: number;
  /** 唯一一筆 true，作為合併底層與 fallback 目標 */
  isDefault: boolean;
}

/** GET /nuxt-api/config/theme 回傳（已解析、tokens 已補齊為完整 record） */
export interface ResolvedTheme {
  activeThemeId: string;
  name: I18nLabel;
  tokens: Record<DaTokenKey, string>;
  hero: {
    bgImage?: string;
    stripeYellow: string;
    stripeDark: string;
    tagColor: string;
  };
}

// ── 驗證 ──────────────────────────────────────────────────────────────────────

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 3 或 6 碼 hex 色（含 #）。glass rgba token 不走此路徑。 */
export const isHexColor = (v: unknown): v is string =>
  typeof v === 'string' && HEX_COLOR_RE.test(v);

// Hero 圖網址白名單：站內 /themes/... 靜態資源，或 https 絕對網址；副檔名限影像格式。
// 阻擋含引號 / 括號 / 分號 / 空白的字串，避免注入到 CSS url() 破壞 style 區塊。
//   - https 規則允許副檔名後帶查詢字串（?...），以放行 Firebase Storage 的
//     signed URL（`...hero.webp?X-Goog-Signature=...`）與公開 URL；查詢字元僅限
//     [\w\-.%=&]（不含 " ' ( ) ; 空白 \），維持 CSS url() 注入安全。
//   - svg 刻意不列入白名單（SVG 可內嵌 script，僅開放 webp/jpg/png/avif）。
const SAFE_LOCAL_IMG_RE = /^\/[\w\-./]+\.(?:webp|jpe?g|png|avif)$/i;
const SAFE_HTTPS_IMG_RE = /^https:\/\/[\w\-./%]+\.(?:webp|jpe?g|png|avif)(?:\?[\w\-.%=&]*)?$/i;

/** Hero 背景圖網址是否安全可注入 url()。 */
export const isSafeThemeImageUrl = (v: unknown): v is string =>
  typeof v === 'string' && (SAFE_LOCAL_IMG_RE.test(v) || SAFE_HTTPS_IMG_RE.test(v));

// ── 預設調色盤（== _theme-colors.css 的 --da-*）────────────────────────────────
// ⚠ 必須與 app/assets/styles/css-class/_theme-colors.css 的 --da-* 逐字一致。
// 這裡是乘客端實際吃到的值（經 resolveTheme 注入 [data-da-theme]）；不同步的話，
// admin/driver 會變色而乘客端被舊色蓋回去 —— 而且「admin 變了」看起來像成功。
// 另兩個同步點：prod Firestore site_themes（跑 pnpm migrate:site-themes）、
// tests/e2e/auth/fixtures.ts 的 /nuxt-api/config/theme mock。
const DEFAULT_TOKENS: Record<DaTokenKey, string> = {
  'da-cream': '#EAE7E0',
  'da-off-white': '#F5F3EE',
  'da-amber': '#7E6330',
  'da-amber-light': '#C9A961',
  'da-amber-pale': '#F0E8D6',
  'da-dark': '#1A1917',
  'da-dark-mid': '#26241F',
  'da-gray': '#6D6A62',
  'da-gray-light': '#868073',
  'da-gray-pale': '#D6D1C7',
  'da-stripe-yellow': '#B79A5E',
  'da-stripe-dark': '#26241F',
};

// ── Seed 主題包（Claude 定色，Brain 審）──────────────────────────────────────
// default 攜帶完整 tokens 作為合併底層；節日包只覆寫需變動的 key。色值已於 2026-08-25
// 依精品調底色（骨白 #EAE7E0）重新校準 —— 舊值是配著米白 + 琥珀定的，換底後會失衡。
// 文字色（da-dark）一律保留深色確保對比可讀。
export const DEFAULT_SITE_THEMES: SiteTheme[] = [
  {
    id: 'default',
    name: { zh: '經典（預設）', en: 'Classic (Default)', ja: 'クラシック（既定）' },
    tokens: { ...DEFAULT_TOKENS },
    hero: {},
    enabled: true,
    sortOrder: 0,
    isDefault: true,
  },
  {
    id: 'christmas',
    name: { zh: '聖誕限定', en: 'Christmas', ja: 'クリスマス' },
    tokens: {
      'da-amber': '#7A2B2B',        // 深酒紅（對其 off-white 8.52:1）
      'da-amber-light': '#B5553F',
      'da-amber-pale': '#F3E3DE',
      'da-cream': '#E9E6DF',
      'da-off-white': '#F5F2ED',
      'da-stripe-yellow': '#2E4F3C', // 深常綠
      'da-stripe-dark': '#6E2020',
    },
    hero: { stripeYellow: '#2E4F3C', stripeDark: '#6E2020', tagColor: '#7A2B2B' },
    enabled: true,
    sortOrder: 1,
    isDefault: false,
  },
  {
    id: 'lunar-new-year',
    name: { zh: '農曆春節', en: 'Lunar New Year', ja: '旧正月' },
    tokens: {
      'da-amber': '#8C2B2B',        // 深紅（對其 off-white 7.56:1）
      'da-amber-light': '#C9A961',  // 金
      'da-amber-pale': '#F5E9DC',
      'da-cream': '#EDE6DE',
      'da-off-white': '#F7F2EC',
      'da-stripe-yellow': '#B08D4A',
      'da-stripe-dark': '#7A1F1F',
    },
    hero: { stripeYellow: '#B08D4A', stripeDark: '#7A1F1F', tagColor: '#8C2B2B' },
    enabled: true,
    sortOrder: 2,
    isDefault: false,
  },
  {
    id: 'summer',
    name: { zh: '夏日海洋', en: 'Summer', ja: 'サマー' },
    tokens: {
      'da-amber': '#2F6156',        // 深松綠（對其 off-white 6.55:1）
      'da-amber-light': '#5E9C8C',
      'da-amber-pale': '#E2EEEA',
      'da-cream': '#E7ECEA',
      'da-off-white': '#F3F7F5',
      'da-dark': '#17201D',
      'da-stripe-yellow': '#3E7F70',
      'da-stripe-dark': '#1E3A34',
    },
    hero: { stripeYellow: '#3E7F70', stripeDark: '#1E3A34', tagColor: '#2F6156' },
    enabled: true,
    sortOrder: 3,
    isDefault: false,
  },
];

// ── 解析：把「主題清單 + 生效 id」解析為完整 ResolvedTheme（純函式，供單元測試）──
export const getDefaultTheme = (themes: readonly SiteTheme[]): SiteTheme =>
  themes.find((t) => t.isDefault) ?? themes[0] ?? DEFAULT_SITE_THEMES[0]!;

/**
 * 解析生效主題：
 *   - active 指向不存在 / enabled=false → fallback default 主題
 *   - tokens 以 default 為底疊 active，逐 key 補齊（保證每個白名單 key 皆有值）
 *   - 只採用通過 hex 驗證的覆寫值；非法值忽略、回退底層
 *   - hero 缺項回退對應 token；bgImage 僅在通過網址白名單時採用
 */
export const resolveTheme = (
  themes: readonly SiteTheme[],
  activeThemeId: string,
): ResolvedTheme => {
  const base = getDefaultTheme(themes);
  const active =
    themes.find((t) => t.id === activeThemeId && t.enabled) ?? base;

  const tokens = {} as Record<DaTokenKey, string>;
  for (const key of DA_THEME_TOKEN_KEYS) {
    const fromActive = active.tokens[key];
    const fromBase = base.tokens[key];
    tokens[key] =
      (isHexColor(fromActive) && fromActive) ||
      (isHexColor(fromBase) && fromBase) ||
      DEFAULT_TOKENS[key];
  }

  const hero: ResolvedTheme['hero'] = {
    stripeYellow: isHexColor(active.hero.stripeYellow)
      ? active.hero.stripeYellow!
      : tokens['da-stripe-yellow'],
    stripeDark: isHexColor(active.hero.stripeDark)
      ? active.hero.stripeDark!
      : tokens['da-stripe-dark'],
    tagColor: isHexColor(active.hero.tagColor)
      ? active.hero.tagColor!
      : tokens['da-amber'],
  };
  if (isSafeThemeImageUrl(active.hero.bgImage)) hero.bgImage = active.hero.bgImage;

  return { activeThemeId: active.id, name: active.name, tokens, hero };
};

// ── 產出注入用 CSS（scoped 到 [data-da-theme]）─────────────────────────────────
/**
 * 產出乘客 layout 注入用的 CSS 字串。
 * 選擇器 [data-da-theme] 使覆寫 cascade 給乘客 layout 子孫，但不動 :root（admin/driver 不受影響）。
 * 同時輸出 --da-hero-* 供首頁 Hero 綁定。
 */
export const buildThemeCss = (resolved: ResolvedTheme): string => {
  const decls: string[] = [];
  for (const key of DA_THEME_TOKEN_KEYS) {
    decls.push(`--${key}:${resolved.tokens[key]}`);
  }
  decls.push(`--da-hero-stripe-yellow:${resolved.hero.stripeYellow}`);
  decls.push(`--da-hero-stripe-dark:${resolved.hero.stripeDark}`);
  decls.push(`--da-hero-tag:${resolved.hero.tagColor}`);
  if (resolved.hero.bgImage) {
    decls.push(`--da-hero-bg:url("${resolved.hero.bgImage}")`);
  }
  return `[data-da-theme]{${decls.join(';')}}`;
};
