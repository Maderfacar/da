import { test, expect } from '@playwright/test';
import { attachConsoleCapture } from './_helpers';

/**
 * Auth E2E 矩陣 — 場景 #4 — Plugin boot 不無條件 LIFF auto-redirect
 *
 * 範圍：headless 環境（無 LIFF context、無 line UA），訪問乘客受保護路由時
 *      auth.client plugin 不應強推 liff.login() 把使用者送出我們的 domain，
 *      也不應陷入 infinite redirect loop。
 * 風險覆蓋：2026-06-17 commit f9a7198 修復點（liff-no-auto-redirect）—
 *          全新使用者首次進站不可被 plugin boot 強推到 LINE 後又彈回，無限循環。
 *
 * 自動化邊界：不驗「真實 LIFF 內登入流程」（屬 Tier C 手動驗收）。
 */

const PROBE_ROUTES = ['/booking', '/orders', '/profile'];

test.describe('auth #4 — LIFF redirect guard（plugin boot 不無條件 redirect）', () => {
  for (const route of PROBE_ROUTES) {
    test(`${route} — headless 訪客不應被 plugin 推去 LINE OAuth`, async ({ page }) => {
      const capture = attachConsoleCapture(page);

      const visited: string[] = [];
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) visited.push(frame.url());
      });

      await page.goto(route, { waitUntil: 'load', timeout: 25000 });
      await page.waitForTimeout(5000);

      const finalHost = new URL(page.url()).hostname;
      expect(
        finalHost.endsWith('line.me'),
        `Route ${route} unexpectedly redirected to LINE: ${page.url()}\nTrail:\n${visited.join('\n')}`,
      ).toBe(false);

      const counts = visited.reduce<Record<string, number>>((acc, u) => {
        acc[u] = (acc[u] ?? 0) + 1;
        return acc;
      }, {});
      const looped = Object.entries(counts).find(([, n]) => n > 5);
      expect(
        looped,
        `Detected redirect loop on ${route}: ${looped?.[0]} visited ${looped?.[1]} times`,
      ).toBeUndefined();

      expect(
        capture.appErrors,
        `App errors on ${route}:\n${capture.appErrors.join('\n')}`,
      ).toHaveLength(0);
    });
  }
});
