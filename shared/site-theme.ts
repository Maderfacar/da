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
  /**
   * 深色模式下的 --da-* 覆寫；缺項 fallback default 主題的 tokensDark，
   * 再缺回退 DEFAULT_TOKENS_DARK。
   *
   * ⚠ 為什麼深色要另一組而不是從淺色推導：--da-dark 在淺色模式是**主文字色**（深），
   *    在深色模式是**主文字色**（淺）—— 它的角色沒變，值卻要反過來。
   *    這種「同一個 key 在兩個模式下語意相同但值相反」的關係算不出來，只能各寫一組。
   */
  tokensDark?: Partial<Record<DaTokenKey, string>>;
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
  tokensDark: Record<DaTokenKey, string>;
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

// ── 預設深色調色盤 ────────────────────────────────────────────────────────────
// ⚠ 必須與 app/assets/styles/css-class/_theme-colors.css 的
//    `.dark [data-da-theme]` 區塊逐字一致（由 site-theme-sync.spec.ts 比對）。
//    那個區塊是「沒有主題注入時」的深色來源，這裡是「有主題注入時」的合併底層。
//    兩者不同步的症狀跟淺色那組一樣惡劣：切深色之後某一個 token 突然跳回另一組的值。
const DEFAULT_TOKENS_DARK: Record<DaTokenKey, string> = {
  'da-cream': '#121110',
  'da-off-white': '#1C1A18',
  'da-amber': '#C9A961',
  'da-amber-light': '#DCC188',
  'da-amber-pale': '#2B2519',
  'da-dark': '#EDEAE3',
  'da-dark-mid': '#C6C1B7',
  'da-gray': '#A29D93',
  'da-gray-light': '#7E7A71',
  'da-gray-pale': '#34312C',
  'da-stripe-yellow': '#6E5C36',
  'da-stripe-dark': '#171613',
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
    tokensDark: { ...DEFAULT_TOKENS_DARK },
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
    // 深色版：括號內為對該主題深色頁底的實測對比
    tokensDark: {
      'da-amber': '#D2705C',        // 暖磚紅（對 #141110 5.56:1）
      'da-amber-light': '#E8A08E',  // 8.82:1
      'da-amber-pale': '#2C1A17',
      'da-cream': '#141110',
      'da-off-white': '#1E1917',
      'da-stripe-yellow': '#4C7A62', // 常綠，深底上提亮（3.82:1，非文字）
      'da-stripe-dark': '#3A1614',
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
    tokensDark: {
      'da-amber': '#D4685F',        // 5.35:1
      'da-amber-light': '#E0BE7C',  // 金，10.64:1
      'da-amber-pale': '#2C1614',
      'da-cream': '#141010',
      'da-off-white': '#1F1817',
      'da-stripe-yellow': '#B08D4A', // 6.08:1
      'da-stripe-dark': '#3A1414',
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
    tokensDark: {
      'da-amber': '#5FAE9B',        // 7.08:1
      'da-amber-light': '#8CCBBB',  // 10.05:1
      'da-amber-pale': '#132320',
      'da-cream': '#101413',
      'da-off-white': '#18201E',
      'da-dark': '#E6EDEA',         // 主文字在深色模式反轉為淺色，這裡帶一點冷調呼應主題
      'da-stripe-yellow': '#3E7F70', // 3.95:1（非文字）
      'da-stripe-dark': '#16302B',
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

  // 深色盤走同一條合併路徑：active → default → DEFAULT_TOKENS_DARK
  const tokensDark = {} as Record<DaTokenKey, string>;
  for (const key of DA_THEME_TOKEN_KEYS) {
    const fromActive = active.tokensDark?.[key];
    const fromBase = base.tokensDark?.[key];
    tokensDark[key] =
      (isHexColor(fromActive) && fromActive) ||
      (isHexColor(fromBase) && fromBase) ||
      DEFAULT_TOKENS_DARK[key];
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

  return { activeThemeId: active.id, name: active.name, tokens, tokensDark, hero };
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
  // 深色區塊的選擇器必須是 `.dark [data-da-theme]`（0,2,0），才贏得過上面那條
  // `[data-da-theme]`（0,1,0）—— 兩者作用在**同一個節點**上，後者是前者的一般化。
  // 寫成 `:root.dark` 沒用：那是別的節點，子孫的宣告直接蓋掉繼承值，特異度不參與比較。
  // 詳見 design.md D23 與 _theme-colors.css 末段。
  // ⚠ `?? DEFAULT_TOKENS_DARK` 不是防禦性冗贅，是**部署窗口**的必要保底：
  //    /nuxt-api/config/theme 有 30 秒 TTL 快取，部署當下 client 已經是新版 JS，
  //    卻可能收到部署前產生的舊格式回應（沒有 tokensDark）。
  //    直接 `resolved.tokensDark[key]` 會拋 TypeError，而它在 useHead 的 computed 裡 ——
  //    整個 layout 的 head 計算失敗，症狀是白畫面，不是「顏色怪怪的」。
  const darkDecls = DA_THEME_TOKEN_KEYS.map(
    (key) => `--${key}:${resolved.tokensDark?.[key] ?? DEFAULT_TOKENS_DARK[key]}`,
  );
  return `[data-da-theme]{${decls.join(';')}}.dark [data-da-theme]{${darkDecls.join(';')}}`;
};
