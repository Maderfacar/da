// 角色路由分流（W4 lazy load 版，2026-06-18）：
//
// W4 起 user-specific Firestore doc 改 lazy load — middleware/role 進對應路徑時才 await Ensure*。
// onAuthStateChanged 只設 Firebase user + idToken，不再 eager 讀 Firestore。
//
// 「該 await 哪些 Ensure*」由純函式 `resolveRequiredLoads(path)` 決定（shared/auth/required-loads.ts）：
//   - 公開頁（非 login entry）→ 全 false
//   - login entry（/、/login、/driver/auth）→ user（為了算分流 target）
//   - /driver/register → user（檢查 approved driver 該不該跳 dashboard）
//   - /driver/* → user + driver
//   - /admin/2fa/* → user（避免 2FA gate 自我迴圈）
//   - /admin/* → user + admin + admin2fa
//   - 其他受保護頁（/home /booking /orders 等）→ user
//
// 分流邏輯（與 W2 共用 SSOT 不變）：
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//   - admin 路徑：roles 必須包含 'admin'；不符合 → 引回乘客端 /home
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true；不符合 → 導向 /driver/auth
//
// 路徑例外（driver 端公開入口）：
//   /driver/auth     — driver LINE LIFF 公開登入入口；未登入放行（顯示登入按鈕）
//   /driver/register — driver 申請入口；放行給 1) 純 passenger（apply mode）、
//                      2) driver 申請中（pending mode）、3) driver 被拒（rejected mode）；
//                      已核准 driver 強制導去 /driver/dashboard
//
// Ensure* 內部 sticky promise，重複進站 0 額外 Firestore read。
import { isLoginEntry, resolveDestination } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';
import { resolveRequiredLoads } from '~shared/auth/required-loads';
import { stripDeepLinkParams } from '~shared/auth/deep-link';
import { clearEntryIntent, readEntryIntent, rememberEntryIntent } from '~shared/auth/entry-intent';
import { noteRedirect, resetBreaker } from '~shared/auth/redirect-breaker';
import { logMiddleware } from '~/utils/error-log';

