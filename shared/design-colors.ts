/**
 * 設計色的 JS 鏡像 —— 給「CSS 變數到不了的地方」用。
 *
 * 真相來源仍是 `app/assets/styles/css-class/_theme-colors.css`。
 * 這裡只是同一組值的 JS 表示，由 `design-token-guards.spec.ts` 逐項比對，漂移就紅。
 *
 * 什麼時候該用這裡的值（也只有這些時候）：
 *   - Google Maps JS API 的 `stylers` / marker `fillColor`（吃字串，不解析 var()）
 *   - `<canvas>` 的 `ctx.fillStyle`（richmenu 圖層合成器）
 *   - 送去 LINE 的 Flex message payload（色值離開瀏覽器，變成 LINE 伺服器算的圖）
 *   - 需要色碼字串的 JS 色表
 *
 * 什麼時候**不該**用：任何寫得出 CSS 的地方。在 CSS 裡請用 `var(--accent)` 這類 token ——
 * 只有 token 會跟著主題引擎換季，這裡的值不會。
 */
export const DESIGN_COLORS = {
  /** 骨白 · 頁面底 */
  surfaceGround: '#EAE7E0',
  /** 瓷白 · 卡片表面 */
  surfaceRaised: '#F5F3EE',
  /** 髮絲線 */
  hairline: '#D6D1C7',
  /** 縞黑 · 主文字／品牌面 */
  ink: '#1A1917',
  /** 深色面上的第二層 */
  ink2: '#26241F',
  /** 次要文字 */
  inkSoft: '#6D6A62',
  /** 三級文字 */
  inkMute: '#868073',
  /** 古銅 · 主色 */
  accent: '#9C7C3C',
  /** 亮銅 · 深底上使用 */
  accentLit: '#C9A961',
  /** 極淡底 */
  accentWash: '#F0E8D6',
  /** 主色深階（實心主色按鈕的 hover） */
  accentDeep: '#725A2D',

  /* ── 深色面第三層 ────────────────────────────────────────────
     與 _design-tokens.css 的 --surface-deep-3 同值。
     --surface-deep / --surface-deep-2 就是 ink / ink2，不另立 key。 */
  /** 深色面第三層／hover */
  surfaceDeep3: '#343331',

  /* ── 即時戰情地圖的暖黑色階（階段 2）──────────────────────────
     Google Maps 的 stylers 吃色碼字串、不解析 var()，所以只能走這裡。
     原本整套是藍黑（#1a1a2e / #2d2d4e / #373760 / #0f1623 / #3a3a5c / #1f1f35，
     hue 213–240°），與縞黑的暖黑軸（hue 40°）差了近一個補色 ——
     那是 admin 最大一片「看起來不像同一個站」的表面。
     這裡按**原本的相對明度**逐階平移到暖黑軸，地圖的層次關係不變，只有色相變。 */
  /** 地圖：一般道路 */
  mapRoad: '#3B3830',
  /** 地圖：主要幹道 */
  mapRoadMajor: '#47433A',
  /** 地圖：行政邊界線 */
  mapStroke: '#4A463C',

  /* ── 語意狀態色四件套 ──────────────────────────────────────────
     與 _design-tokens.css 的 --good / --wait / --note / --stop 同值。
     `*Lit` 是深色面用的階，對縞黑皆 ≥ 4.5:1。
     LINE Flex 的訊息底是白的（LINE 伺服器算圖，不吃我們的深色面），所以那邊用 base 階。 */
  /** 成功／已完成／已核准 */
  good: '#3E6B4E',
  goodLit: '#86BC9C',
  /** 等待／處理中／待確認 */
  wait: '#A0521F',
  waitLit: '#E5A878',
  /** 提示／資訊／進行中 */
  note: '#35527A',
  noteLit: '#98B6D6',
  /** 錯誤／危險／已取消 */
  stop: '#9E3535',
  stopLit: '#E08B8B',
} as const;

export type DesignColorKey = keyof typeof DESIGN_COLORS;

/** `_theme-colors.css` 的 `--da-*` 名稱 → 本模組的 key。守衛靠這張表比對。 */
export const DA_TOKEN_TO_DESIGN_COLOR: Readonly<Record<string, DesignColorKey>> = {
  'da-cream': 'surfaceGround',
  'da-off-white': 'surfaceRaised',
  'da-gray-pale': 'hairline',
  'da-dark': 'ink',
  'da-dark-mid': 'ink2',
  'da-gray': 'inkSoft',
  'da-gray-light': 'inkMute',
  'da-amber': 'accent',
  'da-amber-light': 'accentLit',
  'da-amber-pale': 'accentWash',
};
