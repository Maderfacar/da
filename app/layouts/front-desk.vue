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

// hydration mismatch 根治（2026-08-30，見 use-hydration-done.ts）：
// SSR 時 authResolved 恆 false → slot 不渲染；但 client 端 auth plugin 常在 mount 前
// 就把 authResolved 翻 true，讓 hydration 的第一次 render 想畫 slot（Fragment）——
// 對不上 SSR 的註解節點，整個 layout 被重畫。壓到 mounted 後才放行，
// 時序與原本 mismatch 修復重畫相同，使用者無感。
const hydrationDone = UseHydrationDone();
const showContent = computed(
  () => hydrationDone.value && authResolved.value && (!isSignIn.value || rolesLoadState.value === 'ready'),
);

// ── 底部四格 Tab Bar（介面方向提案第二畫面）─────────────
// 2026-08-28 由 Brain AI 拍板加回。b99da52 當初移除的是 5-tab emoji 版
// （含已刪除的 /upcoming），這一版是提案的四格。
// drawer 保留 —— tab 收四個高頻動作，其餘入口仍在 drawer。
//
// ⚠ 2026-08-29 修：第四格原本是「我的」→ `/profile`，**那頁不存在**。
// 乘客個人資料早就併進 `/orders`（見該頁檔頭「原 /orders + /profile 合併」，
// 頭像卡 / 我的旅程 / 客服資訊三個元件都在那裡），CLAUDE.md 的路由表沒跟上。
// 死路由在 LIFF 裡不只是 404，它會被記進 entry-intent 反覆重放成迴圈（見 route-exists.ts）。
// 四格若要各自不同目的地，第四格改成既有的「消息」——它在 drawer 本來就有，且帶未讀紅點。
const TABS = [
  { id: 'home',    path: '/home',          labelKey: 'tab.home',   icon: 'mdi:home-outline' },
  { id: 'booking', path: '/booking',       labelKey: 'tab.book',   icon: 'mdi:car-outline' },
  { id: 'orders',  path: '/orders',        labelKey: 'tab.orders', icon: 'mdi:file-document-outline' },
  { id: 'news',    path: '/notifications', labelKey: 'tab.news',   icon: 'mdi:bell-outline' },
] as const;

// ── 桌機常駐導覽（2026-08-29）───────────────────────────────
// 在此之前，乘客端桌機只有一顆漢堡 —— 導覽藏在抽屜裡、內容貼滿 1440px，
// 整個就是把手機版拉寬。司機端與 admin 早就有常駐導覽（左側欄），只有乘客端沒有。
//
// 桌機把四個高頻動作攤開成水平導覽，再補上抽屜裡剩下的兩個公開入口（車資 / 常見問題）。
// 抽屜其餘項目（客服、服務條款、隱私權）頁尾本來就有，所以桌機不再需要抽屜。
const DESKTOP_NAV = [
  ...TABS,
  { id: 'fare', path: '/fare', labelKey: 'drawer.fare', icon: 'mdi:tag-outline' },
  { id: 'faq',  path: '/faq',  labelKey: 'drawer.faq',  icon: 'mdi:help-circle-outline' },
] as const;

