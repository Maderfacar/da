<script setup lang="ts">
// LayoutDriver 司機端佈局：頂部 Nav + 底部 4-Tab Bar
//
// P19：driver 端統一定位機制
// - onMounted 跑授權 flow（getCurrentPosition 觸發 LIFF / 瀏覽器 授權框）
// - 拒絕：blocking modal + 重試按鈕；連續拒絕 2 次或 5 秒沒回應 → navigateTo('/home')
// - 通過：watchPosition 持續監聽 + 5m/60s/accuracy 節流上傳
// - 整 driver 端期間（dashboard/pending/trip/profile）共用同一份 watch state
// - onUnmounted 時 clearWatch 防 leak

const route = useRoute();
const { authResolved } = storeToRefs(StoreAuth());
const driverGeo = useDriverGeolocation();

const tabs = [
  { id: 'dashboard', icon: '🏠', label: '首頁',  path: '/driver/dashboard', dot: false },
  { id: 'pending',   icon: '📋', label: '搶單',  path: '/driver/pending',   dot: true  },
  { id: 'trip',      icon: '✅', label: '任務',  path: '/driver/trip',      dot: false },
  { id: 'profile',   icon: '👤', label: '我的',  path: '/driver/profile',   dot: false },
];

const activeTab = computed(() => {
  const p = route.path;
  if (p.startsWith('/driver/dashboard')) return 'dashboard';
  if (p.startsWith('/driver/pending'))   return 'pending';
  if (p.startsWith('/driver/trip'))      return 'trip';
  if (p.startsWith('/driver/profile'))   return 'profile';
  return 'dashboard';
});

// ── 地理位置授權 flow ─────────────────────────────────────
const showPermissionModal = ref(false);
const permissionDenyCount = ref(0);
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

  // denied / timeout 都視為拒絕
  permissionDenyCount.value++;
  if (permissionDenyCount.value >= 2) {
    // 連續拒絕 2 次 → 強制踢回 /home
    showPermissionModal.value = false;
    navigateTo('/home');
    return;
  }
  showPermissionModal.value = true;
};

const ClickRetryPermission = async () => {
  await _RequestGeoPermissionFlow();
};

const ClickGiveUpPermission = () => {
  showPermissionModal.value = false;
  navigateTo('/home');
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

onUnmounted(() => {
  driverGeo.StopWatch();
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

  //- ── 地理位置授權 Modal（拒絕授權時顯示）──────────────────
  transition(name="auth-fade")
    .LayoutDriver__perm-mask(v-if="showPermissionModal")
      .LayoutDriver__perm-card
        .LayoutDriver__perm-icon 📍
        .LayoutDriver__perm-title 需要位置權限
        .LayoutDriver__perm-body
          | 司機端需要位置權限以執行任務追蹤。
          br
          | 請至 LINE / 瀏覽器設定開啟位置權限後重試。
        .LayoutDriver__perm-actions
          button.LayoutDriver__perm-btn.is-primary(
            :disabled="requestingPermission"
            @click="ClickRetryPermission"
          ) {{ requestingPermission ? '請求中…' : '重試授權' }}
          button.LayoutDriver__perm-btn.is-secondary(@click="ClickGiveUpPermission") 返回首頁

  //- ── 頂部 Nav ─────────────────────────────────────────────
  nav.LayoutDriver__top
    .LayoutDriver__logo
      | DEST
      span ∙
      | DRIVER
    .LayoutDriver__nav-right
      .LayoutDriver__status-dot
      span.LayoutDriver__status-label 待命中
      CommonHeaderUser

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
