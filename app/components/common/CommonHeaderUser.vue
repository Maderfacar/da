<script setup lang="ts">
// CommonHeaderUser 三端 Layout Header 共用：圓形 LINE 頭像 + displayName + 跨端切換鈕
//
// 三條規則（2026/05/07 使用者明確要求）：
//   1. 乘客端（非 /admin 也非 /driver）：roles 含 admin → 顯示 ADMIN 鈕；其餘不顯示跨端鈕
//   2. Admin 端（/admin/*）：永遠顯示 PASSENGER 鈕（無條件）
//   3. 司機端（/driver/*）：不顯示任何跨端按鈕
//
// 頭像不可點擊（純顯示）；無 pictureUrl 時顯示 displayName 第一個字元 fallback。
// 內部直接讀 authStore proxy（不用 storeToRefs），避免 Pinia setup store 解構 computed
// 在某些瀏覽器環境失去 reactivity 的潛在問題。

const route = useRoute();
const authStore = StoreAuth();

const isAdminPath = computed(() => route.path.startsWith('/admin'));
const isDriverPath = computed(() => route.path.startsWith('/driver'));

// 規則 1：乘客端 + admin → ADMIN 鈕
const showAdminBtn = computed(() =>
  !isAdminPath.value && !isDriverPath.value && authStore.roles.includes('admin'),
);

// 規則 2：admin 端 → 永遠顯示 PASSENGER 鈕
const showPassengerBtn = computed(() => isAdminPath.value);

const lineProfile = computed(() => authStore.lineProfile);

const fallbackChar = computed(() => {
  const name = lineProfile.value?.displayName ?? '';
  return name.charAt(0).toUpperCase() || '?';
});

const tooltip = computed(() => lineProfile.value?.displayName ?? '');

const ClickAdmin = () => {
  navigateTo('/admin/orders');
};

const ClickPassenger = () => {
  navigateTo('/home');
};
</script>

<template lang="pug">
.CommonHeaderUser
  button.CommonHeaderUser__admin-btn(
    v-if="showAdminBtn"
    type="button"
    @click="ClickAdmin"
  ) ADMIN

  button.CommonHeaderUser__passenger-btn(
    v-if="showPassengerBtn"
    type="button"
    @click="ClickPassenger"
  ) PASSENGER

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

// ── 跨端切換鈕 ─────────────────────────────────────────────
.CommonHeaderUser__admin-btn,
.CommonHeaderUser__passenger-btn {
  font-family: $font-condensed;
  font-size: $fs-label;
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

.CommonHeaderUser__passenger-btn {
  background: rgba(212, 134, 10, 0.14);
  color: var(--da-cream);
  border: 1px solid rgba(212, 134, 10, 0.4);
  &:hover { background: rgba(212, 134, 10, 0.24); }
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
