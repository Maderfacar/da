<script setup lang="ts">
// LayoutDriver 司機端佈局：頂部 Nav + 底部 4-Tab Bar

const route = useRoute();
const { authResolved } = StoreAuth();

const tabs = [
  { id: 'dashboard', icon: '🏠', label: '首頁',  path: '/driver/dashboard', dot: false },
  { id: 'pending',   icon: '📋', label: '搶單',  path: '/driver/pending',   dot: true  },
  { id: 'trip',      icon: '✅', label: '任務',  path: '/driver/trip',      dot: false },
  { id: 'profile',   icon: '👤', label: '我的',  path: '/profile',          dot: false },
];

const activeTab = computed(() => {
  const p = route.path;
  if (p.startsWith('/driver/dashboard')) return 'dashboard';
  if (p.startsWith('/driver/pending'))   return 'pending';
  if (p.startsWith('/driver/trip'))      return 'trip';
  if (p.startsWith('/profile'))          return 'profile';
  return 'dashboard';
});
</script>

<template lang="pug">
.LayoutDriver
  ClientOnly
    UiToast

  //- ── Auth Loading ────────────────────────────────────────
  transition(name="auth-fade")
    .LayoutDriver__loading(v-if="!authResolved")
      .LayoutDriver__loading-logo
        | DEST
        span ∙
        | DRIVER
      .LayoutDriver__loading-spinner

  //- ── 頂部 Nav ─────────────────────────────────────────────
  nav.LayoutDriver__top
    .LayoutDriver__logo
      | DEST
      span ∙
      | DRIVER
    .LayoutDriver__nav-right
      .LayoutDriver__status-dot
      span.LayoutDriver__status-label 待命中

  //- ── 頁面內容 ─────────────────────────────────────────────
  main.LayoutDriver__body
    slot

  //- ── 底部 Tab Bar ─────────────────────────────────────────
  nav.LayoutDriver__bottom
    .LayoutDriver__tab(
      v-for="tab in tabs"
      :key="tab.id"
      :class="{ 'is-active': activeTab === tab.id }"
      @click="navigateTo(tab.path)"
    )
      .LayoutDriver__tab-icon {{ tab.icon }}
      .LayoutDriver__tab-label {{ tab.label }}
      .LayoutDriver__tab-dot(v-if="tab.dot")
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.LayoutDriver {
  min-height: 100svh;
  background: var(--da-off-white);
  color: var(--da-dark);
  -webkit-font-smoothing: antialiased;
}

// ── Auth Loading ───────────────────────────────────────────
.LayoutDriver__loading {
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

.LayoutDriver__loading-logo {
  font-family: $font-display;
  font-size: 32px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;

  span { color: var(--da-amber); }
}

.LayoutDriver__loading-spinner {
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
.LayoutDriver__top {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  height: 56px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(26, 24, 20, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(212, 134, 10, 0.2);
}

.LayoutDriver__logo {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;

  span { color: var(--da-amber); }
}

.LayoutDriver__nav-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.LayoutDriver__status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
}

.LayoutDriver__status-label {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.6);
}

// ── 頁面主體 ───────────────────────────────────────────────
.LayoutDriver__body {
  padding-top: 56px;
  padding-bottom: 80px;
}

// ── 底部 Tab Bar ───────────────────────────────────────────
.LayoutDriver__bottom {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 100;
  height: 64px;
  padding: 0 8px;
  padding-bottom: env(safe-area-inset-bottom, 8px);
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: rgba(26, 24, 20, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid rgba(212, 134, 10, 0.15);
}

.LayoutDriver__tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: all 0.2s;
  padding: 6px 10px;
  border-radius: 12px;
  min-width: 60px;
  position: relative;
}

.LayoutDriver__tab-icon {
  font-size: 20px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.3);
}

.LayoutDriver__tab-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.3);
}

.LayoutDriver__tab.is-active .LayoutDriver__tab-icon,
.LayoutDriver__tab.is-active .LayoutDriver__tab-label {
  color: var(--da-amber-light);
}

.LayoutDriver__tab-dot {
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--da-amber);
  position: absolute;
  top: 6px; right: 8px;
}
</style>
