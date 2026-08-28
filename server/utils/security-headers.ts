/**
 * W3：HTTP Security Headers 中央化配置
 *
 * 起步寬鬆策略（CSP 起步 enforce 但允許 unsafe-inline / unsafe-eval）：
 * - Nuxt SSR 注入 inline `<script>window.__NUXT__ = ...` payload → 需 unsafe-inline 或 nonce
 * - Google Maps SDK 內部 inline eval + 注入 inline style → 寬鬆版需 unsafe-eval / unsafe-inline
 * - TinyMCE 大量 inline style → 需 style-src unsafe-inline
 * - W3-FU 後續收嚴：改 nonce-based script-src，並評估能否從 style-src 拔 unsafe-inline
 *
 * Profile：
 * - default — 乘客端 / 公開頁 / driver；frame-ancestors self + X-Frame-Options SAMEORIGIN
 * - admin   — admin 端；frame-ancestors none + X-Frame-Options DENY（不可被任何站 iframe）
 *
 * 參考：W3 盤點報告（2026-05-24）。
 */

export type SecurityProfile = 'default' | 'admin';

const CSP_ORIGINS = {
  googleMaps: [
    'https://maps.googleapis.com',
    'https://maps.gstatic.com',
  ],
  googleApis: [
    'https://*.googleapis.com',
    'https://*.gstatic.com',
    'https://*.googleusercontent.com',
  ],
  firebaseStorage: [
    'https://firebasestorage.googleapis.com',
    'https://*.firebasestorage.app',
  ],
  line: [
    'https://api.line.me',
    'https://access.line.me',
    'https://static.line-scdn.net',
    'https://*.line-scdn.net',
    'https://*.line.me',
  ],
} as const;

// CSP keyword token 是 ASCII single quote 字面值；專案 ESLint quotes 規則只放行
// 單引號（連 backtick 也擋），故以 escape 表達。可讀性差但符合 lint。
const SELF = '\'self\'';
const NONE = '\'none\'';
const UNSAFE_INLINE = '\'unsafe-inline\'';
const UNSAFE_EVAL = '\'unsafe-eval\'';

function _buildCspDirectives(profile: SecurityProfile): Record<string, string[]> {
  const frameAncestors = profile === 'admin' ? [NONE] : [SELF];

  return {
    'default-src': [SELF],
    'script-src': [
      SELF,
      UNSAFE_INLINE,
      UNSAFE_EVAL,
      ...CSP_ORIGINS.googleMaps,
      'https://static.line-scdn.net',
    ],
    'style-src': [SELF, UNSAFE_INLINE],
    'font-src': [SELF, 'data:'],
    'img-src': [
      SELF,
      'data:',
      'blob:',
      ...CSP_ORIGINS.googleApis,
      ...CSP_ORIGINS.firebaseStorage,
      'https://*.line-scdn.net',
    ],
    'connect-src': [
      SELF,
      ...CSP_ORIGINS.googleApis,
      ...CSP_ORIGINS.firebaseStorage,
      ...CSP_ORIGINS.line,
    ],
    'form-action': [SELF, 'https://*.line.me'],
    'frame-src': [SELF, 'https://*.line.me'],
    'frame-ancestors': frameAncestors,
    'worker-src': [SELF, 'blob:'],
    'object-src': [NONE],
    'base-uri': [SELF],
    // valueless directive：自動把 mixed content（http://）升 https://
    'upgrade-insecure-requests': [],
  };
}

/** Serialize CSP directives 成 single-line header value */
export function buildCsp(profile: SecurityProfile = 'default'): string {
  const directives = _buildCspDirectives(profile);
  return Object.entries(directives)
    .map(([key, values]) => (values.length === 0 ? key : `${key} ${values.join(' ')}`))
    .join('; ');
}

/**
 * 完整 security headers 表，餵 nuxt.config.ts > nitro.routeRules.headers
 *
 * HSTS 起步 1 年、不帶 preload：W3-FU 一週驗無 regression 再升 63072000 + preload directive
 *（preload directive 仍不主動提交 Chromium preload list — 一旦進 list 12+ 個月不可逆）。
 */
export function getSecurityHeaders(profile: SecurityProfile = 'default'): Record<string, string> {
  const xFrameOptions = profile === 'admin' ? 'DENY' : 'SAMEORIGIN';

  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': xFrameOptions,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self), payment=()',
    'Content-Security-Policy': buildCsp(profile),
  };
}

// ── 本機 plain-HTTP 例外（2026-08-29）────────────────────────────────────────
//
// `upgrade-insecure-requests` 與 HSTS 在 https 的 prod 上完全正確，但本機用
// `node .output/server/index.mjs` 起的是 **plain HTTP**。Chromium 對 localhost 網開一面，
// **WebKit 不會** —— 它老實把每一支 `/static/*.js`、`*.css` 升成 `https://localhost:3000`，
// 於是全數 `SSL connect error`。
//
// 後果：auth e2e 的 iphone-14 project（devices['iPhone 14'] → WebKit）整批失敗，
// 因為 JS 從沒載入 —— 不是紅在斷言，是紅在頁面根本沒 boot。
//
// ⚠ 視覺基線**不受影響**：`tests/e2e/visual/baseline.spec.ts` 早就自己發現過這件事，
// 並在 spec 內用 `stripSecurityHeaders` 從 response header 把 CSP 拿掉（見該檔檔頭註解）。
// 本 plugin 修的是 server 端，讓 auth e2e 這種沒有自帶 workaround 的套件也能跑；
// 加上之後重拍視覺基線，51 張一張都沒變 —— 那是這件事已被繞過的證據。
//
// 判定條件刻意收得極窄：**只看 host 是不是 localhost / 127.0.0.1 / [::1]**。
// prod 的 host 永遠不可能是這些，所以線上行為零改變 —— 不用 x-forwarded-proto 之類
// 可被偽造或在某些代理下缺失的訊號來決定要不要拿掉安全標頭。
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** host header（可能帶 port）是否為本機。 */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  // IPv6 字面值形如 `[::1]:3000`；先抓中括號段，否則以最後一個冒號切 port
  const bracket = host.match(/^\[[^\]]+\]/);
  const hostname = bracket ? bracket[0] : host.split(':')[0];
  return LOCAL_HOSTNAMES.has((hostname ?? '').toLowerCase());
}

/**
 * 把一份 security headers 調整成「plain-HTTP 本機可用」：
 * 移除 HSTS、並從 CSP 拿掉 `upgrade-insecure-requests`。其餘標頭原封不動。
 */
export function relaxHeadersForLocalHttp(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'strict-transport-security') continue;
    if (key.toLowerCase() === 'content-security-policy') {
      out[key] = stripUpgradeInsecureRequests(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** 從 CSP 字串移除 `upgrade-insecure-requests` directive（其餘 directive 與順序不變）。 */
export function stripUpgradeInsecureRequests(csp: string): string {
  return csp
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toLowerCase() !== 'upgrade-insecure-requests')
    .join('; ');
}
