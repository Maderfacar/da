import { test, expect } from './fixtures';
import { attachConsoleCapture } from './_helpers';

/**
 * layout hydration mismatch 守衛（2026-08-30 由 test.fail 追蹤反轉而來）
 *
 * ── 歷史 ────────────────────────────────────────────────────────────────────
 * 2026-08-29 以前，front-desk / driver / back-desk 三個 layout 在 prod 都會印
 * 「Hydration completed but contains mismatches.」—— 整個 layout 被 client 重畫一次。
 * 當時根因不明，本檔用 test.fail() 誠實標成「已知會紅」。
 *
 * ── 根因（2026-08-30 查明並修復）───────────────────────────────────────────
 * 三個 layout 都在 `authResolved` 上做 SSR 可見的條件渲染：
 *   - front-desk：`slot(v-if="showContent")` —— SSR 恆 false 不渲染
 *   - driver / back-desk：auth loading 遮罩 `v-if="!authResolved"` —— SSR 恆 true 有渲染
 * 而 client 端 auth plugin / BootGate 常在 layout 第一次 render **之前**就把
 * authResolved 翻成 true，於是 client 首次 render 與 SSR 產物不同形 → mismatch。
 * dev 不重現純粹因為 dev 環境 auth 解析比 hydration 慢，時序恰好對上。
 *
 * 修法見 app/composables/use-hydration-done.ts：mounted 前把 auth 條件渲染壓到與
 * SSR 同形（⚠ 不能拿 nuxtApp.isHydrating 當初值 —— async layout 的 setup 執行當下
 * 它已是 false，實測守不住）。另把三個 layout 的 CommonHeaderUser 包進 ClientOnly。
 *
 * ── redirect 造成的 mismatch（2026-08-30 兩顆皆修，修法同一套）────────────
 * 「SSR 不 redirect、client 補踢」的兩條路（已登入開 login entry `/`、訪客深連結
 * 受保護頁）原本都在 hydration 完成前就 navigateTo —— client 拿目的頁的 vDOM 對
 * 原頁的 SSR HTML，必然 mismatch。修法：初次進站（client && isHydrating）把導向
 * 壓到 app:suspense:resolve 後（middleware/role login-entry 分支 + middleware/auth
 * unauth 分支），語意與落點不變。本檔各補一個守衛案例。
 *
 * ── 已知殘留（刻意不列入本守衛）────────────────────────────────────────────
 * 1. /driver/dashboard 的 AdminAirportForecastWidget（.client.vue）有頁面級
 *    children/class mismatch —— 與 layout 無關的獨立缺陷，另案追蹤。
 */

test.describe('layout hydration mismatch 守衛', () => {
  // 訪客可直接驗的公開路由（front-desk + marketing 對照組）
  for (const { end, path } of [
    { end: '乘客（front-desk）', path: '/booking' },
    { end: '行銷（marketing）', path: '/' },
  ] as const) {
    test(`訪客 ${end} ${path} 不得有 hydration mismatch`, async ({ page }) => {
      const capture = attachConsoleCapture(page);
      await page.goto(path, { waitUntil: 'load', timeout: 25_000 });
      await page.waitForTimeout(3_000);

      expect(
        capture.hydrationMismatches,
        `${path} 的 hydration mismatch：\n${capture.hydrationMismatches.join('\n')}`,
      ).toHaveLength(0);
    });
  }

  // 已登入者開 login entry `/`（2026-08-30 prod 驗收回報的那顆）：
  // middleware/role 的 login-entry 補踢原本在 hydration 完成前就 navigateTo(/home)，
  // client 拿 /home 的 vDOM 對 `/` 的 SSR HTML → 整頁 mismatch。修法＝導向壓到
  // app:suspense:resolve 之後（middleware）+ PageIndex watch 加 hydrationDone 因子。
  // 本案例同時守「mismatch 為零」與「補踢仍然會發生」兩件事。
  test('passenger 開 / 補踢 /home 不得有 hydration mismatch', async ({ page, loginAs }) => {
    await loginAs('passenger');
    const capture = attachConsoleCapture(page);
    await page.goto('/', { waitUntil: 'load', timeout: 25_000 });
    // 補踢改到 hydration 完成後才發生 —— 等 URL 真的變成 /home，證明導向沒有因此丟失
    await page.waitForURL('**/home', { timeout: 15_000 });
    await page.waitForTimeout(3_000);

    expect(
      capture.hydrationMismatches,
      `/ → /home 補踢的 hydration mismatch：\n${capture.hydrationMismatches.join('\n')}`,
    ).toHaveLength(0);
  });

  // 訪客深連結受保護頁（2026-08-30 Brain AI 拍板套同一招修掉的那顆）：
  // middleware/auth 的 unauth 補踢原本也在 hydration 完成前 navigateTo(/login)。
  // 同時守「mismatch 為零」與「補踢仍然會發生」。
  test('訪客深連結 /orders 補踢 /login 不得有 hydration mismatch', async ({ page }) => {
    const capture = attachConsoleCapture(page);
    await page.goto('/orders', { waitUntil: 'load', timeout: 25_000 });
    await page.waitForURL('**/login', { timeout: 15_000 });
    await page.waitForTimeout(3_000);

    expect(
      capture.hydrationMismatches,
      `/orders → /login 補踢的 hydration mismatch：\n${capture.hydrationMismatches.join('\n')}`,
    ).toHaveLength(0);
  });

  // 受保護路由：登入態直達（不觸發 redirect），同路由 hydration 必須同形
  for (const { end, path, identity } of [
    { end: '乘客（front-desk）', path: '/orders', identity: 'passenger' },
    { end: 'Admin（back-desk）', path: '/admin/orders', identity: 'adminWith2fa' },
  ] as const) {
    test(`${identity} ${end} ${path} 不得有 hydration mismatch`, async ({ page, loginAs }) => {
      await loginAs(identity);
      const capture = attachConsoleCapture(page);
      await page.goto(path, { waitUntil: 'load', timeout: 25_000 });
      await page.waitForTimeout(3_000);

      expect(
        capture.hydrationMismatches,
        `${path} 的 hydration mismatch：\n${capture.hydrationMismatches.join('\n')}`,
      ).toHaveLength(0);
    });
  }
});