// 作用中分頁：走最長前綴匹配，並先剝掉 i18n 的 /en /ja 前綴
// （prefix_except_default → 英日版路徑會多一段，不剝的話四格永遠沒有 active）。
const _tabRoute = useRoute();
const activeTab = computed(() => {
  const path = _tabRoute.path.replace(/^\/(?:en|ja)(?=\/|$)/, '') || '/';
  const hit = DESKTOP_NAV
    .filter((t) => path === t.path || path.startsWith(`${t.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return hit?.id ?? '';
});

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

// 介面方向提案總則 01：手機頂欄只放「這一頁叫什麼」＋ 未讀 ＋ 頭像。
// 頁名沿用上面 useHead 已經算好的 PASSENGER_TITLE_MAP，不另立第二份清單漂移。
const mobilePageName = computed(() => (_currentTitleKey.value ? _tMeta(_currentTitleKey.value) : ''));

const ClickBell = () => navigateTo('/notifications');

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
    .LayoutFrontDesk__nav-inner
      .LayoutFrontDesk__nav-left
        //- 手機：這一頁叫什麼（提案總則 01）。漢堡已拿掉，抽屜改由右側頭像開。
        h1.LayoutFrontDesk__page-name(v-if="mobilePageName") {{ mobilePageName }}
        //- 桌機：品牌 + 常駐導覽（品牌大字只留給桌機與未登入首頁）
        .LayoutFrontDesk__logo(@click="ClickLogo")
          | DEST
          span ∙
          | ANYWHERE

      //- ── 桌機常駐導覽（≥901px）──────────────────────────
      .LayoutFrontDesk__nav-links
        button.LayoutFrontDesk__nav-link(
          v-for="item in DESKTOP_NAV"
          :key="item.id"
          type="button"
          :class="{ 'is-active': activeTab === item.id }"
          :aria-current="activeTab === item.id ? 'page' : undefined"
          @click="navigateTo(item.path)"
        ) {{ $t(item.labelKey) }}

      .LayoutFrontDesk__nav-right
        //- 未讀：提案總則 01 的第二個元素。點擊直接進消息頁。
        button.LayoutFrontDesk__bell(
          type="button"
          :aria-label="$t('notifications.title')"
          @click="ClickBell"
        )
          NuxtIcon.LayoutFrontDesk__bell-icon(name="mdi:bell-outline")
          span.LayoutFrontDesk__bell-dot(v-if="unreadCount > 0") {{ unreadCount > 9 ? '9+' : unreadCount }}
        LangSwitcher
        //- 依賴 auth state（登入者的 lineProfile 可能在 mount 前就進 store）——
        //- 包 ClientOnly 避免 hydration mismatch，作法對齊 marketing layout
        ClientOnly
          CommonHeaderUser(clickable-avatar @avatar-click="ClickHamburger")

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

  //- ── 底部四格 Tab Bar（介面方向提案第二畫面）─────────────────
  //- 2026-08-28 由 Brain AI 拍板加回（b99da52 當初移除的是 5-tab emoji 版）。
  //- 與 drawer 併存：tab 給四個高頻動作，drawer 給其餘入口。
  //- 只在窄螢幕出現 —— 桌機上滿版底欄會讓網站讀起來像手機 App。
  //- 跑道斜紋帶：頁尾本來就有這條，手機把它壓在底部四格之上（提案裝飾語彙 A）
  .LayoutFrontDesk__tab-stripe
  nav.LayoutFrontDesk__tabs(:aria-label="$t('tab.ariaLabel')")
    button.LayoutFrontDesk__tab(
      v-for="t in TABS"
      :key="t.id"
      type="button"
      :class="{ 'is-active': activeTab === t.id }"
      :aria-current="activeTab === t.id ? 'page' : undefined"
      @click="navigateTo(t.path)"
    )
      NuxtIcon.LayoutFrontDesk__tab-icon(:name="t.icon")
      span.LayoutFrontDesk__tab-label {{ $t(t.labelKey) }}

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
  background: var(--surface-a88);
  border-bottom: 1px solid var(--hairline);
}

/* nav 是滿版底色載體，內容另外收在 --shell 內置中 ——
   否則 1440px 上 logo 貼最左、頭像貼最右，中間一片空。 */
.LayoutFrontDesk__nav-inner {
  height: 100%;
  max-width: var(--shell);
  margin-inline: auto;
  padding-inline: var(--gutter);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

// ── 桌機常駐導覽 ─────────────────────────────────────────
/* 手機不顯示（改走底部四格 + 抽屜），桌機才攤開 */
.LayoutFrontDesk__nav-links {
  display: none;
}

.LayoutFrontDesk__nav-link {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  font-weight: 500;
  letter-spacing: var(--ls-snug);
  color: var(--ink-a70);
  background: none;
  border: 0;
  padding: 0 2px;
  height: 100%;
  cursor: pointer;
  position: relative;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-out);
}

.LayoutFrontDesk__nav-link:hover {
  color: var(--da-dark);
}

/* 作用中：底部古銅細線。不動字重也不動邊框寬度 —— 兩者都會造成 hover / 切換時重排。 */
.LayoutFrontDesk__nav-link::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 2px;
  background: transparent;
  transition: background var(--dur-fast) var(--ease-out);
}

.LayoutFrontDesk__nav-link.is-active {
  color: var(--da-dark);
}

.LayoutFrontDesk__nav-link.is-active::after {
  background: var(--da-amber);
}

/* 手機不顯示品牌大字 —— 提案總則 01：品牌名只出現在未登入的首頁 */
@media (max-width: 900px) {
  .LayoutFrontDesk__logo {
    display: none;
  }
}

@media (min-width: 901px) {
  .LayoutFrontDesk__nav-links {
    display: flex;
    align-items: stretch;
    gap: 28px;
    height: 100%;
  }

  /* 桌機有常駐導覽，「這一頁叫什麼」由導覽的選中態表達，不必再寫一次 */
  .LayoutFrontDesk__page-name {
    display: none;
  }
}

// ── 手機頁名（提案總則 01）───────────────────────────────
.LayoutFrontDesk__page-name {
  font-family: var(--ff-display);
  font-size: var(--fs-h3);
  font-weight: 500;
  letter-spacing: var(--ls-wide);
  color: var(--da-dark);
  line-height: var(--lh-flat);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

// ── 未讀鈴鐺 ─────────────────────────────────────────────
.LayoutFrontDesk__bell {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
  background: none;
  border: 0;
  cursor: pointer;
  color: var(--ink-soft);
  transition: color var(--dur-fast) var(--ease-out);

  &:hover { color: var(--da-dark); }
  &:active { transform: scale(0.94); }
}

.LayoutFrontDesk__bell-icon {
  font-size: var(--fs-h4);
}

/* 未讀用 stop —— 語意四色只標狀態，「有東西還沒看」屬於待處理那一類 */
.LayoutFrontDesk__bell-dot {
  position: absolute;
  top: 6px;
  right: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--r-pill);
  background: var(--stop);
  color: var(--surface-raised);
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-label);
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

// ── 底部四格上方的跑道斜紋（手機才有；桌機那一條在頁尾）──
.LayoutFrontDesk__tab-stripe {
  display: none;
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
  /* 提案「不隨配色改變的規則」第二條：可點的東西一律 --tap。原本 36px。 */
  width: var(--tap);
  height: var(--tap);
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

// ── 底部四格 Tab Bar ─────────────────────────────────────
/* 只在窄螢幕出現：桌機上滿版底欄會讓網站讀起來像手機 App，
   桌機的入口交給 hamburger drawer（b99da52 建立的那套）。 */
.LayoutFrontDesk__tabs {
  display: none;
}

@media (max-width: 900px) {
  /* 內容區讓出「四格 + 斜紋」的高度，否則頁尾最後一列會被蓋住 */
  .LayoutFrontDesk {
    padding-bottom: calc(var(--tabbar-h) + var(--tabbar-stripe));
  }

  /* 5px 品牌記號，壓在四格之上；桌機那一端在頁尾（CommonFooter__stripe），兩端一致 */
  .LayoutFrontDesk__tab-stripe {
    display: block;
    position: fixed;
    left: 0; right: 0;
    bottom: var(--tabbar-h);
    z-index: var(--z-header);
    height: var(--tabbar-stripe);
    background: repeating-linear-gradient(
      -45deg,
      var(--da-stripe-dark) 0 10px,
      var(--da-stripe-yellow) 10px 20px
    );
  }

  .LayoutFrontDesk__tabs {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: var(--z-header);
    display: flex;
    /* 高度與 --tabbar-h 綁死；下緣的安全區留白由 padding 讓出，
       圖示與文字永遠落在 --tabbar-body 那一段裡，不會被手勢列吃到。 */
    height: var(--tabbar-h);
    padding-bottom: var(--tabbar-safe);
    background: var(--da-off-white);
    border-top: 1px solid var(--da-gray-pale);
  }
}

.LayoutFrontDesk__tab {
  flex: 1;
  /* 高度吃滿 --tabbar-body（62px），比 --tap 的 44px 再厚一階 ——
     四格是全站最常按的東西，而且底下就是手機的手勢列，太薄會誤觸。 */
  min-height: var(--tabbar-body);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 0;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--da-gray-light);
  transition: color var(--dur-fast) var(--ease-out);

  &.is-active { color: var(--da-dark); }
}

.LayoutFrontDesk__tab-icon {
  font-size: var(--fs-h4);
  line-height: var(--lh-flat);
}

.LayoutFrontDesk__tab-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  line-height: var(--lh-flat);
}

// 加好友橫幅顯示時下移 40px（banner 高度 = 10px padding × 2 + 20px content）
// 此項與改造前一致
.LayoutFrontDesk__body.has-banner {
  padding-top: 40px;
}
</style>
