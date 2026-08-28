import { test } from '@playwright/test';
import { expectGuardedRouteSafe } from './_helpers';

/**
 * Auth E2E 矩陣 — 場景 #2 + #3 — 受保護路由訪客被守衛接管
 *
 * 範圍：未登入訪客造訪三端受保護路由，middleware ['auth','role'] 接管，
 *      不崩、不 infinite redirect、不跳 LINE OAuth domain。
 * 風險覆蓋：LIFF redirect loop（6/17 修復）、SPA auth race（spa-auth-race-fix）。
 *
 * 自動化邊界：不驗「登入後正確 mount」（屬 Tier B 場景 #5+），
 *            僅驗訪客狀態下守衛行為。
 */

const GUARDED_ROUTES = [
  // /booking 自 b0ff9a6 起是公開路由（訪客可填、送出才要身分）→ 移到 public-routes.spec
  // /profile 不存在（乘客個人資料已併進 /orders）→ 換成同樣受保護的 /notifications
  { end: 'passenger', path: '/orders' },
  { end: 'passenger', path: '/notifications' },
  { end: 'driver', path: '/driver/dashboard' },
  { end: 'admin', path: '/admin/orders' },
];
const LOCALE_PREFIX = [
  { code: 'zh', prefix: '' },
  { code: 'en', prefix: '/en' },
  { code: 'ja', prefix: '/ja' },
];

test.describe('auth #2+#3 — 受保護路由訪客守衛', () => {
  for (const { code, prefix } of LOCALE_PREFIX) {
    for (const { end, path } of GUARDED_ROUTES) {
      const url = `${prefix}${path}`;
      test(`[${code}] [${end}] ${url} — 訪客被守衛安全接管`, async ({ page }) => {
        await expectGuardedRouteSafe(page, url);
      });
    }
  }
});
