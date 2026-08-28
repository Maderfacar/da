import { describe, it, expect } from 'vitest';
import {
  buildCsp,
  getSecurityHeaders,
  isLocalHost,
  relaxHeadersForLocalHttp,
  stripUpgradeInsecureRequests,
} from './security-headers';

describe('security-headers', () => {
  describe('buildCsp()', () => {
    it('default profile：包含基本 directive', () => {
      const csp = buildCsp('default');
      expect(csp).toContain('default-src \'self\'');
      expect(csp).toContain('object-src \'none\'');
      expect(csp).toContain('base-uri \'self\'');
    });

    it('default profile：frame-ancestors 為 self', () => {
      const csp = buildCsp('default');
      expect(csp).toContain('frame-ancestors \'self\'');
      expect(csp).not.toContain('frame-ancestors \'none\'');
    });

    it('admin profile：frame-ancestors 為 none', () => {
      const csp = buildCsp('admin');
      expect(csp).toContain('frame-ancestors \'none\'');
      expect(csp).not.toContain('frame-ancestors \'self\'');
    });

    it('script-src 含 Google Maps（war-room / MapRoutePreview 動態載 script）', () => {
      const csp = buildCsp('default');
      expect(csp).toContain('https://maps.googleapis.com');
      expect(csp).toContain('https://maps.gstatic.com');
    });

    it('script-src 含 LINE LIFF SDK origin', () => {
      const csp = buildCsp('default');
      expect(csp).toContain('https://static.line-scdn.net');
    });

    it('script-src 起步保留 unsafe-inline / unsafe-eval（Nuxt SSR hydration + Google Maps eval）', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
    });

    it('style-src 起步保留 unsafe-inline（TinyMCE / Element Plus / Vue scoped）', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
    });

    it('connect-src 含 Firebase + LINE API origin', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.googleapis\.com/);
      expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.line\.me/);
      expect(csp).toMatch(/connect-src[^;]*https:\/\/access\.line\.me/);
      expect(csp).toMatch(/connect-src[^;]*https:\/\/firebasestorage\.googleapis\.com/);
    });

    it('img-src 允許 data: blob:（richmenu composer canvas + 檔案 export）', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/img-src[^;]*data:/);
      expect(csp).toMatch(/img-src[^;]*blob:/);
    });

    it('img-src 含 googleusercontent / line-scdn / firebasestorage（profile photo + 訂單照片）', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/img-src[^;]*https:\/\/\*\.googleusercontent\.com/);
      expect(csp).toMatch(/img-src[^;]*https:\/\/\*\.line-scdn\.net/);
      expect(csp).toMatch(/img-src[^;]*https:\/\/firebasestorage\.googleapis\.com/);
    });

    it('font-src 允許 self + data:（@nuxt/fonts self-host + TinyMCE embedded）', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/font-src[^;]*'self'/);
      expect(csp).toMatch(/font-src[^;]*data:/);
    });

    it('form-action 允許 LINE login redirect 流', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/form-action[^;]*'self'/);
      expect(csp).toMatch(/form-action[^;]*https:\/\/\*\.line\.me/);
    });

    it('frame-src 允許自家 + LINE', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/frame-src[^;]*'self'/);
      expect(csp).toMatch(/frame-src[^;]*https:\/\/\*\.line\.me/);
    });

    it('worker-src 允許 self + blob:（Firebase SDK web worker）', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/worker-src[^;]*'self'/);
      expect(csp).toMatch(/worker-src[^;]*blob:/);
    });

    it('upgrade-insecure-requests 為 valueless directive（key 之後直接接分號或結尾）', () => {
      const csp = buildCsp('default');
      expect(csp).toMatch(/(^|;\s*)upgrade-insecure-requests(;|$)/);
    });

    it('directives 用 "; " 分隔，整段為 single-line', () => {
      const csp = buildCsp('default');
      expect(csp).not.toContain('\n');
      expect(csp.split('; ').length).toBeGreaterThan(5);
    });
  });

  describe('getSecurityHeaders()', () => {
    it('default profile：含 6 個必要 hardening header', () => {
      const h = getSecurityHeaders('default');
      expect(h['Strict-Transport-Security']).toBeDefined();
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['X-Frame-Options']).toBeDefined();
      expect(h['Referrer-Policy']).toBeDefined();
      expect(h['Permissions-Policy']).toBeDefined();
      expect(h['Content-Security-Policy']).toBeDefined();
    });

    it('default profile：X-Frame-Options 為 SAMEORIGIN', () => {
      const h = getSecurityHeaders('default');
      expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
    });

    it('admin profile：X-Frame-Options 為 DENY（不可被任何站 iframe）', () => {
      const h = getSecurityHeaders('admin');
      expect(h['X-Frame-Options']).toBe('DENY');
    });

    it('admin profile：CSP frame-ancestors 連動為 none', () => {
      const h = getSecurityHeaders('admin');
      expect(h['Content-Security-Policy']).toContain('frame-ancestors \'none\'');
    });

    it('HSTS 起步 max-age=31536000 + includeSubDomains（W3-FU 才升 preload）', () => {
      const h = getSecurityHeaders('default');
      expect(h['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
      expect(h['Strict-Transport-Security']).not.toContain('preload');
    });

    it('Referrer-Policy 為 strict-origin-when-cross-origin', () => {
      const h = getSecurityHeaders('default');
      expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('Permissions-Policy 鎖未授權的 browser feature', () => {
      const h = getSecurityHeaders('default');
      const pp = h['Permissions-Policy'];
      expect(pp).toContain('microphone=()');
      expect(pp).toContain('payment=()');
      expect(pp).toContain('camera=(self)');
      expect(pp).toContain('geolocation=(self)');
    });

    it('預設參數 = default profile', () => {
      const noArg = getSecurityHeaders();
      const explicit = getSecurityHeaders('default');
      expect(noArg).toEqual(explicit);
    });
  });
});

// ── 本機 plain-HTTP 例外（2026-08-29）──────────────────────────────────────
// WebKit 不對 localhost 網開一面：upgrade-insecure-requests 會把 /static/* 升成 https，
// 本機 plain-HTTP server 於是全數 SSL connect error → JS 從沒載入。
// 這組測試同時守「會生效」與「不誤傷 prod」兩面。
describe('本機 plain-HTTP 鬆綁', () => {
  describe('isLocalHost()', () => {
    it('localhost / 127.0.0.1 / IPv6 loopback 皆判為本機（含 port）', () => {
      expect(isLocalHost('localhost:3000')).toBe(true);
      expect(isLocalHost('localhost')).toBe(true);
      expect(isLocalHost('127.0.0.1:3000')).toBe(true);
      expect(isLocalHost('[::1]:3000')).toBe(true);
      expect(isLocalHost('LOCALHOST:3000')).toBe(true);
    });

    it('prod host 一律不成立 —— 這是「線上零改變」的唯一依據', () => {
      expect(isLocalHost('da-line-liff-app.vercel.app')).toBe(false);
      expect(isLocalHost(undefined)).toBe(false);
      expect(isLocalHost('')).toBe(false);
    });

    it('不因字串包含 localhost 就誤判（子網域 / 前綴）', () => {
      expect(isLocalHost('localhost.evil.com')).toBe(false);
      expect(isLocalHost('notlocalhost')).toBe(false);
      expect(isLocalHost('evil.com')).toBe(false);
    });
  });

  describe('stripUpgradeInsecureRequests()', () => {
    it('拿掉該 directive，其餘原樣保留', () => {
      const out = stripUpgradeInsecureRequests(buildCsp('default'));
      expect(out).not.toContain('upgrade-insecure-requests');
      expect(out).toContain('default-src \'self\'');
      expect(out).toContain('object-src \'none\'');
    });

    it('沒有該 directive 時不動任何東西', () => {
      const csp = 'default-src \'self\'; object-src \'none\'';
      expect(stripUpgradeInsecureRequests(csp)).toBe(csp);
    });
  });

  describe('relaxHeadersForLocalHttp()', () => {
    it('移除 HSTS 並從 CSP 拿掉 upgrade-insecure-requests', () => {
      const relaxed = relaxHeadersForLocalHttp(getSecurityHeaders('default'));
      expect(relaxed['Strict-Transport-Security']).toBeUndefined();
      expect(relaxed['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    });

    it('其他 hardening header 一個都不能少（只鬆綁這兩項）', () => {
      const relaxed = relaxHeadersForLocalHttp(getSecurityHeaders('admin'));
      expect(relaxed['X-Content-Type-Options']).toBe('nosniff');
      expect(relaxed['X-Frame-Options']).toBe('DENY');
      expect(relaxed['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(relaxed['Permissions-Policy']).toBeDefined();
      expect(relaxed['Content-Security-Policy']).toContain('frame-ancestors \'none\'');
    });
  });
});
