<script setup lang="ts">
// CommonHeaderUser 三端 Layout Header 共用：圓形 LINE 頭像 + displayName + 後台切換鈕
//
// - 頭像不可點擊（無連結，純顯示）— 點擊跳轉由各端 Tab Bar 上的「我的」按鈕處理
// - 若 roles 包含 'admin' 且當前不在 /admin 路徑下，顯示 ADMIN 跳轉鈕
// - 若 isApprovedDriver 且當前不在 /driver 路徑下，顯示 DRIVER 跳轉鈕
// - 無 pictureUrl 時顯示 displayName 第一個字元的灰底 fallback
//
// 內部直接讀 authStore proxy（不用 storeToRefs），避免 Pinia setup store
// 解構 computed 在某些瀏覽器環境失去 reactivity 的潛在問題。

const route = useRoute();
const authStore = StoreAuth();

const showAdminBtn = computed(() =>
  authStore.roles.includes('admin') && !route.path.startsWith('/admin'),
);

const showDriverBtn = computed(() =>
  authStore.roles.includes('driver') && authStore.approved && !route.path.startsWith('/driver'),
);

const lineProfile = computed(() => authStore.lineProfile);

const fallbackChar = computed(() => {
  const name = lineProfile.value?.displayName ?? '';
  return name.charAt(0).toUpperCase() || '?';
});

const tooltip = computed(() => lineProfile.value?.displayName ?? '');

const ClickAdmin = () => {
  navigateTo('/admin/orders');
};

const ClickDriver = () => {
  navigateTo('/driver/dashboard');
};
</script>

<template lang="pug">
.CommonHeaderUser
  button.CommonHeaderUser__admin-btn(
    v-if="showAdminBtn"
    type="button"
    @click="ClickAdmin"
  ) ADMIN

  button.CommonHeaderUser__driver-btn(
    v-if="showDriverBtn"
    type="button"
    @click="ClickDriver"
  ) DRIVER

  .CommonHeaderUser__avatar-wrap(:title="tooltip")
    img.CommonHeaderUser__avatar(
      v-if="lineProfile?.pictureUrl"
      :src="lineProfile.pictureUrl"
      :alt="lineProfile.displayName"
      referrerpolicy="no-referrer"
    )
    .CommonHeaderUser__avatar-fallback(v-else) {{ fallbackChar }}

  span.CommonHeaderUser__name(v-if="lineProfile?.displayName") {{ lineProfile.displayName }}
</template>

<style lang="scss" scoped>
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.CommonHeaderUser {
  display: flex;
  align-items: center;
  gap: 8px;
}

// ── ADMIN / DRIVER 跳轉鈕 ──────────────────────────────────
.CommonHeaderUser__admin-btn,
.CommonHeaderUser__driver-btn {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  padding: 5px 12px;
  border-radius: 100px;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  white-space: nowrap;

  &:active { transform: scale(0.96); }
}

.CommonHeaderUser__admin-btn {
  background: rgba(238, 81, 81, 0.18);
  color: var(--da-amber);
  border: 1px solid rgba(212, 134, 10, 0.35);
  &:hover { background: rgba(238, 81, 81, 0.28); }
}

.CommonHeaderUser__driver-btn {
  background: rgba(80, 200, 120, 0.16);
  color: #4ade80;
  border: 1px solid rgba(80, 200, 120, 0.35);
  &:hover { background: rgba(80, 200, 120, 0.26); }
}

// ── 頭像（純顯示，不可點擊） ─────────────────────────────
.CommonHeaderUser__avatar-wrap {
  width: clamp(28px, 8vw, 36px);
  height: clamp(28px, 8vw, 36px);
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: transparent;
}

.CommonHeaderUser__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.CommonHeaderUser__avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(212, 134, 10, 0.18);
  color: var(--da-amber);
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0;
}

// ── 名稱（窄螢幕隱藏，節省 header 空間） ──────────────────
.CommonHeaderUser__name {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 500;
  color: inherit;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 767px) {
  .CommonHeaderUser__name { display: none; }
}
</style>
