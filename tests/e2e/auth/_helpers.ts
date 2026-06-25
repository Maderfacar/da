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
};

export function attachConsoleCapture(page: Page): ConsoleCapture {
  const appErrors: string[] = [];
  const i18nMissing: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if ((msg.type() === 'warning' || msg.type() === 'warn')
      && (text.includes('[vue-i18n]') || text.includes('Not found') || text.includes('missing key'))) {
      i18nMissing.push(text);
    }
    if (msg.type() === 'error' && !isViteDevNoise(text)) {
      appErrors.push(text);
    }
  });
  page.on('pageerror', (err: Error) => {
    if (!isViteDevNoise(err.message)) appErrors.push(`[pageerror] ${err.message}`);
  });

  return { appErrors, i18nMissing };
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
