<script setup lang="ts">
// LayoutBackDesk 管理者端佈局：頂部 Bar + 左側抽屜導航

const route = useRoute();
const { authResolved, isSuper } = storeToRefs(StoreAuth());
const drawerOpen = ref(false);

// ── Meta：分頁標題 + favicon（區隔三端）─────────────────
// 規格：titleTemplate = `{頁名} · DA 後台`；i18n 三語自動套。
const { t: _tMeta } = useI18n();
const ADMIN_TITLE_MAP: Readonly<Record<string, string>> = {
  '/admin': 'meta.title.admin.dashboard',
  '/admin/dashboard': 'meta.title.admin.dashboard',
  '/admin/orders': 'meta.title.admin.orders',
  '/admin/war-room': 'meta.title.admin.warRoom',
  '/admin/traffic': 'meta.title.admin.traffic',
  '/admin/notifications': 'meta.title.admin.notifications',
  '/admin/line-management': 'meta.title.admin.lineManagement',
  '/admin/drivers': 'meta.title.admin.drivers',
  '/admin/users': 'meta.title.admin.users',
  '/admin/referral': 'meta.title.admin.referral',
  '/admin/settings': 'meta.title.admin.settings',
  '/admin/audit-logs': 'meta.title.admin.auditLogs',
};
const _stripLocalePrefix = (p: string): string => {
  const m = p.match(/^\/(en|ja)(\/.*)?$/);
  return m ? (m[2] || '/') : p;
};
const _currentTitleKey = computed((): string => {
  const p = _stripLocalePrefix(route.path);
  const matched = Object.keys(ADMIN_TITLE_MAP)
    .sort((a, b) => b.length - a.length)
    .find((k) => p === k || p.startsWith(`${k}/`));
  return matched ? ADMIN_TITLE_MAP[matched] : '';
});
useHead({
  titleTemplate: (chunk?: string | null): string => {
    const brand = _tMeta('meta.brand.admin');
    return chunk ? `${chunk} · ${brand}` : brand;
  },
  title: () => (_currentTitleKey.value ? _tMeta(_currentTitleKey.value) : ''),
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicons/admin.svg' },
  ],
});

// 桌機（≥ 768px）首屏自動展開 sidebar，但 hamburger 永遠可 toggle
onMounted(() => {
  if (window.innerWidth >= 768) drawerOpen.value = true;
});

interface NavItem {
  id: string;
  icon: string;
  label: string;
  path: string;
  superOnly?: boolean;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'orders',          icon: '📋', label: '訂單管理',  path: '/admin/orders'          },
  { id: 'war-room',        icon: '🎯', label: '即時戰情',  path: '/admin/war-room'        },
  { id: 'traffic',         icon: '✈️', label: '機場人流',  path: '/admin/traffic'         },
  { id: 'notifications',   icon: '🔔', label: '通知管理',  path: '/admin/notifications'   },
  { id: 'line-management', icon: '💬', label: 'LINE OA 管理', path: '/admin/line-management' },
  { id: 'drivers',         icon: '🚗', label: '司機管理',  path: '/admin/drivers'         },
  { id: 'users',           icon: '👥', label: '乘客管理',  path: '/admin/users'           },
  { id: 'referral',        icon: '🎁', label: '推薦獎勵',  path: '/admin/referral'        },
  { id: 'settings',        icon: '⚙️', label: '系統設定',  path: '/admin/settings'        },
  // P25-2：操作日誌僅 super 可見
  { id: 'audit-logs',      icon: '📜', label: '操作日誌',  path: '/admin/audit-logs', superOnly: true },
];

const navItems = computed(() => ALL_NAV_ITEMS.filter((i) => !i.superOnly || isSuper.value));

const activeNav = computed(() => {
  const p = route.path;
  const match = navItems.value.find((item) => p.startsWith(item.path));
  return match?.id ?? 'orders';
});

function ClickNav(path: string) {
  navigateTo(path);
  drawerOpen.value = false;
}
</script>

