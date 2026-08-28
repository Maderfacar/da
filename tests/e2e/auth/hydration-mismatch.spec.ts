import { test, expect } from '@playwright/test';
import { attachConsoleCapture } from './_helpers';

/**
 * 已知缺陷追蹤 — 乘客 / 司機 / Admin layout 的 hydration mismatch
 *
 * ── 這是什麼 ────────────────────────────────────────────────────────────────
 * 走 front-desk / driver / back-desk 三個 layout 的頁面，client 接手 SSR 產物時對不上：
 *
 *   [Vue warn] Hydration node mismatch:
 *   - rendered on server: <div class="LayoutFrontDesk" …>
 *   - expected on client: Symbol(v-fgt)          ← client 在同一個位置要的是 Fragment
 *   Hydration completed but contains mismatches.
 *
 * 後果不是白畫面，是「整個 layout 被 client 重畫一次」：SSR 的那份 DOM 白做，
 * 首屏會多一次重排，事件繫結也晚一拍。
 *
 * ── 確認過的事實（2026-08-29）─────────────────────────────────────────────
 *   1. **prod 也有**。用無痕瀏覽器打 https://da-line-liff-app.vercel.app/booking 一樣印這行。
 *      不是本機 / 測試環境造成的假象。
 *   2. 與 NUXT_PUBLIC_TEST_MODE 無關 —— server 端有沒有設，結果一模一樣。
 *   3. 與登入狀態無關 —— /booking 是公開路由、訪客身分、沒有任何 redirect，照樣發生。
 *   4. marketing layout（/ /fare /faq /legal/*）**乾淨**，一次都沒有。
 *      差別之一：marketing 的 layout 根元素第一個子節點是 <nav>；
 *      front-desk 與 back-desk 的第一個子節點是 <ClientOnly>（SSR 產出 <span></span>）。
 *      這只是相關性，還沒證實是因果。
 *   5. mismatch 只有一處，落在 NuxtLayout 這一層（layout 根元素 vs Fragment），
 *      不在 layout 內部。SSR 產物在該位置只有一組 `<!--[-->`，client 卻要兩層 Fragment。
 *
 * ── 為什麼是 test.fail ──────────────────────────────────────────────────────
 * 根治點在 app.vue 的 Suspense + CommonBootGate + NuxtLayout 這條開機鏈，
 * 那是三端共用的路徑（spa-auth-race-fix 就是在這裡出過事），不適合順手改。
 * 所以這裡誠實標成「已知會紅」：
 *   - 缺陷還在 → 這支 pass（符合預期的失敗），不會把其他 21 個測項一起染紅
 *   - 缺陷被修好 → 這支**反過來變紅**，逼人回來刪掉它，不會靜靜地留一條沒用的註解
 * 其餘 spec 的 appErrors 仍然是零容忍，只是把這一句拆去別的桶（見 _helpers.ts）。
 */

// 一端一條代表路由就夠 —— 這支的用途是「缺陷還在不在」，不是覆蓋率。
const AFFECTED = [
  { end: '乘客（front-desk）', path: '/booking' },   // 公開路由，訪客即可重現，最乾淨的一顆
  { end: 'Admin（back-desk）', path: '/admin/orders' },
] as const;

// marketing layout 目前是乾淨的。放進來當對照組：
// 如果哪天連它也開始 mismatch，代表問題擴散了，而不只是「那三個 layout 的老毛病」。
const CLEAN = [{ end: '行銷（marketing）', path: '/' }] as const;

test.describe('已知缺陷 — layout hydration mismatch', () => {
  for (const { end, path } of AFFECTED) {
    test(`${end} ${path} 目前仍有 hydration mismatch（修好請刪掉這條）`, async ({ page }) => {
      // 寫在 test body 內而不是 describe body —— 後者會把整個 describe（含下面的對照組）
      // 一起標成預期失敗，對照組就永遠不會真的守到東西。
      test.fail();
      const capture = attachConsoleCapture(page);
      await page.goto(path, { waitUntil: 'load', timeout: 25_000 });
      await page.waitForTimeout(3_000);

      expect(
        capture.hydrationMismatches,
        `${path} 的 hydration mismatch：\n${capture.hydrationMismatches.join('\n')}`,
      ).toHaveLength(0);
    });
  }

  for (const { end, path } of CLEAN) {
    test(`${end} ${path} 不該有 hydration mismatch（對照組）`, async ({ page }) => {
      const capture = attachConsoleCapture(page);
      await page.goto(path, { waitUntil: 'load', timeout: 25_000 });
      await page.waitForTimeout(3_000);

      expect(
        capture.hydrationMismatches,
        `${path} 原本是乾淨的，現在也 mismatch 了 —— 問題擴散到 marketing layout：\n`
          + capture.hydrationMismatches.join('\n'),
      ).toHaveLength(0);
    });
  }
});
