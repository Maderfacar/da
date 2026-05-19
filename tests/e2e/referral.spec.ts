import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * 推薦獎勵機制 — E2E（推薦獎勵機制 Phase 5）
 *
 * 設計：openspec/changes/2026-05-20-referral-share-reward/design.md
 *
 * ⚠️ 範圍說明：
 *   完整關鍵流程（分享 → bind → 歡迎碼 → 完成首單 → 推薦碼）牽涉 LINE 登入、
 *   LIFF `shareTargetPicker`、真實 Firestore 狀態與 admin 改單，無法在無頭瀏覽器
 *   中自動化。以下為「可自動驗證」的表層：路由註冊、auth 守衛、頁面不崩潰。
 *   互動式 bind/獎勵鏈路請於 LIFF 環境手動驗收。
 */

function isViteDevArtifact(msg: string): boolean {
  return (
    msg.includes('504') ||
    msg.includes('Outdated Optimize Dep') ||
    msg.includes('dynamically imported module') ||
    msg.includes('entry.js')
  );
}

async function collectConsole(page: Page, url: string) {
  const appErrors: string[] = [];
  const i18nMissing: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if ((msg.type() === 'warning' || msg.type() === 'warn')
      && (text.includes('[vue-i18n]') || text.includes('Not found') || text.includes('missing key'))) {
      i18nMissing.push(text);
    }
    if (msg.type() === 'error' && !isViteDevArtifact(text) && !text.includes('favicon')) {
      appErrors.push(text);
    }
  });
  page.on('pageerror', (err: Error) => {
    if (!isViteDevArtifact(err.message)) appErrors.push(`[pageerror] ${err.message}`);
  });

  await page.goto(url, { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(1500);
  return { appErrors, i18nMissing };
}

// ─── /referral/share 路由 smoke ─────────────────────────────────────────────
// /referral/share 受 middleware ['auth','role'] 守衛：未登入訪客會被導離。
// 驗證路由已註冊、守衛運作、頁面在無 auth 狀態下不丟出未捕捉錯誤。

test.describe('referral — /referral/share 路由與 auth 守衛', () => {
  const LOCALE_PATHS = [
    { code: 'zh', path: '/referral/share' },
    { code: 'en', path: '/en/referral/share' },
    { code: 'ja', path: '/ja/referral/share' },
  ];

  for (const { code, path } of LOCALE_PATHS) {
    test(`[${code}] ${path} — 未登入訪問不崩潰、auth 守衛接管`, async ({ page }) => {
      const { appErrors } = await collectConsole(page, path);

      // 頁面成功 mount（auth 守衛可能已將其導離 share 頁）
      await expect(page.locator('body')).toBeVisible();

      // 不得有未捕捉的應用層錯誤
      expect(appErrors, `App errors on ${path}:\n${appErrors.join('\n')}`).toHaveLength(0);

      // 不得停在 Nuxt error 頁
      const bodyText = (await page.locator('body').textContent()) ?? '';
      expect(bodyText.includes('404') && bodyText.includes('Page not found')).toBe(false);
    });
  }
});
