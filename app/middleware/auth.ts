// 驗證登入狀態，未登入時導向對應的登入頁
//
// P18 hotfix v2（race condition 真正修法）：
// 原寫法 `if (!authResolved) return` 直接放行 navigation 卻沒等 → page onMounted 跑時
// Firebase auth 尚未從 IndexedDB 復原 → `getAuth().currentUser=null` →
// `GetFreshIdToken()` 回空字串 → 受 require-auth 保護 endpoint 一律 401。
//
// 第一次嘗試（commit 8817920，已 revert）用 `watch(authResolved)` 等，但 SSR 上 plugin
// (.client.ts) 不跑、authResolved 永遠 false，watch 永遠不會 fire → 整站 hang。
//
// 此版改 `await store.WaitForAuthResolved()`（plain Promise，不靠 Vue reactivity）：
// - SSR：直接 return（既有行為，layout v-if loading 撐到 hydration 後再判斷）
// - client：await 12 秒上限（對齊 InitAuthFlow safetyTimer，逾時也會強制 mark resolved）
//
// W1：公開路由（isPublicRoute）直接放行，不等 auth 也不踢 /login。SSOT 由
// shared/constants/auth-public-routes 統一定義，BootGate 與 PageIndex 共用同一份名單。
import { isPublicRoute } from '~shared/constants/auth-public-routes';
import { logMiddleware } from '~/utils/error-log';

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  if (isPublicRoute(to.path)) return;

  const authStore = StoreAuth();

  if (!authStore.authResolved) {
    const t0 = Date.now();
    await Promise.race([
      authStore.WaitForAuthResolved(),
      new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
    ]);
    const waited = Date.now() - t0;
    if (waited >= 12_000) {
      logMiddleware({
        event: 'middleware.auth.wait-timeout',
        severity: 'warn',
        message: `WaitForAuthResolved 12s timeout @ ${to.path}`,
        metadata: { path: to.path, waited },
      });
    }
  }

  if (!authStore.isSignIn) {
    const loginPath = to.path.startsWith('/driver') ? '/driver/auth' : '/login';
    logMiddleware({
      event: 'middleware.redirect.unauth',
      message: `${to.path} → ${loginPath}`,
      metadata: { from: to.path, to: loginPath, reason: 'not-signed-in' },
    });
    // 用 replace 而非 push — 避免 reload 期間「閃登入頁 → 跳回原頁」造成歷史堆疊，
    // 按返回鍵又回到「未授權的原頁」造成 middleware 迴圈
    return navigateTo(loginPath, { replace: true });
  }
});