<template lang="pug">
//- ⚠ data-surface='dark' 刻意**不**標在這個根節點上。
//-    admin 是 7 深 7 淺混用：orders/settings/users/drivers/notifications/traffic/war-room 是深色頁，
//-    dashboard/audit-logs/referral/line-management/fare-sandbox/pin/drivers[uid] 是淺色頁。
//-    標在根節點會讓那 7 個淺色頁也拿到深底用的亮銅 #C9A961，於骨白只有 1.82:1。
//-    正確做法是標在「真正是深色表面」的節點：下方三處 chrome + 各深色頁自己的根節點。
.LayoutBackDesk
  ClientOnly
    UiToast

  //- ── Auth Loading ────────────────────────────────────────
  transition(name="auth-fade")
    .LayoutBackDesk__loading(v-if="!authResolved" data-surface='dark')
      .LayoutBackDesk__loading-logo
        | DEST
        span ∙
        | ADMIN
      .LayoutBackDesk__loading-spinner

  //- ── 頂部 Bar ─────────────────────────────────────────────
  nav.LayoutBackDesk__top(data-surface='dark')
    button.LayoutBackDesk__hamburger(
      @click="drawerOpen = !drawerOpen"
      :class="{ 'is-open': drawerOpen }"
      aria-label="切換選單"
    )
      span
      span
      span
    NuxtLink.LayoutBackDesk__logo(to="/admin/dashboard")
      | DEST
      span ∙
      | ADMIN
    .LayoutBackDesk__top-right
      span.LayoutBackDesk__admin-badge ADMIN
      CommonHeaderUser

  //- ── 側邊抽屜（手機 overlay / 桌機常駐）────────────────────
  aside.LayoutBackDesk__drawer(data-surface='dark' :class="{ 'is-open': drawerOpen }")
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

  //- ── 抽屜遮罩（僅手機）─────────────────────────────────────
  .LayoutBackDesk__overlay(
    :class="{ 'is-open': drawerOpen }"
    @click="drawerOpen = false"
  )

  //- ── 頁面內容 ─────────────────────────────────────────────
  main.LayoutBackDesk__body
    slot

  //- ── W2：敏感操作 PIN 提示彈窗（singleton；UseAskForPin 驅動 visible） ───
  ClientOnly
    OpenDialogAdminPinPrompt
</template>

<style lang="scss" scoped>

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
  z-index: var(--z-boot);
  background: var(--da-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.LayoutBackDesk__loading-logo {
  font-family: var(--ff-display);
  font-size: var(--fs-h1);
  letter-spacing: var(--ls-wide);
  color: var(--da-cream);
  line-height: var(--lh-flat);

  span { color: var(--da-amber); }
}

.LayoutBackDesk__loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--da-amber);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-fade-leave-active { transition: opacity var(--dur-slower) var(--ease-out); }
.auth-fade-leave-to { opacity: 0; }

// ── 頂部 Bar ───────────────────────────────────────────────
.LayoutBackDesk__top {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: var(--z-header);
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--da-dark);
  border-bottom: 1px solid var(--accent-a20);
}

.LayoutBackDesk__logo {
  flex: 1;
  min-width: 0;
  font-family: var(--ff-display);
  font-size: var(--fs-h3);
  letter-spacing: var(--ls-wide);
  color: var(--da-cream);
  line-height: var(--lh-flat);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  span { color: var(--da-amber); }

  &:hover { opacity: 0.8; }
}

.LayoutBackDesk__hamburger {
  width: 32px; height: 32px;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
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
    width: 100%;
    height: 2px;
    background: var(--da-cream);
    border-radius: var(--r-xs);
    transition: all var(--dur-base) var(--ease-out);
    transform-origin: center;
  }

  &.is-open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  &.is-open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
  &.is-open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
}

.LayoutBackDesk__top-right { display: flex; align-items: center; gap: 8px; }

