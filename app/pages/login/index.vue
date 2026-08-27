<script setup lang="ts">
// PageLogin — 乘客登入入口
//
// W2：分流邏輯收斂進 middleware/role.ts（共用 shared/utils/auth-target SSOT）。
//   - 未登入 → 顯示 LINE 登入按鈕
//   - 已登入 → middleware 在 navigation 時把 user replace 到對應端
//   - watch 兜底 race：authResolved 從 false → true 時 router 無 navigation event，
//     middleware 不重跑，故 page 內 watch 用同一個 utils 算 target 補一拳（無分歧）。
import { resolveDestination } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';
import { stripDeepLinkParams } from '~shared/auth/deep-link';

definePageMeta({ layout: false, middleware: ['role'] });

const config = useRuntimeConfig().public;
const authStore = StoreAuth();
const route = useRoute();
const { MockSignIn } = authStore;
const isTestMode = config.testMode === 'T';
const liffLoading = ref(false);

watch(
  () => [authStore.authResolved, authStore.isSignIn, authStore.roles.join(','), authStore.approved],
  () => {
    if (!authStore.authResolved || !authStore.isSignIn) return;
    const liffTarget = resolveLiffTarget({
      query: route.query as Record<string, string | string[] | null | undefined>,
      pathname: typeof window === 'undefined' ? undefined : window.location.pathname,
    });
    // W2：與 middleware/role 共用 resolveDestination（授權校驗）+ 消費深連結，邏輯零分歧
    const dest = resolveDestination({
      entryPath: route.path,
      isSignIn: authStore.isSignIn,
      roles: authStore.roles,
      approved: authStore.approved,
      liffTarget,
    });
    if (liffTarget) stripDeepLinkParams();
    if (dest && dest !== route.path) navigateTo(dest, { replace: true });
  },
  { immediate: true },
);

function ClickLineLogin() {
  // 認證根治 P3：改走 server-side LINE Login OAuth（固定 redirect_uri），取代 client liff.login()。
  // 舊 liff.login() 的 redirect_uri = 端點根 + 動態 ?liff.state=，永遠無法白名單化 →
  // PC / 外部瀏覽器必中 redirect_uri does not match。server OAuth 只認一條固定 callback，根治死鏈。
  liffLoading.value = true;
  const params = new URLSearchParams({ clientType: 'passenger' });
  const next = typeof route.query.next === 'string' ? route.query.next : '';
  if (next) params.set('target', next);
  window.location.href = `/nuxt-api/auth/line/start?${params.toString()}`;
}

function ClickMockLogin(kind: 'passenger' | 'driver' | 'admin') {
  // 測試模式：admin / driver mock 同時帶上 passenger，模擬實際多身分
  const mockRoles: ('passenger' | 'driver' | 'admin')[] =
    kind === 'admin'  ? ['passenger', 'admin']
  : kind === 'driver' ? ['passenger', 'driver']
  :                     ['passenger'];
  MockSignIn(mockRoles);
  navigateTo(kind === 'admin' ? '/admin/orders' : kind === 'driver' ? '/driver/dashboard' : '/home');
}
</script>

<template lang="pug">
.PageLogin
  //- ── 機場代碼浮水印 ──────────────────────────────────────────
  .PageLogin__watermark TPE

  //- ── 卡片 ────────────────────────────────────────────────────
  .PageLogin__card
    .PageLogin__logo
      | DEST
      span ∙
      | ANYWHERE
    p.PageLogin__tagline {{ $t('login.tagline') }}

    .PageLogin__divider

    //- LINE 登入按鈕
    button.PageLogin__line-btn(
      @click="ClickLineLogin"
      :disabled="liffLoading"
    )
      svg.PageLogin__line-icon(viewBox="0 0 24 24" fill="currentColor")
        path(d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314")
      span {{ liffLoading ? $t('login.loggingIn') : $t('login.lineLogin') }}

    //- 測試模式 bypass
    template(v-if="isTestMode")
      .PageLogin__test-label DEV MODE
      .PageLogin__test-btns
        button.PageLogin__test-btn(@click="ClickMockLogin('passenger')") 乘客
        button.PageLogin__test-btn(@click="ClickMockLogin('driver')") 司機
        button.PageLogin__test-btn(@click="ClickMockLogin('admin')") 管理者

  //- 版權
  p.PageLogin__copy © DEST・ANYWHERE
</template>

<style lang="scss" scoped>

.PageLogin {
  min-height: 100svh;
  background: var(--da-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  position: relative;
  overflow: hidden;
}

.PageLogin__watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--ff-display);
  font-size: clamp(160px, 50vw, 280px);
  letter-spacing: var(--ls-tight);
  color: var(--surface-a06);
  pointer-events: none;
  user-select: none;
  line-height: var(--lh-flat);
}

.PageLogin__card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 360px;
  background: color-mix(in srgb, var(--surface-deep-2) 80%, transparent);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-xl);
  padding: 36px 28px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.PageLogin__logo {
  font-family: var(--ff-display);
  font-size: var(--fs-h1);
  letter-spacing: var(--ls-wide);
  color: var(--da-cream);
  line-height: var(--lh-flat);
  margin-bottom: 8px;

  span { color: var(--da-amber); }
}

.PageLogin__tagline {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--surface-a30);
  margin-bottom: 0;
}

.PageLogin__divider {
  width: 100%;
  height: 1px;
  background: var(--accent-a12);
  margin: 28px 0;
}

.PageLogin__line-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 20px;
  background: var(--line-green);
  border: none;
  border-radius: var(--r-md);
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 700;
  color: var(--surface-raised);
  cursor: pointer;
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.98); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
}

.PageLogin__line-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.PageLogin__test-label {
  margin-top: 24px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--da-amber);
  opacity: 0.6;
  align-self: flex-start;
}

.PageLogin__test-btns {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
}

.PageLogin__test-btn {
  flex: 1;
  padding: 10px 8px;
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-md);
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  color: var(--da-amber);
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out);

  &:hover { background: var(--accent-a20); }
}

.PageLogin__copy {
  position: relative;
  z-index: 1;
  margin-top: 24px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-caps);
  color: var(--surface-a12);
}
</style>
