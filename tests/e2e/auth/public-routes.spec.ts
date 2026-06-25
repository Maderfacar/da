import { test } from '@playwright/test';
import { expectPublicPageOk } from './_helpers';

/**
 * Auth E2E 矩陣 — 場景 #1 — 公開路由訪客可達
 *
 * 範圍：未登入訪客可直接訪問所有公開路由，三語切換不崩、不掉 i18n key。
 * 風險覆蓋：AEO marketing layout、SSR 公開頁、boot gate skip 名單。
 *
 * 自動化邊界：不驗 SEO meta / OG / JSON-LD（已由 AEO 專用測試覆蓋）。
 */

const PUBLIC_ROUTES = ['/', '/fare', '/fleet', '/faq', '/legal/terms', '/legal/privacy'];
const LOCALE_PREFIX = [
  { code: 'zh', prefix: '' },
  { code: 'en', prefix: '/en' },
  { code: 'ja', prefix: '/ja' },
];

test.describe('auth #1 — 公開路由訪客可達', () => {
  for (const { code, prefix } of LOCALE_PREFIX) {
    for (const route of PUBLIC_ROUTES) {
      const url = `${prefix}${route}`;
      test(`[${code}] ${url} — 訪客直接訪問不崩`, async ({ page }) => {
        await expectPublicPageOk(page, url);
      });
    }
  }
});
