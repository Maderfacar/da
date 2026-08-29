<script setup lang="ts">
// CommonHeaderUser 三端 Layout Header 共用：圓形 LINE 頭像 + displayName + 跨端切換鈕
//
// 三條規則（2026/05/07 使用者明確要求）：
//   1. 乘客端（非 /admin 也非 /driver）：roles 含 admin → 顯示 ADMIN 鈕；其餘不顯示跨端鈕
//   2. Admin 端（/admin/*）：永遠顯示 PASSENGER 鈕（無條件）
//   3. 司機端（/driver/*）：不顯示任何跨端按鈕
//
// 頭像預設不可點擊（純顯示）；無 pictureUrl 時顯示 displayName 第一個字元 fallback。
// 內部直接讀 authStore proxy（不用 storeToRefs），避免 Pinia setup store 解構 computed
// 在某些瀏覽器環境失去 reactivity 的潛在問題。
//
// 2026-08-29：加一個 opt-in 的 `clickable-avatar`。乘客端手機頂欄照介面方向提案總則 01
// 把漢堡拿掉了，抽屜（車型 / 常見問題 / 推薦 / 客服 / 條款）需要新的入口，
// 而頭像是提案上唯一還留在頂欄的可點物件。**預設值不變**，admin / driver / 桌機不受影響。
// 不把整個元件包進 <button> 的理由：裡面本來就有 ADMIN / PASSENGER 兩顆按鈕，button 巢狀是無效 HTML。

const props = withDefaults(defineProps<{ clickableAvatar?: boolean }>(), {
  clickableAvatar: false,
});
const emit = defineEmits<{ avatarClick: [] }>();

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

  component(
    :is="props.clickableAvatar ? 'button' : 'div'"
    class="CommonHeaderUser__avatar-wrap"
    :class="{ 'is-clickable': props.clickableAvatar }"
    :type="props.clickableAvatar ? 'button' : undefined"
    :title="tooltip"
    :aria-label="props.clickableAvatar ? tooltip : undefined"
    @click="props.clickableAvatar && emit('avatarClick')"
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

.CommonHeaderUser {
  display: flex;
  align-items: center;
  gap: 8px;
}

// ── 跨端切換鈕 ─────────────────────────────────────────────
.CommonHeaderUser__admin-btn,
.CommonHeaderUser__passenger-btn {
  font-family: var(--ff-label);
  font-size: $fs-label;
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  padding: 5px 12px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  white-space: nowrap;

  &:active { transform: scale(0.96); }
}

.CommonHeaderUser__admin-btn {
  background: var(--stop-a15);
  color: var(--accent-text);
  border: 1px solid var(--accent-a30);
  &:hover { background: var(--stop-a30); }
}

.CommonHeaderUser__passenger-btn {
  background: var(--accent-a12);
  color: var(--da-cream);
  border: 1px solid var(--accent-a40);
  &:hover { background: var(--accent-a20); }
}

// ── 頭像（預設純顯示；clickable-avatar 時才是按鈕） ───────
.CommonHeaderUser__avatar-wrap.is-clickable {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out);

  &:active { transform: scale(0.94); }
}

.CommonHeaderUser__avatar-wrap {
  width: clamp(28px, 8vw, 36px);
  height: clamp(28px, 8vw, 36px);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-round);
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
  background: var(--accent-a20);
  color: var(--accent-text);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-none);
}

// ── 名稱（窄螢幕隱藏，節省 header 空間） ──────────────────
.CommonHeaderUser__name {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
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
