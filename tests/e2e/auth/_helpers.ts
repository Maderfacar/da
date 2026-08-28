import { expect, type Page, type ConsoleMessage } from '@playwright/test';

const isViteDevNoise = (msg: string): boolean =>
  msg.includes('504') ||
  msg.includes('Outdated Optimize Dep') ||
  msg.includes('dynamically imported module') ||
  msg.includes('entry.js') ||
  msg.includes('favicon');

export type ConsoleCapture = {
  appErrors: string[];
  i18nMissing: string[];
  /** hydration mismatch —— 見下方 HYDRATION_MISMATCH 註解，刻意與 appErrors 分開收 */
  hydrationMismatches: string[];
};

// Vue 在 hydration 對不上時印的那一行。**這是站上真實存在的缺陷，不是測試環境假象**：
// 同一句在 prod（https://da-line-liff-app.vercel.app/booking）用無痕瀏覽器也照樣出現。
//
// 為什麼從 appErrors 拆出來：它會出現在**每一支**走乘客 / 司機 / Admin layout 的案例上，
// 於是 21 個測項全部紅在同一顆已知缺陷上，把「守衛有沒有壞」這件事整個蓋掉 ——
// 真的有新錯誤時反而看不出來。拆開之後 appErrors 仍然是零容忍，
// 這顆已知缺陷則由 hydration-mismatch.spec.ts 單獨追蹤（test.fail，修好會反過來變紅）。
const HYDRATION_MISMATCH = 'Hydration completed but contains mismatches';

export function attachConsoleCapture(page: Page): ConsoleCapture {
  const appErrors: string[] = [];
  const i18nMissing: string[] = [];
  const hydrationMismatches: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if ((msg.type() === 'warning' || msg.type() === 'warn')
      && (text.includes('[vue-i18n]') || text.includes('Not found') || text.includes('missing key'))) {
      i18nMissing.push(text);
    }
    if (msg.type() === 'error' && !isViteDevNoise(text)) {
      if (text.includes(HYDRATION_MISMATCH)) hydrationMismatches.push(text);
      else appErrors.push(text);
    }
  });
  page.on('pageerror', (err: Error) => {
    if (!isViteDevNoise(err.message)) appErrors.push(`[pageerror] ${err.message}`);
  });

  return { appErrors, i18nMissing, hydrationMismatches };
}

export async function expectPublicPageOk(page: Page, url: string): Promise<ConsoleCapture> {
  const capture = attachConsoleCapture(page);

  await page.goto(url, { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(1500);

  await expect(page.locator('body')).toBeVisible();

  expect(
    capture.appErrors,
    `App errors on ${url}:\n${capture.appErrors.join('\n')}`,
  ).toHaveLength(0);

  const bodyText = (await page.locator('body').textContent()) ?? '';
  expect(
    bodyText.includes('404') && bodyText.includes('Page not found'),
    `Page ${url} ended on Nuxt 404 error page`,
  ).toBe(false);

  return capture;
}

export async function expectGuardedRouteSafe(page: Page, url: string): Promise<ConsoleCapture> {
  const capture = attachConsoleCapture(page);

  await page.goto(url, { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(5000);

  await expect(page.locator('body')).toBeVisible();

  expect(
    capture.appErrors,
    `App errors on guarded route ${url}:\n${capture.appErrors.join('\n')}`,
  ).toHaveLength(0);

  const currentHost = new URL(page.url()).hostname;
  expect(
    currentHost.endsWith('line.me'),
    `Guarded route ${url} unexpectedly redirected to LINE domain: ${page.url()}`,
  ).toBe(false);

  const bodyText = (await page.locator('body').textContent()) ?? '';
  expect(
    bodyText.includes('404') && bodyText.includes('Page not found'),
    `Guarded route ${url} ended on Nuxt 404 error page`,
  ).toBe(false);

  return capture;
}
