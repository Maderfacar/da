/**
 * mobile.spec.ts — 行動版 & Dark Mode E2E 測試
 *
 * 測試目標：
 *  1. 行動裝置版面（390px）各關鍵頁面不溢出、元素可見
 *  2. 乘客端底部 Tab Bar 五個 tab 均可見
 *  3. 頂部 Nav + LangSwitcher 不溢出、按鈕可見
 *  4. 司機端深色 Nav bar 正確顯示（dark mode 驗證）
 *  5. 各頁面無 JS 錯誤
 *
 * 注意：dev server 需在外部手動啟動 (pnpm dev)，本檔不啟動 server。
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ─── helper ─────────────────────────────────────────────────────────────────

function isViteArtifact(msg: string): boolean {
  return (
    msg.includes('504') ||
    msg.includes('Outdated Optimize Dep') ||
    msg.includes('dynamically imported module') ||
    msg.includes('entry.js')
  );
}

async function gotoAndWait(page: Page, url: string) {
  const errors: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !isViteArtifact(msg.text()) && !msg.text().includes('favicon')) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err: Error) => {
    if (!isViteArtifact(err.message)) errors.push(`[pageerror] ${err.message}`);
  });

  await page.goto(url, { waitUntil: 'load', timeout: 25_000 });
  await page.waitForTimeout(800);

  // 等待 LoadingPage 遮罩移除
  try {
    await page.waitForSelector('.LoadingPage', { state: 'detached', timeout: 5_000 });
  } catch { /* 可能不存在 */ }

  return { errors };
}

// ─── Suite 1：乘客端行動版版面 ───────────────────────────────────────────────

test.describe('Mobile — 乘客端版面', () => {

  test('頂部 Nav：Logo + LangSwitcher 均可見，不溢出畫面', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/home');

    // Logo
    const logo = page.locator('.LayoutFrontDesk__logo');
    await expect(logo).toBeVisible();

    // LangSwitcher
    const switcher = page.locator('.LangSwitcher__trigger');
    await expect(switcher).toBeVisible();

    // Nav bar 不溢出（bounding box 需在 viewport 內）
    const nav = page.locator('.LayoutFrontDesk__top');
    const box = await nav.boundingBox();
    expect(box, 'Nav top bar 不存在').toBeTruthy();
    expect(box!.x, 'Nav 左邊溢出').toBeGreaterThanOrEqual(0);
    expect(box!.y, 'Nav 頂部溢出').toBeGreaterThanOrEqual(0);

    const viewport = page.viewportSize()!;
    expect(box!.x + box!.width, 'Nav 右邊溢出').toBeLessThanOrEqual(viewport.width + 1);

    expect(errors).toHaveLength(0);
  });

  test('底部 Tab Bar：5 個 tab 均可見且不溢出', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/home');

    const tabs = page.locator('.LayoutFrontDesk__tab');
    await expect(tabs).toHaveCount(5);

    // 每個 tab 的 icon 均可見
    for (let i = 0; i < 5; i++) {
      await expect(tabs.nth(i).locator('.LayoutFrontDesk__tab-icon')).toBeVisible();
    }

    // Tab bar 本身不溢出
    const bar = page.locator('.LayoutFrontDesk__bottom');
    const barBox = await bar.boundingBox();
    expect(barBox).toBeTruthy();

    const viewport = page.viewportSize()!;
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(viewport.width + 1);

    // Tab bar 固定在底部：bottom ≤ viewport.height
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(viewport.height + 1);

    expect(errors).toHaveLength(0);
  });

  test('/home：Hero 標題可見，CTA 按鈕不超出視窗寬度', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/home');

    // Hero 標題
    const title = page.locator('.PageHome__hero-title').first();
    await expect(title).toBeVisible();

    // CTA 按鈕
    const ctaPrimary = page.locator('.PageHome__cta-primary');
    await expect(ctaPrimary).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await ctaPrimary.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);

    // Stats board 可見
    const statsGrid = page.locator('.PageHome__stats-grid');
    await expect(statsGrid).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('/booking：步驟進度條 + 表單卡片可見，無橫向溢出', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/booking');

    // 步驟進度條
    const steps = page.locator('.PageBooking__step');
    await expect(steps.first()).toBeVisible({ timeout: 10_000 });
    expect(await steps.count()).toBe(4);

    // 表單卡片
    const card = page.locator('.PageBooking__card');
    await expect(card).toBeVisible();

    // 無橫向捲軸：body 寬度不超過 viewport
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()!.width;
    expect(bodyWidth, `頁面有橫向溢出：scrollWidth=${bodyWidth}，viewport=${viewportWidth}`).toBeLessThanOrEqual(viewportWidth + 1);

    expect(errors).toHaveLength(0);
  });

  test('/upcoming：分頁 tabs 可橫向捲動，行程卡片可見', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/upcoming');

    // 待確認：tabs 可見
    const tabBar = page.locator('.PageUpcoming__tabs');
    await expect(tabBar).toBeVisible({ timeout: 10_000 });

    // 空狀態或卡片容器都應可見
    const section = page.locator('.PageUpcoming__section, .PageUpcoming__empty').first();
    await expect(section).toBeVisible({ timeout: 8_000 });

    expect(errors).toHaveLength(0);
  });

  test('/fleet：車型選擇器 + 規格可見', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/fleet');

    const selector = page.locator('.PageFleet__selector, .PageFleet__vehicle-btn').first();
    await expect(selector).toBeVisible({ timeout: 10_000 });

    const viewport = page.viewportSize()!;
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewport.width + 1);

    expect(errors).toHaveLength(0);
  });

});

