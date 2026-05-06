<script setup lang="ts">
// CommonHeaderUser 三端 Layout Header 共用：圓形 LINE 頭像 + displayName + admin 跳轉鈕
//
// - 點擊頭像跳轉至 props.profilePath；未提供 profilePath 時頭像不可點擊
// - 若 role=admin 且當前不在 /admin 路徑下，於頭像左側顯示 ADMIN 跳轉鈕
// - 無 pictureUrl 時顯示 displayName 第一個字元的灰底 fallback

const props = defineProps<{
  profilePath?: string;
}>();

const route = useRoute();
const authStore = StoreAuth();
const { lineProfile, role } = storeToRefs(authStore);

const showAdminBtn = computed(() =>
  role.value === 'admin' && !route.path.startsWith('/admin'),
);

const fallbackChar = computed(() => {
  const name = lineProfile.value?.displayName ?? '';
  return name.charAt(0).toUpperCase() || '?';
});

const tooltip = computed(() => lineProfile.value?.displayName ?? '');

const ClickAvatar = () => {
  if (!props.profilePath) return;
  navigateTo(props.profilePath);
};

const ClickAdmin = () => {
  navigateTo('/admin/orders');
};
</script>

<template lang="pug">
.CommonHeaderUser
  button.CommonHeaderUser__admin-btn(
    v-if="showAdminBtn"
    type="button"
    @click="ClickAdmin"
  ) ADMIN

  button.CommonHeaderUser__avatar-btn(
    type="button"
    :disabled="!profilePath"
    :title="tooltip"
    @click="ClickAvatar"
  )
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

// ── ADMIN 跳轉鈕 ───────────────────────────────────────────
.CommonHeaderUser__admin-btn {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  padding: 5px 12px;
  border-radius: 100px;
  background: rgba(238, 81, 81, 0.18);
  color: var(--da-amber);
  border: 1px solid rgba(212, 134, 10, 0.35);
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  white-space: nowrap;

  &:hover { background: rgba(238, 81, 81, 0.28); }
  &:active { transform: scale(0.96); }
}

// ── 頭像按鈕 ───────────────────────────────────────────────
.CommonHeaderUser__avatar-btn {
  width: clamp(28px, 8vw, 36px);
  height: clamp(28px, 8vw, 36px);
  padding: 0;
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
  flex-shrink: 0;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.1s;

  &:hover:not(:disabled) {
    border-color: var(--da-amber);
    box-shadow: 0 0 0 2px rgba(212, 134, 10, 0.15);
  }

  &:active:not(:disabled) { transform: scale(0.95); }
  &:disabled { cursor: default; }
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