.LayoutBackDesk__admin-badge {
  font-family: var(--ff-label);
  font-size: $fs-label;
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  color: var(--accent-text);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a30);
  padding: 3px 10px;
  border-radius: var(--r-pill);
}

// ── 側邊抽屜 ───────────────────────────────────────────────
.LayoutBackDesk__drawer {
  position: fixed;
  top: 0; left: 0;
  z-index: var(--z-drawer);
  width: 280px;
  height: 100svh;
  background: var(--da-dark);
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  transform: translateX(-100%);
  transition: transform var(--dur-slow) var(--ease-out);

  &.is-open { transform: translateX(0); }
}

.LayoutBackDesk__drawer-header {
  padding: 24px 20px 20px;
  border-bottom: 1px solid var(--surface-a06);
}

.LayoutBackDesk__drawer-logo {
  font-family: var(--ff-display);
  /* ⚠ 刻意用 --fs-h2 而不是 --fs-h1：側欄寬 280px、左右各 20px padding，
     可用寬度只有 240px，而字標「DEST·ANYWHERE」還帶 0.08em 字距。
     原本 28px 就已經貼著邊，字級階梯吸到 32px 之後直接被切掉 —— 視覺基線抓到的。 */
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-wide);
  color: var(--da-cream);
  line-height: var(--lh-flat);
  margin-bottom: 4px;

  span { color: var(--da-amber); }
}

.LayoutBackDesk__drawer-sub {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--surface-a30);
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
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
  margin-bottom: 4px;
  border-left: 3px solid transparent;

  &:hover { background: var(--surface-a06); }

  &.is-active {
    background: var(--accent-a12);
    border-left-color: var(--da-amber);
  }
}

.LayoutBackDesk__nav-icon {
  font-size: var(--fs-h4);
  line-height: var(--lh-flat);
  width: 24px;
  text-align: center;
}

.LayoutBackDesk__nav-label {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--surface-a60);
}

.LayoutBackDesk__nav-item.is-active .LayoutBackDesk__nav-label {
  color: var(--da-cream);
}

.LayoutBackDesk__drawer-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--surface-a06);
}

.LayoutBackDesk__signout {
  width: 100%;
  padding: 12px;
  background: var(--stop-a08);
  border: 1px solid var(--stop-a15);
  border-radius: var(--r-md);
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--danger);
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out);

  &:hover { background: var(--stop-a15); }
}

// ── 抽屜遮罩 ───────────────────────────────────────────────
.LayoutBackDesk__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: var(--ink-a50);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--dur-slow) var(--ease-out), visibility var(--dur-slow) var(--ease-out);

  &.is-open {
    opacity: 1;
    visibility: visible;
  }
}

// ── 頁面主體 ───────────────────────────────────────────────
.LayoutBackDesk__body {
  padding-top: 56px;
  min-height: 100svh;
}

// ── 桌機 ≥ 768px：drawer 開時 push 模式（main 縮邊不被遮罩擋），drawer 關時 main 滿版 ──
// hamburger 永遠保留可 toggle（無論桌機/手機）
@media (min-width: 768px) {
  .LayoutBackDesk__drawer {
    z-index: var(--z-nav);
    border-right: 1px solid var(--surface-a06);
  }

  // 桌機 drawer 開啟時不顯示 overlay（避免擋主畫面）
  .LayoutBackDesk__overlay {
    display: none;
  }

  // drawer 開啟時 top bar + main 讓出 280px 空間（push 模式，不會被覆蓋）
  // 用 :has() 偵測同層 drawer.is-open；現代瀏覽器（Chrome 105+ / Safari 15.4+）皆支援
  .LayoutBackDesk:has(.LayoutBackDesk__drawer.is-open) {
    .LayoutBackDesk__top  { left: 280px; }
    .LayoutBackDesk__body { padding-left: 280px; }
  }

  // 平滑過渡
  .LayoutBackDesk__top,
  .LayoutBackDesk__body {
    transition: left var(--dur-slow) var(--ease-out), padding-left var(--dur-slow) var(--ease-out);
  }
}
</style>
