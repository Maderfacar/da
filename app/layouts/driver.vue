<script setup lang="ts">
// LayoutDriver 司機端佈局：頂部 Bar + 左側抽屜導航（與 admin 同款）
//
// P19：driver 端統一定位機制（C 方案嚴格模式）
// - onMounted 跑授權 flow（getCurrentPosition 觸發 LIFF / 瀏覽器 授權框）
// - 拒絕：blocking modal 持續顯示 + 重試按鈕；**不可關閉、不導出 driver 端**
//   （war-room 需要實時抓所有 driver GPS，沒授權 = 司機無法使用 driver 端）
// - 通過：watchPosition 持續監聽 + 5m/60s/accuracy 節流上傳
// - 整 driver 端期間（dashboard/trip/profile/traffic）共用同一份 watch state
// - onUnmounted 時 clearWatch 防 leak

const route = useRoute();
const { authResolved } = storeToRefs(StoreAuth());
const driverGeo = useDriverGeolocation();
const drawerOpen = ref(false);

// ── Meta：分頁標題 + favicon（區隔三端）─────────────────
// 規格：titleTemplate = `{頁名} · DA 司機端`；i18n 三語自動套。
const { t: _tMeta } = useI18n();
const DRIVER_TITLE_MAP: Readonly<Record<string, string>> = {
  '/driver/auth': 'meta.title.driver.auth',
  '/driver/register': 'meta.title.driver.register',
  '/driver/dashboard': 'meta.title.driver.dashboard',
  '/driver/cost': 'meta.title.driver.cost',
  '/driver/dispatched': 'meta.title.driver.dispatched',
  '/driver/trip': 'meta.title.driver.trip',
  '/driver/traffic': 'meta.title.driver.traffic',
  '/driver/announcements': 'meta.title.driver.announcements',
  '/driver/profile': 'meta.title.driver.profile',
};
const _stripLocalePrefix = (p: string): string => {
  const m = p.match(/^\/(en|ja)(\/.*)?$/);
  return m ? (m[2] || '/') : p;
};
const _currentTitleKey = computed((): string => {
  const p = _stripLocalePrefix(route.path);
  const matched = Object.keys(DRIVER_TITLE_MAP)
    .sort((a, b) => b.length - a.length)
    .find((k) => p === k || p.startsWith(`${k}/`));
  return matched ? DRIVER_TITLE_MAP[matched] : '';
});
useHead({
  titleTemplate: (chunk?: string | null): string => {
    const brand = _tMeta('meta.brand.driver');
    return chunk ? `${chunk} · ${brand}` : brand;
  },
  title: () => (_currentTitleKey.value ? _tMeta(_currentTitleKey.value) : ''),
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicons/driver.svg' },
  ],
});

// 桌機（≥ 768px）首屏自動展開 sidebar，但 hamburger 永遠可 toggle
onMounted(() => {
  if (window.innerWidth >= 768) drawerOpen.value = true;
});

const navItems = [
  { id: 'cost',          icon: '💰', label: '營運成本', path: '/driver/cost'          },
  { id: 'dispatched',    icon: '📦', label: '接單看板', path: '/driver/dispatched'    },
  { id: 'trip',          icon: '✅', label: '任務',     path: '/driver/trip'          },
  { id: 'traffic',       icon: '✈️', label: '機場人流', path: '/driver/traffic'       },
  { id: 'announcements', icon: '📣', label: '公告欄',   path: '/driver/announcements' },
  { id: 'profile',       icon: '👤', label: '個人資料', path: '/driver/profile'       },
];

const activeNav = computed(() => {
  const p = route.path;
  const match = navItems.find((item) => p.startsWith(item.path));
  return match?.id ?? '';
});

function ClickNav(path: string) {
  navigateTo(path);
  drawerOpen.value = false;
}

// ── 地理位置授權 flow（C 方案嚴格模式）────────────────────
// 司機未授權 GPS → blocking modal 持續顯示，不可關閉、不導出 driver 端。
// 唯一出路：開啟瀏覽器/LINE 位置權限後點「重試授權」。
const showPermissionModal = ref(false);
const requestingPermission = ref(false);

const _RequestGeoPermissionFlow = async () => {
  if (requestingPermission.value) return;
  requestingPermission.value = true;
  const result = await driverGeo.RequestPermission();
  requestingPermission.value = false;

  if (result === 'granted') {
    showPermissionModal.value = false;
    driverGeo.StartWatch();
    return;
  }

  // denied / timeout：blocking modal 持續顯示，不導出
  showPermissionModal.value = true;
};