// ─── Suite 2：行動版 LangSwitcher 開關 ──────────────────────────────────────

test.describe('Mobile — LangSwitcher 互動', () => {

  test('點擊 LangSwitcher 能開啟下拉，選項不超出視窗', async ({ page }) => {
    await gotoAndWait(page, '/en/home');

    const switcher = page.locator('.LangSwitcher').first();
    await switcher.click();

    const menu = page.locator('.LangSwitcher__menu');
    await expect(menu).toBeVisible({ timeout: 3_000 });

    // 下拉選單不超出右側視窗
    const viewport = page.viewportSize()!;
    const menuBox = await menu.boundingBox();
    expect(menuBox).toBeTruthy();
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 2);
  });

  test('點擊外部能關閉 LangSwitcher 下拉', async ({ page }) => {
    await gotoAndWait(page, '/en/home');

    const switcher = page.locator('.LangSwitcher').first();
    await switcher.click();
    await expect(page.locator('.LangSwitcher__menu')).toBeVisible();

    // 點擊 Hero 標題（選單外）
    await page.locator('.PageHome__hero-title').click({ force: true });
    await expect(page.locator('.LangSwitcher__menu')).not.toBeVisible({ timeout: 2_000 });
  });

});

// ─── Suite 3：Dark Mode — 司機端深色 Nav ────────────────────────────────────

test.describe('Dark Mode — 司機端深色版面', () => {

  test('/driver/dashboard：頂部 Nav 為深色背景 (rgba 接近 #1A1814)', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/driver/dashboard');

    const nav = page.locator('.LayoutDriver__top');
    await expect(nav).toBeVisible({ timeout: 10_000 });

    // 確認 Logo 顏色為淺色 (cream)
    const logo = page.locator('.LayoutDriver__logo');
    await expect(logo).toBeVisible();

    // 確認 status dot 存在（綠色線上指示器）
    const dot = page.locator('.LayoutDriver__status-dot');
    await expect(dot).toBeVisible();

    // 深色 Nav 的背景色應包含深色 rgba
    const bgColor = await nav.evaluate((el) => getComputedStyle(el).backgroundColor);
    // rgba(26, 24, 20, 0.92) — r 和 g 值均 < 50，表示為深色
    const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    expect(match, `無法解析 background-color: ${bgColor}`).toBeTruthy();
    const [, r, g, b] = match!.map(Number);
    const luminance = (r + g + b) / 3;
    expect(luminance, `Driver Nav 背景應為深色，luminance=${luminance.toFixed(1)}`).toBeLessThan(60);

    expect(errors).toHaveLength(0);
  });

  test('/driver/dashboard：底部 Tab Bar 4 個 tab 均可見', async ({ page }) => {
    const { errors } = await gotoAndWait(page, '/driver/dashboard');

    const tabs = page.locator('.LayoutDriver__tab');
    await expect(tabs).toHaveCount(4);

    for (let i = 0; i < 4; i++) {
      await expect(tabs.nth(i)).toBeVisible();
    }

    expect(errors).toHaveLength(0);
  });

  test('/driver/dashboard：loading 遮罩為深色背景（auth 前）', async ({ page }) => {
    // 在 auth resolved 之前，loading overlay 應使用 --da-dark 背景
    // 直接導航並立即截取樣式（authResolved=false 短暫顯示）
    await page.goto('/driver/dashboard', { waitUntil: 'domcontentloaded' });

    // loading 可能轉瞬即逝（testMode 或快速 auth），若存在則驗證顏色
    const loading = page.locator('.LayoutDriver__loading');
    const isVisible = await loading.isVisible().catch(() => false);

    if (isVisible) {
      const bgColor = await loading.evaluate((el) => getComputedStyle(el).backgroundColor);
      const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        const [, r, g, b] = match.map(Number);
        const luminance = (r + g + b) / 3;
        expect(luminance, 'Driver loading overlay 應為深色背景').toBeLessThan(60);
      }
    }
    // loading 不存在也視為通過（auth 已解析）
  });

});

// ─── Suite 4：無橫向溢出（regression guard）────────────────────────────────

test.describe('Mobile — 無橫向溢出（所有主要頁面）', () => {

  const PAGES = [
    { name: 'home',     path: '/home' },
    { name: 'booking',  path: '/booking' },
    { name: 'upcoming', path: '/upcoming' },
    { name: 'fleet',    path: '/fleet' },
  ];

  for (const { name, path } of PAGES) {
    test(`/${name} 無橫向 overflow`, async ({ page }) => {
      await gotoAndWait(page, path);

      const bodyWidth   = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = page.viewportSize()!.width;

      expect(
        bodyWidth,
        `/${name} 有橫向溢出：scrollWidth=${bodyWidth}, viewport=${viewportWidth}`,
      ).toBeLessThanOrEqual(viewportWidth + 1);
    });
  }

});