export default defineNuxtRouteMiddleware(async (to) => {
  const authStore = StoreAuth();

  // 認證根治 P1：先確保 server cookie session-check 已跑（sticky，auth.ts 多半已觸發 → 這裡 no-op），
  // 讓 roles / approved 來源與 server 一致（Firestore 即時 SSOT），避免只靠 Firebase claims 舊值 gate。
  await authStore.EnsureSessionChecked();

  // W2：所有 middleware 導向都過斷路器 —— 短時間內連續導向超過門檻即中止，
  // 讓當前頁渲染，避免任何邏輯 bug 造成無限登入迴圈（終極保險）。
  const guardedRedirect = (
    target: string,
    logEvent: string,
    logMessage: string,
    metadata: Record<string, unknown>,
  ) => {
    if (!noteRedirect()) {
      logMiddleware({
        event: 'middleware.redirect.loop-broken',
        severity: 'error',
        message: `斷路器觸發，中止導向 @ ${to.path} → ${target}`,
        metadata: { ...metadata, breaker: true, intendedTo: target },
      });
      resetBreaker();
      if (import.meta.client) {
        try {
          ElMessage({
            message: '登入流程發生異常，請關閉視窗重新開啟，或聯絡客服。',
            type: 'error',
            duration: 8000,
          });
        } catch { /* ElMessage 尚未 ready 時略過 */ }
      }
      return undefined; // 不導向 → 讓當前頁渲染，斷開重導風暴
    }
    logMiddleware({ event: logEvent, message: logMessage, metadata });
    return navigateTo(target, { replace: true });
  };

  if (!authStore.isSignIn) return; // auth.ts middleware 已踢未登入者到 /login
  // 認證根治 P2（2026-08-15）：移除舊「!authResolved return」保護。該保護屬 Firebase-only 時代
  // ——避免用半熟的 Firebase 派生資料 gate。現 cookie 路徑開機即由 session bootstrap 載齊
  // roles/approved/level/admin2faEnrolled/driverApplication，資料完整可直接 gate；Firebase 路徑
  // （無 cookie）則由下方 Ensure*（client SDK）補讀，auth.ts 已為其等過 authResolved 才放行至此。
  // isSignIn=true 必有 gate 基礎：cookie（bootstrap 已載）或 Firebase user（authResolved 已真）。

  // W4：依路徑並發 await 所需 doc loads（sticky promise dedup）
  const needs = resolveRequiredLoads(to.path);
  const ensures: Promise<void>[] = [];
  if (needs.user) ensures.push(authStore.EnsureUserDocLoaded());
  if (needs.driver) ensures.push(authStore.EnsureDriverDocLoaded());
  if (needs.admin) ensures.push(authStore.EnsureAdminDocLoaded());
  if (needs.admin2fa) ensures.push(authStore.EnsureAdmin2faSessionVerified());
  if (ensures.length > 0) await Promise.all(ensures);

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverAuth = to.path.startsWith('/driver/auth');
  const isDriverRegister = to.path.startsWith('/driver/register');

  // === W2 / W4：login-entry 分流（/、/login、/driver/auth）===
  // W2 單一 SSOT：resolveDestination 先做「深連結授權校驗」——
  // 深連結目標若該 user 無權進入（如 passenger 帶 /driver/trip），不再盲目導過去對踢，
  // 改走 resolveAuthTarget 授權落點（register/home）；並把深連結 query 從 URL 剝掉，消費一次。
  if (isLoginEntry(to.path)) {
    const liffTarget = resolveLiffTarget({
      query: to.query as Record<string, string | string[] | null | undefined>,
      pathname: import.meta.client ? window.location.pathname : undefined,
    });
    // 2026-08-17：深連結一出現就記進 entry-intent。URL 稍後會被 stripDeepLinkParams 剝乾淨，
    // 但 LIFF SDK init 完成後 middleware 會在 `/` 再解析一次；沒有這份意圖，第二輪就會落回
    // 角色預設，把司機 OA 進來的多重身分者丟去 /admin/orders（prod log 實測）。
    if (liffTarget) rememberEntryIntent(liffTarget);
    const intent = readEntryIntent();
    // 本輪 URL 沒有深連結時，沿用前一輪記下的目標與端別
    const effectiveTarget = liffTarget || intent?.target || '';
    const dest = resolveDestination({
      entryPath: to.path,
      isSignIn: authStore.isSignIn,
      roles: authStore.roles,
      approved: authStore.approved,
      liffTarget: effectiveTarget,
      entryEnd: intent?.end,
    });
    // 深連結已被消費（無論採用與否）→ 從 URL 剝掉，避免殘留 query 反覆觸發導向
    if (liffTarget) stripDeepLinkParams();

    if (dest && dest !== to.path) {
      return guardedRedirect(dest, 'middleware.redirect.login-entry', `${to.path} → ${dest}`, {
        from: to.path,
        to: dest,
        liffTarget: liffTarget || null,
        intentTarget: intent?.target ?? null,
        entryEnd: intent?.end ?? null,
        roles: authStore.roles,
      });
    }
    resetBreaker();
    return;
  }

  // 真正「落地」才清進站意圖：僅在不再導向、頁面確定要渲染時呼叫。
  // ⚠️ 不可在守衛彈開之前清 —— 若 driver doc 尚未載齊而被彈去 /driver/auth，
  // 意圖沒了就會走 `hasAdmin && !hasDriver → /admin/orders`，正是本次要修的症狀。
  const settle = () => {
    clearEntryIntent();
    resetBreaker();
  };

  // /driver/auth 未登入放行（上方已處理已登入分流）
  if (isDriverAuth) return;

  // /driver/register：已核准 driver 強制導去 dashboard，其他放行
  if (isDriverRegister) {
    if (authStore.roles.includes('driver') && authStore.approved) {
      return guardedRedirect('/driver/dashboard', 'middleware.redirect.driver-approved', `${to.path} → /driver/dashboard`, {
        from: to.path, to: '/driver/dashboard', reason: 'approved-driver-on-register',
      });
    }
    settle();
    return;
  }

  // === Admin 路徑 ===
  if (isAdminPath) {
    if (authStore.roles.length === 0) {
      // 已 authResolved 但 roles 為空（line-exchange 失敗 / Firestore rules 阻擋）— 放行讓 page 處理
      return;
    }
    if (!authStore.roles.includes('admin')) {
      return guardedRedirect('/home', 'middleware.redirect.admin-denied', `${to.path} → /home`, {
        from: to.path, to: '/home', reason: 'not-admin', roles: authStore.roles,
      });
    }
    // /admin/2fa/* 永遠放行（避免 setup / challenge 自己被擋進無窮迴圈）
    if (!to.path.startsWith('/admin/2fa')) {
      if (!authStore.admin2faEnrolled) {
        return guardedRedirect('/admin/2fa/setup', 'middleware.redirect.admin-2fa-setup', `${to.path} → /admin/2fa/setup`, {
          from: to.path, to: '/admin/2fa/setup', reason: 'not-enrolled',
        });
      }
      if (!authStore.admin2faSessionVerified) {
        logMiddleware({
          event: 'middleware.redirect.admin-2fa-challenge',
          message: `${to.path} → /admin/2fa/challenge`,
          metadata: { from: to.path, to: '/admin/2fa/challenge', reason: 'session-unverified' },
        });
        return navigateTo({ path: '/admin/2fa/challenge', query: { next: to.fullPath } }, { replace: true });
      }
    }
    settle();
    return;
  }

  // === Driver 路徑（非 auth / 非 register）===
  if (isDriverPath) {
    if (authStore.roles.length === 0) {
      return guardedRedirect('/driver/auth', 'middleware.redirect.driver-no-roles', `${to.path} → /driver/auth`, {
        from: to.path, to: '/driver/auth', reason: 'roles-empty',
      });
    }
    if (!authStore.roles.includes('driver') || !authStore.approved) {
      return guardedRedirect('/driver/auth', 'middleware.redirect.driver-denied', `${to.path} → /driver/auth`, {
        from: to.path, to: '/driver/auth',
        reason: !authStore.roles.includes('driver') ? 'not-driver' : 'not-approved',
        roles: authStore.roles, approved: authStore.approved,
      });
    }
    settle();
    return;
  }

  // 其他受保護頁 — Ensure* 已 await 完成；無額外 redirect 規則
  settle();
});