const ClickRetryPermission = async () => {
  await _RequestGeoPermissionFlow();
};

onMounted(() => {
  // 等 auth resolved 後再啟動，避免在 layout mount 與 auth init 競態
  if (authResolved.value) {
    _RequestGeoPermissionFlow();
  } else {
    const stop = watch(authResolved, (v) => {
      if (v) {
        stop();
        _RequestGeoPermissionFlow();
      }
    });
  }
});

// ── 公告欄未讀紅點（30s polling + visibility refresh） ─────
const announcementUnread = ref(0);
let announcementPollTimer: ReturnType<typeof setInterval> | null = null;
const ANNOUNCEMENT_POLL_INTERVAL = 30_000;

const ApiLoadAnnouncementUnread = async () => {
  try {
    const res = await $api.GetDriverAnnouncementUnreadCount();
    if (res.status?.code === $enum.apiStatus.success && res.data) {
      announcementUnread.value = res.data.unread ?? 0;
    }
  } catch {
    // fire-and-forget；下個輪詢再試
  }
};

const onAnnouncementVisibility = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    ApiLoadAnnouncementUnread();
  }
};

onMounted(() => {
  ApiLoadAnnouncementUnread();
  announcementPollTimer = setInterval(ApiLoadAnnouncementUnread, ANNOUNCEMENT_POLL_INTERVAL);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onAnnouncementVisibility);
  }
});

// 進入公告欄 / 公告詳情後，回頭立即刷新紅點（不必等下個 polling tick）
watch(() => route.path, (p) => {
  if (p.startsWith('/driver/announcements')) ApiLoadAnnouncementUnread();
});

onUnmounted(() => {
  driverGeo.StopWatch();
  if (announcementPollTimer) clearInterval(announcementPollTimer);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onAnnouncementVisibility);
  }
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

  //- ── 地理位置授權 Modal（C 方案嚴格 — 不可關閉，無「返回首頁」出路）──
  transition(name="auth-fade")
    .LayoutDriver__perm-mask(v-if="showPermissionModal")
      .LayoutDriver__perm-card
        .LayoutDriver__perm-icon 📍
        .LayoutDriver__perm-title 需要位置權限
        .LayoutDriver__perm-body
          | 司機端必須開啟位置權限才能使用。
          br
          | 派遣中心需要實時追蹤您的位置以執行任務。
          br
          br
          | 請至 LINE / 瀏覽器設定開啟位置權限後點「重試授權」。
        .LayoutDriver__perm-actions
          button.LayoutDriver__perm-btn.is-primary(
            :disabled="requestingPermission"
            @click="ClickRetryPermission"
          ) {{ requestingPermission ? '請求中…' : '重試授權' }}

  //- ── 頂部 Bar ─────────────────────────────────────────────
  nav.LayoutDriver__top
    button.LayoutDriver__hamburger(
      @click="drawerOpen = !drawerOpen"
      :class="{ 'is-open': drawerOpen }"
      aria-label="切換選單"
    )
      span
      span
      span
    NuxtLink.LayoutDriver__logo(to="/driver/dashboard")
      | DEST
      span ∙
      | DRIVER
    .LayoutDriver__top-right
      .LayoutDriver__status-dot
      span.LayoutDriver__status-label 待命中
      CommonHeaderUser

  //- ── 側邊抽屜（手機 overlay / 桌機常駐）────────────────────
  aside.LayoutDriver__drawer(:class="{ 'is-open': drawerOpen }")
    .LayoutDriver__drawer-header
      .LayoutDriver__drawer-logo
        | DEST
        span ∙
        | DRIVER
      p.LayoutDriver__drawer-sub 司機端
    nav.LayoutDriver__drawer-nav
      .LayoutDriver__nav-item(
        v-for="item in navItems"
        :key="item.id"
        :class="{ 'is-active': activeNav === item.id }"
        @click="ClickNav(item.path)"
      )
        span.LayoutDriver__nav-icon {{ item.icon }}
        span.LayoutDriver__nav-label {{ item.label }}
        //- 公告欄未讀紅點 badge
        span.LayoutDriver__nav-badge(
          v-if="item.id === 'announcements' && announcementUnread > 0"
        ) {{ announcementUnread > 99 ? '99+' : announcementUnread }}
    //- driver 端不提供登出入口（司機關閉頁面即可；war-room 仍掌握定位）

  //- ── 抽屜遮罩（僅手機）─────────────────────────────────────
  .LayoutDriver__overlay(
    :class="{ 'is-open': drawerOpen }"
    @click="drawerOpen = false"
  )

  //- ── 頁面內容 ─────────────────────────────────────────────
  main.LayoutDriver__body
    slot
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

