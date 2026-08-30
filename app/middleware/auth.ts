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

  // 認證根治 P1（2026-08-14）：server cookie session-check 為登入真相第一來源（sticky，只打一次）。
  // cookie 命中 → isSignIn 立即為真，免等 Firebase 前端 hydration 的 12s race（本次事件死鏈根治）。
  // 2026-08-17：同 middleware/role —— middleware 內未捕捉的 reject 會被 Nuxt 轉成全螢幕
  // 500 錯誤頁，且 error-handler.client.ts 三道收集器都蓋不到，現場只看得到 500、log 全空。
  // 失敗改為記錄並往下走（未登入仍會被下方 isSignIn 判斷踢去登入頁，安全性不變）。
  try {
    await authStore.EnsureSessionChecked();
  } catch (err) {
    logMiddleware({
      event: 'middleware.ensure.session-check.failed',
      severity: 'error',
      message: `EnsureSessionChecked 失敗 @ ${to.path}：${err instanceof Error ? err.message : String(err)}`,
      metadata: { path: to.path, from: 'middleware/auth' },
    });
  }

  // 認證根治 P2（2026-08-15）：cookie 命中即為登入真相，三端一致免等 Firebase。
  //   - admin/driver 的 gate 欄位（roles/approved/level/admin2faEnrolled/driverApplication）已由
  //     session bootstrap（EnsureSessionChecked）一把載齊，middleware/role 可直接 cookie 路徑 gate，
  //     不再需要 Firebase user + client SDK lazy loader（P1 曾為此對 admin/driver 強制等 Firebase）。
  //   - 僅「cookie 未命中（isSignIn 仍 false）」時才等 Firebase 派生登入，作為無 cookie / 過渡
  //     Bearer 裝置的 fallback。
  if (!authStore.isSignIn && !authStore.authResolved) {
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
    // hydration 同形守門（2026-08-30，Brain AI 拍板套用；同 middleware/role login-entry）：
    // 訪客深連結受保護頁（如未登入直開 /orders）時，SSR 畫的是原頁骨架，初次進站的
    // client middleware 若在 hydration 完成前就 navigateTo(/login)，client 會拿登入頁
    // 的 vDOM 去對原頁的 SSR HTML —— 一次 mismatch 噪音。壓到 app:suspense:resolve
    // 後再踢，語意（SSR 不 redirect、client 補踢）與落點不變。
    const nuxtApp = useNuxtApp();
    if (import.meta.client && nuxtApp.isHydrating) {
      const router = useRouter();
      nuxtApp.hook('app:suspense:resolve', () => {
        void router.replace(loginPath);
      });
      return;
    }
    // 用 replace 而非 push — 避免 reload 期間「閃登入頁 → 跳回原頁」造成歷史堆疊，
    // 按返回鍵又回到「未授權的原頁」造成 middleware 迴圈
    return navigateTo(loginPath, { replace: true });
  }
});
