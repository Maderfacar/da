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
    .LayoutFrontDesk__logo(@click="ClickLogo")
      | DEST
      span ∙
      | ANYWHERE
    .LayoutFrontDesk__nav-right
      LangSwitcher
      CommonHeaderUser
      //- Hamburger 按鈕（觸發 CommonDrawer）
      button.LayoutFrontDesk__hamburger(
        type="button"
        :aria-label="$t('drawer.ariaOpen')"
        @click="ClickHamburger"
      )
        span.LayoutFrontDesk__hamburger-line
        span.LayoutFrontDesk__hamburger-line
        span.LayoutFrontDesk__hamburger-line

  //- ── 頁面內容 ─────────────────────────────────────────────
  //- 加好友橫幅顯示時整體下移 40px，避免橫幅遮住 Hero / 頁首內容
  main.LayoutFrontDesk__body(:class="{ 'has-banner': showFriendBanner }")
    slot

  //- ── Drawer ──────────────────────────────────────────────
  ClientOnly
    CommonDrawer(
      v-model="drawerOpen"
      :unread-count="unreadCount"
    )
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

// ── Hamburger 按鈕 ────────────────────────────────────────
.LayoutFrontDesk__hamburger {
  width: 36px;
  height: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.7);
    border-color: rgba(0, 0, 0, 0.12);
  }
  &:active { transform: scale(0.96); }
}

.LayoutFrontDesk__hamburger-line {
  width: 16px;
  height: 1.5px;
  background: var(--da-dark);
  border-radius: 1px;
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