// ── 地理位置授權 Modal ─────────────────────────────────────
.LayoutDriver__perm-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(15, 17, 21, 0.92);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.LayoutDriver__perm-card {
  max-width: 360px;
  width: 100%;
  background: #1a1a2e;
  border: 1px solid rgba(212, 134, 10, 0.3);
  border-radius: 18px;
  padding: 28px 24px;
  text-align: center;
  color: #fff;
}

.LayoutDriver__perm-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.LayoutDriver__perm-title {
  font-family: $font-display;
  font-size: 24px;
  letter-spacing: 0.04em;
  color: var(--da-amber-light, #f7b96a);
  margin-bottom: 12px;
}

.LayoutDriver__perm-body {
  font-family: $font-body;
  font-size: 14px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 24px;
}

.LayoutDriver__perm-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.LayoutDriver__perm-btn {
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 12px 20px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.6; cursor: not-allowed; }

  &.is-primary {
    background: var(--da-amber);
    color: #fff;
    &:active:not(:disabled) { transform: scale(0.98); }
  }

  &.is-secondary {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.6);
  }
}

// ── 頂部 Bar ───────────────────────────────────────────────
.LayoutDriver__top {
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

.LayoutDriver__hamburger {
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
    border-radius: 2px;
    transition: all 0.25s ease;
    transform-origin: center;
  }

  &.is-open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  &.is-open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
  &.is-open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
}

.LayoutDriver__logo {
  flex: 1;
  min-width: 0;
  font-family: $font-display;
  font-size: 20px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  span { color: var(--da-amber); }

  &:hover { opacity: 0.8; }
}

.LayoutDriver__top-right {
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
  white-space: nowrap;
}

// 窄螢幕（< 768px）隱藏「待命中」文字，僅留綠點，避免擠掉 hamburger / logo
@media (max-width: 767px) {
  .LayoutDriver__status-label { display: none; }
}

// ── 側邊抽屜 ───────────────────────────────────────────────
.LayoutDriver__drawer {
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
  transform: translateX(-100%);
  transition: transform 0.3s ease;

  &.is-open { transform: translateX(0); }
}

.LayoutDriver__drawer-header {
  padding: 24px 20px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.LayoutDriver__drawer-logo {
  font-family: $font-display;
  font-size: 28px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;
  margin-bottom: 4px;

  span { color: var(--da-amber); }
}

.LayoutDriver__drawer-sub {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.LayoutDriver__drawer-nav {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
}

.LayoutDriver__nav-item {
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

.LayoutDriver__nav-icon {
  font-size: 18px;
  line-height: 1;
  width: 24px;
  text-align: center;
}

.LayoutDriver__nav-label {
  font-family: $font-body;
  font-size: 15px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
}

.LayoutDriver__nav-item.is-active .LayoutDriver__nav-label {
  color: var(--da-cream);
}

.LayoutDriver__nav-badge {
  margin-left: auto;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #f87171;
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

// ── 抽屜遮罩 ───────────────────────────────────────────────
.LayoutDriver__overlay {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(26, 24, 20, 0.5);
  backdrop-filter: blur(2px);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0.3s ease;

  &.is-open {
    opacity: 1;
    visibility: visible;
  }
}

// ── 頁面主體 ───────────────────────────────────────────────
.LayoutDriver__body {
  padding-top: 56px;
  min-height: 100svh;
}

// ── 桌機 ≥ 768px：drawer 開時 push 模式（main 縮邊不被遮罩擋），drawer 關時 main 滿版 ──
// hamburger 永遠保留可 toggle（無論桌機/手機）
@media (min-width: 768px) {
  .LayoutDriver__drawer {
    z-index: 150;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }

  // 桌機 drawer 開啟時不顯示 overlay（避免擋主畫面）
  .LayoutDriver__overlay {
    display: none;
  }

  // drawer 開啟時 top bar + main 讓出 280px 空間（push 模式，不會被覆蓋）
  // 用 :has() 偵測同層 drawer.is-open；現代瀏覽器（Chrome 105+ / Safari 15.4+）皆支援
  .LayoutDriver:has(.LayoutDriver__drawer.is-open) {
    .LayoutDriver__top  { left: 280px; }
    .LayoutDriver__body { padding-left: 280px; }
  }

  // 平滑過渡
  .LayoutDriver__top,
  .LayoutDriver__body {
    transition: left 0.3s ease, padding-left 0.3s ease;
  }
}
</style>
