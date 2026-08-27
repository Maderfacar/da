<script setup lang="ts">
// LayoutFrontDesk 乘客端佈局
//
// 2026/05/14 改造（Brain AI 拍板）：
//   - 移除底部 5-tab bar
//   - 改 admin 風格 hamburger drawer（CommonDrawer）
//   - 桌機 / 手機行為一致（皆 hamburger 收合，無 sticky 側欄）
//   - logo 點擊回 /home（不在 drawer 列「首頁」）

const authStore = StoreAuth();
const { authResolved, isFriend, isSignIn } = storeToRefs(authStore);
const { lineOaAddUrl } = useRuntimeConfig().public;

// 季節主題：SSR 解析生效主題並注入 [data-da-theme]（FOUC-free；只作用乘客端）
useSiteThemeInject();

// W4：受保護頁兜底（roles 未 load 時顯示骨架，5s timeout 後顯示「載入失敗，請重新登入」）
// layout 為乘客端共用容器，套 guard 即涵蓋 /home /orders 等所有 front-desk page
const { state: rolesLoadState, ClickReLogin } = UseRolesLoadGuard();

// F1 修（2026-07-31）：登入者 roles 未就緒時顯示 spinner，不秀「訪客樣」header 讓人誤判登出。
// - spinner：auth 未解析，或「已登入但 roles 還在載」
// - failed ：已登入但 5s 仍載不到 roles（維持既有重新登入兜底）
// - content：auth 已解析且（訪客／或 roles 已就緒）→ 正常渲染頁面
// 訪客（未登入，如 /login）不受影響，authResolved 後立即渲染。
const showSpinner = computed(
  () => !authResolved.value || (isSignIn.value && rolesLoadState.value === 'loading'),
);
const showRolesFailed = computed(
  () => authResolved.value && isSignIn.value && rolesLoadState.value === 'failed',
);
const showContent = computed(
  () => authResolved.value && (!isSignIn.value || rolesLoadState.value === 'ready'),
);

// ── Meta：分頁標題 + favicon（區隔三端）─────────────────
// 規格：titleTemplate = `{頁名} · {品牌}`；route→key 走最長前綴匹配；
// 兼容 i18n prefix_except_default（剝 /en /ja 前綴）；i18n 三語自動套。
const { t: _tMeta } = useI18n();
const _routeMeta = useRoute();
const PASSENGER_TITLE_MAP: Readonly<Record<string, string>> = {
  '/': 'meta.title.passenger.home',
  '/home': 'meta.title.passenger.home',
  '/booking': 'meta.title.passenger.booking',
  '/orders': 'meta.title.passenger.orders',
  '/fleet': 'meta.title.passenger.fleet',
  '/fare': 'meta.title.passenger.fare',
  '/faq': 'meta.title.passenger.faq',
  '/profile': 'meta.title.passenger.profile',
  '/notifications': 'meta.title.passenger.notifications',
  '/login': 'meta.title.passenger.login',
  '/referral': 'meta.title.passenger.referral',
  '/legal/terms': 'meta.title.passenger.legalTerms',
  '/legal/privacy': 'meta.title.passenger.legalPrivacy',
};
const _stripLocalePrefix = (p: string): string => {
  const m = p.match(/^\/(en|ja)(\/.*)?$/);
  return m ? (m[2] || '/') : p;
};
const _currentTitleKey = computed((): string => {
  const p = _stripLocalePrefix(_routeMeta.path);
  const matched = Object.keys(PASSENGER_TITLE_MAP)
    .sort((a, b) => b.length - a.length)
    .find((k) => p === k || p.startsWith(`${k}/`));
  return matched ? PASSENGER_TITLE_MAP[matched] : '';
});
useHead({
  titleTemplate: (chunk?: string | null): string => {
    const brand = _tMeta('meta.brand.passenger');
    return chunk ? `${chunk} · ${brand}` : brand;
  },
  title: () => (_currentTitleKey.value ? _tMeta(_currentTitleKey.value) : ''),
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicons/passenger.svg' },
  ],
});

const showFriendBanner = computed(
  () => isSignIn.value && isFriend.value === false,
);

const drawerOpen = ref(false);
const ClickHamburger = () => { drawerOpen.value = true; };
const ClickLogo = () => navigateTo('/home');

// ── P37 Phase 5：未讀公告紅點（30s polling + visibility refresh）──
const unreadCount = ref(0);
let unreadTimer: ReturnType<typeof setInterval> | null = null;
const UNREAD_POLL_INTERVAL = 30_000;

const ApiLoadUnread = async () => {
  // 未登入時跳過（避免 401 雜訊）
  if (!isSignIn.value) {
    unreadCount.value = 0;
    return;
  }
  try {
    const res = await $api.GetAnnouncementUnreadCount();
    if (res.status?.code === $enum.apiStatus.success && res.data) {
      unreadCount.value = res.data.unread ?? 0;
    }
  } catch {
    // fire-and-forget；錯誤吞掉，下個輪詢再試
  }
};

const onUnreadVisibility = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') ApiLoadUnread();
};

// 登入狀態改變時立即重撈一次（剛登入 / 登出皆 trigger）
watch(isSignIn, () => { ApiLoadUnread(); });

onMounted(() => {
  ApiLoadUnread();
  unreadTimer = setInterval(ApiLoadUnread, UNREAD_POLL_INTERVAL);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onUnreadVisibility);
});

onUnmounted(() => {
  if (unreadTimer) clearInterval(unreadTimer);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onUnreadVisibility);
});
</script>

