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

// ⚠ /fleet 不在此列：它在 shared/constants/auth-public-routes.ts 是刻意保留的**公開前綴**
// （車型介紹已併進 /fare，註解寫明「保留前綴避免未來重啟頁面遺漏」），底下沒有頁面。
// 拿一個刻意不存在的路徑來斷言「訪客訪問不崩」必然紅 —— 那不是網站壞了，是清單抄錯對象。
const PUBLIC_ROUTES = ['/', '/booking', '/fare', '/faq', '/legal/terms', '/legal/privacy'];
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
