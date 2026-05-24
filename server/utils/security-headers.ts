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