<template lang="pug">
.LayoutFrontDesk(data-da-theme)
  ClientOnly
    UiToast

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
  //- Wave 1 P2：hamburger 改放左上，logo 與右側功能區順序不變
  nav.LayoutFrontDesk__top
    .LayoutFrontDesk__nav-left
      //- Hamburger 按鈕（觸發 CommonDrawer）
      button.LayoutFrontDesk__hamburger(
        type="button"
        :aria-label="$t('drawer.ariaOpen')"
        @click="ClickHamburger"
      )
        span.LayoutFrontDesk__hamburger-line
        span.LayoutFrontDesk__hamburger-line
        span.LayoutFrontDesk__hamburger-line
      .LayoutFrontDesk__logo(@click="ClickLogo")
        | DEST
        span ∙
        | ANYWHERE
    .LayoutFrontDesk__nav-right
      LangSwitcher
      CommonHeaderUser

  //- ── 頁面內容 ─────────────────────────────────────────────
  //- 加好友橫幅顯示時整體下移 40px，避免橫幅遮住 Hero / 頁首內容
  //- W2：loading 只遮蓋 main 內容區，nav/hamburger/logo 立即可見
  main.LayoutFrontDesk__body(:class="{ 'has-banner': showFriendBanner }")
    ClientOnly
      transition(name="auth-fade")
        //- F1：auth 未解析 或「已登入但 roles 還在載」→ spinner（不秀訪客樣 header）
        .LayoutFrontDesk__content-loading(v-if="showSpinner")
          .LayoutFrontDesk__loading-spinner
      //- W4：roles lazy load 失敗 5s 後顯示
      .LayoutFrontDesk__roles-failed(v-if="showRolesFailed")
        p.LayoutFrontDesk__roles-failed-msg 載入失敗，請重新登入
        button.LayoutFrontDesk__roles-failed-btn(
          type="button"
          @click="ClickReLogin"
        ) 重新登入
    slot(v-if="showContent")

  //- ── 共用 Footer（含 LINE QR），所有 front-desk 頁面統一顯示 ──
  CommonFooter

  //- ── Drawer ──────────────────────────────────────────────
  ClientOnly
    CommonDrawer(
      v-model="drawerOpen"
      :unread-count="unreadCount"
    )
</template>

<style lang="scss" scoped>

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
  z-index: var(--z-nav);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--line-green);
  color: var(--surface-raised);
}

.LayoutFrontDesk__banner-text {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  font-weight: 500;
  flex: 1;
}

.LayoutFrontDesk__banner-btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 5px 14px;
  border-radius: var(--r-pill);
  background: var(--surface-raised);
  color: var(--line-green);
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
}

.banner-slide-enter-active,
.banner-slide-leave-active { transition: transform var(--dur-slow) var(--ease-out), opacity var(--dur-slow) var(--ease-out); }
.banner-slide-enter-from,
.banner-slide-leave-to    { transform: translateY(-100%); opacity: 0; }

// ── Auth Loading（W2：只遮 main 內容，nav 立即可見） ──────────
.LayoutFrontDesk__content-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100svh - 56px);
}

.LayoutFrontDesk__loading-spinner {
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

// ── W4：roles lazy load 失敗兜底 ───────────────────────────
.LayoutFrontDesk__roles-failed {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  min-height: calc(100svh - 56px);
  padding: 24px;
}

.LayoutFrontDesk__roles-failed-msg {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-lg);
  color: var(--da-gray);
  margin: 0;
}

.LayoutFrontDesk__roles-failed-btn {
  padding: 12px 28px;
  /* 主動作不用金色實心（介面方向提案規則二）：主動作是黑底白字。 */
  background: var(--da-dark);
  color: var(--da-cream);
  border: none;
  border-radius: var(--r-pill);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.96); }
}

// ── 頂部 Nav ───────────────────────────────────────────────
.LayoutFrontDesk__top {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: var(--z-header);
  height: 56px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-a88);
  border-bottom: 1px solid var(--hairline);
}

.LayoutFrontDesk__logo {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-wide);
  color: var(--da-dark);
  line-height: var(--lh-flat);
  cursor: pointer;
  user-select: none;

  span { color: var(--da-amber); }
}

.LayoutFrontDesk__nav-left,
.LayoutFrontDesk__nav-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

// ── Hamburger 按鈕 ────────────────────────────────────────
.LayoutFrontDesk__hamburger {
  width: 36px;
  height: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--ink-a06);
  border-radius: var(--r-md);
  background: var(--surface-a40);
  cursor: pointer;
  padding: 0;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-a72);
    border-color: var(--ink-a12);
  }
  &:active { transform: scale(0.96); }
}

.LayoutFrontDesk__hamburger-line {
  width: 16px;
  height: 1.5px;
  background: var(--da-dark);
  border-radius: var(--r-xs);
}

// ── 頁面主體 ───────────────────────────────────────────────
// 對齊改造前行為：頁面自行處理 padding-top 避開 56px fixed nav
// 底部 tab bar 移除後，padding-bottom 從 80px 改為 0（保留 iOS safe-area）
.LayoutFrontDesk__body {
  padding-bottom: env(safe-area-inset-bottom, 0);
}

// 加好友橫幅顯示時下移 40px（banner 高度 = 10px padding × 2 + 20px content）
// 此項與改造前一致
.LayoutFrontDesk__body.has-banner {
  padding-top: 40px;
}
</style>
