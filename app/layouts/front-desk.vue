<script setup lang="ts">
// LayoutFrontDesk 乘客端佈局：固定頂部 Nav + 底部 5-Tab Bar

const route = useRoute();
const authStore = StoreAuth();
const { authResolved, isFriend, isSignIn } = storeToRefs(authStore);
const { lineOaAddUrl } = useRuntimeConfig().public;

const showFriendBanner = computed(
  () => isSignIn.value && isFriend.value === false,
);

const { t } = useI18n();

const tabs = computed(() => [
  { id: 'home',   icon: '🏠', label: t('tab.home'),   path: '/home',     dot: false },
  { id: 'trips',  icon: '✈',  label: t('tab.trips'),  path: '/upcoming', dot: true  },
  { id: 'book',   icon: '＋', label: t('tab.book'),   path: '/booking',  dot: false },
  { id: 'fleet',  icon: '🚗', label: t('tab.fleet'),  path: '/fleet',    dot: false },
  { id: 'orders', icon: '📋', label: t('tab.orders'), path: '/orders',   dot: false },
]);

const activeTab = computed(() => {
  const p = route.path;
  if (p === '/home' || p === '/') return 'home';
  if (p.startsWith('/upcoming'))  return 'trips';
  if (p.startsWith('/booking'))   return 'book';
  if (p.startsWith('/fleet'))     return 'fleet';
  if (p.startsWith('/orders'))    return 'orders';
  return 'home';
});
</script>

<template lang="pug">
.LayoutFrontDesk
  ClientOnly
    UiToast

  //- ── Auth Loading ────────────────────────────────────────
  ClientOnly
    transition(name="auth-fade")
      .LayoutFrontDesk__loading(v-if="!authResolved")
        .LayoutFrontDesk__loading-logo
          | DEST
          span ∙
          | ANYWHERE
        .LayoutFrontDesk__loading-spinner

  //- ── 加好友提醒橫幅 ──────────────────────────────────────
  ClientOnly
    transition(name="banner-slide")
      .LayoutFrontDesk__friend-banner(v-if="showFriendBanner")
        span.LayoutFrontDesk__banner-text {{ $t('banner.addFriend') }}
        a.LayoutFrontDesk__banner-btn(
          :href="lineOaAddUrl"
          target="_blank"
          rel="noopener noreferrer"
        ) {{ $t('banner.addBtn') }}

  //- ── 固定頂部 Nav ─────────────────────────────────────────
  nav.LayoutFrontDesk__top
    .LayoutFrontDesk__logo(@click="navigateTo('/home')")
      | DEST
      span ∙
      | ANYWHERE
    .LayoutFrontDesk__nav-right
      LangSwitcher
      button.LayoutFrontDesk__nav-btn(@click="navigateTo('/orders')") {{ $t('nav.orders') }}
      button.LayoutFrontDesk__nav-btn.is-primary(@click="navigateTo('/booking')") {{ $t('nav.book') }}

  //- ── 頁面內容 ─────────────────────────────────────────────
  main.LayoutFrontDesk__body
    slot

  //- ── 固定底部 Tab Bar ─────────────────────────────────────
  nav.LayoutFrontDesk__bottom
    .LayoutFrontDesk__tab(
      v-for="tab in tabs"
      :key="tab.id"
      :class="{ 'is-active': activeTab === tab.id }"
      @click="navigateTo(tab.path)"
    )
      .LayoutFrontDesk__tab-icon {{ tab.icon }}
      .LayoutFrontDesk__tab-label {{ tab.label }}
      .LayoutFrontDesk__tab-dot(v-if="tab.dot")
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.LayoutFrontDesk {
  min-height: 100svh;
  background: var(--da-off-white);
  color: var(--da-dark);
  -webkit-font-smoothing: antialiased;
}

// ── 加好友橫幅 ─────────────────────────────────────────────
.LayoutFrontDesk__friend-banner {
  position: fixed;
  top: 56px; left: 0; right: 0;
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #06c755;
  color: #fff;
}

.LayoutFrontDesk__banner-text {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 500;
  flex: 1;
}

.LayoutFrontDesk__banner-btn {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 14px;
  border-radius: 100px;
  background: #fff;
  color: #06c755;
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
}

.banner-slide-enter-active,
.banner-slide-leave-active { transition: transform 0.3s ease, opacity 0.3s ease; }
.banner-slide-enter-from,
.banner-slide-leave-to    { transform: translateY(-100%); opacity: 0; }

// ── Auth Loading ───────────────────────────────────────────
.LayoutFrontDesk__loading {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--da-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.LayoutFrontDesk__loading-logo {
  font-family: $font-display;
  font-size: 32px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;

  span { color: var(--da-amber); }
}

.LayoutFrontDesk__loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-fade-leave-active { transition: opacity 0.4s ease; }
.auth-fade-leave-to { opacity: 0; }

// ── 頂部 Nav ───────────────────────────────────────────────
.LayoutFrontDesk__top {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  height: 56px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(250, 248, 244, 0.88);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--da-glass-border);
}

.LayoutFrontDesk__logo {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.08em;
  color: var(--da-dark);
  line-height: 1;
  cursor: pointer;
  user-select: none;

  span { color: var(--da-amber); }
}

.LayoutFrontDesk__nav-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.LayoutFrontDesk__nav-btn {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 7px 14px;
  border-radius: 100px;
  border: 1.5px solid var(--da-dark);
  background: transparent;
  color: var(--da-dark);
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover { opacity: 0.7; }

  &.is-primary {
    background: var(--da-dark);
    color: var(--da-cream);
    border-color: var(--da-dark);
  }
}

// ── 頁面主體 ───────────────────────────────────────────────
.LayoutFrontDesk__body {
  padding-bottom: 80px;
}

// ── 底部 Tab Bar ───────────────────────────────────────────
.LayoutFrontDesk__bottom {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 100;
  height: 64px;
  padding: 0 8px;
  padding-bottom: env(safe-area-inset-bottom, 8px);
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: rgba(250, 248, 244, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid var(--da-glass-border);
}

.LayoutFrontDesk__tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: all 0.2s;
  padding: 6px 10px;
  border-radius: 12px;
  min-width: 52px;
  position: relative;
}

.LayoutFrontDesk__tab-icon {
  font-size: 20px;
  line-height: 1;
  color: var(--da-gray-light);
}

.LayoutFrontDesk__tab-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--da-gray-light);
}

.LayoutFrontDesk__tab.is-active .LayoutFrontDesk__tab-icon,
.LayoutFrontDesk__tab.is-active .LayoutFrontDesk__tab-label {
  color: var(--da-dark);
}

.LayoutFrontDesk__tab-dot {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--da-amber);
  position: absolute;
  top: 6px; right: 8px;
}
</style>
