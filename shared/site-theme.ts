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
const DEFAULT_TOKENS: Record<DaTokenKey, string> = {
  'da-cream': '#F5F2EC',
  'da-off-white': '#FAF8F4',
  'da-amber': '#D4860A',
  'da-amber-light': '#F0A830',
  'da-amber-pale': '#FDF3DC',
  'da-dark': '#1A1814',
  'da-dark-mid': '#2E2B25',
  'da-gray': '#6B6560',
  'da-gray-light': '#B8B3AC',
  'da-gray-pale': '#E8E4DC',
  'da-stripe-yellow': '#F5C842',
  'da-stripe-dark': '#2A2620',
};

// ── Seed 主題包（Claude 定色，Brain 審）──────────────────────────────────────
// default 攜帶完整 tokens 作為合併底層；節日包只覆寫需變動的 key，文字色（da-dark）
// 一律保留深色確保對比可讀。Hero 圖 W2 補（bgImage 先留空 → 首頁維持純色）。
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
      'da-amber': '#C1121F',
      'da-amber-light': '#E63946',
      'da-amber-pale': '#FBE6E6',
      'da-cream': '#F4F1EA',
      'da-off-white': '#F7F5F0',
      'da-stripe-yellow': '#1E6B3A',
      'da-stripe-dark': '#9B1C1C',
    },
    hero: { stripeYellow: '#1E6B3A', stripeDark: '#9B1C1C', tagColor: '#C1121F' },
    enabled: true,
    sortOrder: 1,
    isDefault: false,
  },
  {
    id: 'lunar-new-year',
    name: { zh: '農曆春節', en: 'Lunar New Year', ja: '旧正月' },
    tokens: {
      'da-amber': '#D4AF37',
      'da-amber-light': '#E8C860',
      'da-amber-pale': '#FBF3D9',
      'da-cream': '#F7ECEA',
      'da-off-white': '#FDF6F4',
      'da-stripe-yellow': '#E8C860',
      'da-stripe-dark': '#A4161A',
    },
    hero: { stripeYellow: '#E8C860', stripeDark: '#A4161A', tagColor: '#C0392B' },
    enabled: true,
    sortOrder: 2,
    isDefault: false,
  },
  {
    id: 'summer',
    name: { zh: '夏日海洋', en: 'Summer', ja: 'サマー' },
    tokens: {
      'da-amber': '#E9724C',
      'da-amber-light': '#F4A261',
      'da-amber-pale': '#FCEBDD',
      'da-cream': '#EAF6F5',
      'da-off-white': '#F2FAF9',
      'da-dark': '#22333B',
      'da-stripe-yellow': '#2A9D8F',
      'da-stripe-dark': '#264653',
    },
    hero: { stripeYellow: '#2A9D8F', stripeDark: '#264653', tagColor: '#2A9D8F' },
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
