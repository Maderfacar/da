<script setup lang="ts">
// LayoutBackDesk 管理者端佈局：頂部 Bar + 左側抽屜導航

const route = useRoute();
const { authResolved } = StoreAuth();
const drawerOpen = ref(false);

const navItems = [
  { id: 'orders',        icon: '📋', label: '訂單管理',  path: '/admin/orders'        },
  { id: 'war-room',      icon: '🎯', label: '即時戰情',  path: '/admin/war-room'      },
  { id: 'traffic',       icon: '✈️', label: '機場人流',  path: '/admin/traffic'       },
  { id: 'notifications', icon: '🔔', label: '通知管理',  path: '/admin/notifications' },
  { id: 'drivers',       icon: '🚗', label: '司機管理',  path: '/admin/drivers'       },
  { id: 'settings',      icon: '⚙️', label: '系統設定',  path: '/admin/settings'      },
];

const activeNav = computed(() => {
  const p = route.path;
  const match = navItems.find((item) => p.startsWith(item.path));
  return match?.id ?? 'orders';
});

function ClickNav(path: string) {
  navigateTo(path);
  drawerOpen.value = false;
}
</script>

<template lang="pug">
.LayoutBackDesk
  ClientOnly
    UiToast

  //- ── Auth Loading ────────────────────────────────────────
  transition(name="auth-fade")
    .LayoutBackDesk__loading(v-if="!authResolved")
      .LayoutBackDesk__loading-logo
        | DEST
        span ∙
        | ADMIN
      .LayoutBackDesk__loading-spinner

  //- ── 頂部 Bar ─────────────────────────────────────────────
  nav.LayoutBackDesk__top
    button.LayoutBackDesk__hamburger(
      @click="drawerOpen = !drawerOpen"
      :class="{ 'is-open': drawerOpen }"
    )
      span
      span
      span
    .LayoutBackDesk__logo
      | DEST
      span ∙
      | ADMIN
    .LayoutBackDesk__top-right
      span.LayoutBackDesk__admin-badge ADMIN

  //- ── 側邊抽屜 ─────────────────────────────────────────────
  transition(name="drawer")
    .LayoutBackDesk__drawer(v-if="drawerOpen")
      .LayoutBackDesk__drawer-header
        .LayoutBackDesk__drawer-logo
          | DEST
          span ∙
          | ANYWHERE
        p.LayoutBackDesk__drawer-sub 管理者後台
      nav.LayoutBackDesk__drawer-nav
        .LayoutBackDesk__nav-item(
          v-for="item in navItems"
          :key="item.id"
          :class="{ 'is-active': activeNav === item.id }"
          @click="ClickNav(item.path)"
        )
          span.LayoutBackDesk__nav-icon {{ item.icon }}
          span.LayoutBackDesk__nav-label {{ item.label }}
      .LayoutBackDesk__drawer-footer
        button.LayoutBackDesk__signout(@click="StoreAuth().SignOut()") 登出

  //- ── 抽屜遮罩 ─────────────────────────────────────────────
  transition(name="overlay")
    .LayoutBackDesk__overlay(v-if="drawerOpen" @click="drawerOpen = false")

  //- ── 頁面內容 ─────────────────────────────────────────────
  main.LayoutBackDesk__body
    slot
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.LayoutBackDesk {
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
  -webkit-font-smoothing: antialiased;
}

// ── Auth Loading ───────────────────────────────────────────
.LayoutBackDesk__loading {
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

.LayoutBackDesk__loading-logo {
  font-family: $font-display;
  font-size: 32px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;

  span { color: var(--da-amber); }
}

.LayoutBackDesk__loading-spinner {
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

// ── 頂部 Bar ───────────────────────────────────────────────
.LayoutBackDesk__top {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 200;
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--da-dark);
  border-bottom: 1px solid rgba(212, 134, 10, 0.2);
}

.LayoutBackDesk__logo {
  flex: 1;
  font-family: $font-display;
  font-size: 20px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;

  span { color: var(--da-amber); }
}

.LayoutBackDesk__hamburger {
  width: 32px; height: 32px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;

  span {
    display: block;
    height: 2px;
    background: var(--da-cream);
    border-radius: 2px;
    transition: all 0.25s ease;
    transform-origin: center;
  }

  &.is-open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  &.is-open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
  &.is-open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
}

.LayoutBackDesk__top-right { display: flex; align-items: center; }

.LayoutBackDesk__admin-badge {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: var(--da-amber);
  background: rgba(212, 134, 10, 0.15);
  border: 1px solid rgba(212, 134, 10, 0.3);
  padding: 3px 10px;
  border-radius: 100px;
}

// ── 側邊抽屜 ───────────────────────────────────────────────
.LayoutBackDesk__drawer {
  position: fixed;
  top: 0; left: 0;
  z-index: 300;
  width: 280px;
  height: 100svh;
  background: var(--da-dark);
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.LayoutBackDesk__drawer-header {
  padding: 24px 20px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.LayoutBackDesk__drawer-logo {
  font-family: $font-display;
  font-size: 28px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;
  margin-bottom: 4px;

  span { color: var(--da-amber); }
}

.LayoutBackDesk__drawer-sub {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.LayoutBackDesk__drawer-nav {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
}

.LayoutBackDesk__nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 4px;
  border-left: 3px solid transparent;

  &:hover { background: rgba(255, 255, 255, 0.06); }

  &.is-active {
    background: rgba(212, 134, 10, 0.15);
    border-left-color: var(--da-amber);
  }
}

.LayoutBackDesk__nav-icon {
  font-size: 18px;
  line-height: 1;
  width: 24px;
  text-align: center;
}

.LayoutBackDesk__nav-label {
  font-family: $font-body;
  font-size: 15px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
}

.LayoutBackDesk__nav-item.is-active .LayoutBackDesk__nav-label {
  color: var(--da-cream);
}

.LayoutBackDesk__drawer-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.LayoutBackDesk__signout {
  width: 100%;
  padding: 12px;
  background: rgba(238, 81, 81, 0.1);
  border: 1px solid rgba(238, 81, 81, 0.2);
  border-radius: 10px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--err);
  cursor: pointer;
  transition: background 0.2s;

  &:hover { background: rgba(238, 81, 81, 0.18); }
}

// ── 抽屜遮罩 ───────────────────────────────────────────────
.LayoutBackDesk__overlay {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(26, 24, 20, 0.5);
  backdrop-filter: blur(2px);
}

// ── 頁面主體 ───────────────────────────────────────────────
.LayoutBackDesk__body {
  padding-top: 56px;
  min-height: 100svh;
}

// ── 動畫 ──────────────────────────────────────────────────
.drawer-enter-active,
.drawer-leave-active { transition: transform 0.3s ease; }

.drawer-enter-from,
.drawer-leave-to { transform: translateX(-100%); }

.overlay-enter-active,
.overlay-leave-active { transition: opacity 0.3s ease; }

.overlay-enter-from,
.overlay-leave-to { opacity: 0; }
</style>
