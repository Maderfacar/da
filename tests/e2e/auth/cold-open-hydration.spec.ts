import { test, expect } from './fixtures';

/**
 * P2-2 canary — 冷啟動 hydration 健康檢查（2026-08-01）
 *
 * 目的：抓「開得起來但 hydrate 壞掉」回歸 —— 即乘客「看似登出」事件的機器化守門。
 *   後端登入成功、頁面也 mount 了，但 store roles 空窗 / header 秀訪客樣 / 出現
 *   「載入失敗，請重新登入」。既有 booking-cold-warm-boot 驗「進得去、不卡 spinner」，
 *   本檔專驗「已登入者的 hydrate 不變式」，兩者互補。
 *
 * 為何「spinner 撤除」即等於「roles 已 hydrate」：
 *   front-desk layout 的 showContent 對已登入者要求 rolesLoadState==='ready'，
 *   而 UseRolesLoadGuard 只在 authStore.roles.length > 0 時才轉 'ready'
 *   （見 app/composables/use-roles-load-guard.ts）。故對 signed-in 乘客，
 *   spinner 消失 + 不出 roles-failed ⟺ roles 確實非空 = hydrate 成功。
 *   （直接 poke window.__authStore.roles 在 page.evaluate 下有 Pinia proxy 解包
 *    不穩問題，改以此 DOM 不變式為權威訊號，避免 flaky。）
 *
 * 掛在既有 3 個 e2e project（chromium / mobile-chrome / iphone-14）一併跑。
 */

const SPINNER = '.LayoutFrontDesk__content-loading';
const ROLES_FAILED = '.LayoutFrontDesk__roles-failed';
const ROLES_FAILED_TEXT = '載入失敗，請重新登入';
const HEADER_USER = '.CommonHeaderUser';

test.describe('P2-2 canary — 冷開乘客 /booking hydrate 正常', () => {
  test('mock 已登入乘客冷開 /booking：roles hydrate + header 有身份 + 無「載入失敗」+ 無 console error', async ({ page, loginAs }) => {
    // 收集 console error（含未捕捉例外）—— hydrate 壞掉常伴隨 runtime error
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    await loginAs('passenger');
    await page.goto('/booking', { waitUntil: 'load', timeout: 15_000 });

    // 1) 內容區 spinner 5s 內撤除（showContent=true → 對已登入者代表 roles 已 hydrate）
    await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });

    // 2) 絕不出現「載入失敗，請重新登入」兜底畫面（roles 逾時空窗的訊號）
    await expect(page.locator(ROLES_FAILED)).toHaveCount(0);
    await expect(page.getByText(ROLES_FAILED_TEXT)).toHaveCount(0);

    // 3) CommonHeaderUser 有 render（header 身份區存活，非訪客空殼）
    await expect(page.locator(HEADER_USER)).toBeVisible();

    // 4) 停在 /booking，未被踢 /login
    expect(page.url()).toMatch(/\/booking/);
    expect(page.url()).not.toMatch(/\/login/);

    // 5) 無 console error（hydrate 壞掉的常見伴生訊號）
    expect(consoleErrors, `冷開出現 console error：\n${consoleErrors.join('\n')}`).toHaveLength(0);
  });
});
