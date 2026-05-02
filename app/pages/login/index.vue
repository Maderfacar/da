<script setup lang="ts">
definePageMeta({ layout: false });

const config = useRuntimeConfig().public;
const authStore = StoreAuth();
const { isSignIn, roles, authResolved } = storeToRefs(authStore);
const { MockSignIn } = authStore;
const isTestMode = config.testMode === 'T';
const liffLoading = ref(false);

watch([isSignIn, authResolved], () => {
  if (!authResolved.value || !isSignIn.value || !roles.value.length) return;
  navigateTo(roles.value.includes('admin') ? '/admin/orders' : '/home');
}, { immediate: true });

async function ClickLineLogin() {
  liffLoading.value = true;
  try {
    const liff = (await import('@line/liff')).default;
    liff.login();
  } catch {
    liffLoading.value = false;
  }
}

function ClickMockLogin(r: 'passenger' | 'driver' | 'admin') {
  MockSignIn(r);
  navigateTo(r === 'admin' ? '/admin/orders' : r === 'driver' ? '/driver/dashboard' : '/home');
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
    p.PageLogin__tagline 台灣高端機場接送平台

    .PageLogin__divider

    //- LINE 登入按鈕
    button.PageLogin__line-btn(
      @click="ClickLineLogin"
      :disabled="liffLoading"
    )
      svg.PageLogin__line-icon(viewBox="0 0 24 24" fill="currentColor")
        path(d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314")
      span {{ liffLoading ? '登入中...' : '使用 LINE 登入' }}

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
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

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
  font-family: $font-display;
  font-size: clamp(160px, 50vw, 280px);
  letter-spacing: -0.04em;
  color: rgba(255, 255, 255, 0.04);
  pointer-events: none;
  user-select: none;
  line-height: 1;
}

.PageLogin__card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 360px;
  background: rgba(40, 37, 31, 0.8);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(212, 134, 10, 0.2);
  border-radius: 20px;
  padding: 36px 28px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.PageLogin__logo {
  font-family: $font-display;
  font-size: 36px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;
  margin-bottom: 8px;

  span { color: var(--da-amber); }
}

.PageLogin__tagline {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 0;
}

.PageLogin__divider {
  width: 100%;
  height: 1px;
  background: rgba(212, 134, 10, 0.15);
  margin: 28px 0;
}

.PageLogin__line-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 20px;
  background: #06C755;
  border: none;
  border-radius: 12px;
  font-family: $font-body;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;

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
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
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
  background: rgba(212, 134, 10, 0.12);
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 10px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--da-amber);
  cursor: pointer;
  transition: background 0.2s;

  &:hover { background: rgba(212, 134, 10, 0.22); }
}

.PageLogin__copy {
  position: relative;
  z-index: 1;
  margin-top: 24px;
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.15);
}
</style>
