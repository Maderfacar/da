<script setup lang="ts">
// CommonDrawer 乘客端左側抽屜
//
// 設計（2026/05/14 Brain AI 拍板）：
//   - 移除底部 5-tab bar，改用 hamburger drawer
//   - 桌機 / 手機行為一致（皆 hamburger 收合，無 sticky 側欄）
//   - menu 順序：最新消息 / 訂車 / 車型介紹 / 服務說明 / 路線參考價 / 常見問題 / 客服
//   - 歷史訂單 / 個人設定 / 法律文件改由 CommonFooter 入口進入，不列 drawer
//   - 不放登出（沿用乘客端無登出政策 commit 473ada0）
//   - logo 點擊回 /home（不在 drawer 內列「首頁」）
//
// Wave 2 P4（2026/05/14）：拿掉「我的行程」（/upcoming 已刪），
//   首頁加「下一趟」單卡取代；drawer.upcoming i18n key 一併移除。
// P37 Phase 6：版本號改由 version.ts 同源（之前 hardcode '0.3.20'）
import appVersion from '../../../version';

interface Props {
  modelValue: boolean;
  unreadCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  unreadCount: 0,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const route = useRoute();
const authStore = StoreAuth();
const { lineProfile } = storeToRefs(authStore);
const { lineOaAddUrl } = useRuntimeConfig().public;
const { t } = useI18n();

const fallbackChar = computed(() => {
  const name = lineProfile.value?.displayName ?? '';
  return name.charAt(0).toUpperCase() || '?';
});

// 歷史訂單 / 個人設定 / 法律文件移至 CommonFooter，drawer 僅留主要功能入口
const items = computed(() => [
  { id: 'notifications', path: '/notifications', label: t('drawer.notifications'), badge: props.unreadCount },
  { id: 'booking',       path: '/booking',       label: t('drawer.booking'),       badge: 0 },
  { id: 'fleet',         path: '/fleet',         label: t('drawer.fleet'),         badge: 0 },
  { id: 'service',       path: '/service',       label: t('drawer.service'),       badge: 0 },
  { id: 'fare',          path: '/fare',          label: t('drawer.fare'),          badge: 0 },
  { id: 'faq',           path: '/faq',           label: t('drawer.faq'),           badge: 0 },
]);

const Close = () => emit('update:modelValue', false);

const ClickItem = (path: string) => {
  if (route.path !== path) {
    navigateTo(path);
  }
  Close();
};

const ClickSupport = () => {
  if (lineOaAddUrl && typeof window !== 'undefined') {
    window.open(lineOaAddUrl, '_blank', 'noopener,noreferrer');
  }
  Close();
};

// ESC 關閉（client-only）
const HandleKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.modelValue) Close();
};

watch(() => props.modelValue, (open) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = open ? 'hidden' : '';
});

// 路由切換自動關閉（保險）
watch(() => route.path, () => {
  if (props.modelValue) Close();
});

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', HandleKey);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', HandleKey);
    document.body.style.overflow = '';
  }
});
</script>

<template lang="pug">
Teleport(to="body")
  transition(name="drawer-mask")
    .CommonDrawer__mask(
      v-if="modelValue"
      @click="Close"
    )
  transition(name="drawer-slide")
    aside.CommonDrawer(v-if="modelValue" role="dialog" :aria-label="$t('drawer.ariaDialog')")
      //- ── 使用者資訊 ─────────────────────────────────
      header.CommonDrawer__user
        .CommonDrawer__avatar-wrap
          img.CommonDrawer__avatar(
            v-if="lineProfile?.pictureUrl"
            :src="lineProfile.pictureUrl"
            :alt="lineProfile.displayName"
            referrerpolicy="no-referrer"
          )
          .CommonDrawer__avatar-fallback(v-else) {{ fallbackChar }}
        .CommonDrawer__user-meta
          .CommonDrawer__user-name(v-if="lineProfile?.displayName") {{ lineProfile.displayName }}
          .CommonDrawer__user-name(v-else) {{ $t('drawer.guestName') }}
          .CommonDrawer__user-sub {{ $t('drawer.memberLabel') }}

      //- ── 主導航 ────────────────────────────────────
      nav.CommonDrawer__nav
        button.CommonDrawer__item(
          v-for="item in items"
          :key="item.id"
          :class="{ 'is-active': route.path.startsWith(item.path) }"
          type="button"
          @click="ClickItem(item.path)"
        )
          span.CommonDrawer__item-label {{ item.label }}
          span.CommonDrawer__item-badge(v-if="item.badge > 0") {{ item.badge > 99 ? '99+' : item.badge }}

        //- 客服（外連 LINE OA）
        button.CommonDrawer__item.is-support(
          type="button"
          @click="ClickSupport"
        )
          span.CommonDrawer__item-label {{ $t('drawer.support') }}
          span.CommonDrawer__item-ext ↗

      //- ── 底部 ──────────────────────────────────────
      footer.CommonDrawer__footer
        span.CommonDrawer__version v{{ appVersion }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

// ── 背景遮罩 ──────────────────────────────────────────────
.CommonDrawer__mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 18, 14, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 998;
  cursor: pointer;
}

.drawer-mask-enter-active,
.drawer-mask-leave-active { transition: opacity 0.25s ease; }
.drawer-mask-enter-from,
.drawer-mask-leave-to { opacity: 0; }

// ── 抽屜本體 ──────────────────────────────────────────────
.CommonDrawer {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: min(280px, 80vw);
  z-index: 999;
  background: var(--da-dark, #1a1814);
  color: var(--da-cream, #faf8f4);
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(212, 134, 10, 0.18);
  box-shadow: 4px 0 32px rgba(0, 0, 0, 0.4);
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.drawer-slide-enter-active,
.drawer-slide-leave-active { transition: transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1); }
.drawer-slide-enter-from,
.drawer-slide-leave-to { transform: translateX(-100%); }

// ── 使用者資訊 ──────────────────────────────────────────
.CommonDrawer__user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px 20px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.CommonDrawer__avatar-wrap {
  width: 44px;
  height: 44px;
  border: 1px solid rgba(212, 134, 10, 0.35);
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: transparent;
}

.CommonDrawer__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.CommonDrawer__avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(212, 134, 10, 0.18);
  color: var(--da-amber, #d4860a);
  font-family: $font-condensed;
  font-size: 18px;
  font-weight: 700;
}

.CommonDrawer__user-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.CommonDrawer__user-name {
  font-family: $font-body;
  font-size: 15px;
  font-weight: 600;
  color: var(--da-cream);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.CommonDrawer__user-sub {
  font-family: $font-condensed;
  font-size: $fs-label;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: rgba(212, 134, 10, 0.7);
}

// ── 主導航 ─────────────────────────────────────────────
.CommonDrawer__nav {
  flex: 1;
  padding: 12px 12px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.CommonDrawer__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 13px 14px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(250, 248, 244, 0.8);
  font-family: $font-body;
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.05); color: var(--da-cream); }
  &:active { background: rgba(212, 134, 10, 0.1); }

  &.is-active {
    background: rgba(212, 134, 10, 0.14);
    color: var(--da-amber, #d4860a);
    font-weight: 600;
  }

  &.is-support {
    margin-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 18px;
  }
}

.CommonDrawer__item-label { flex: 1; }

.CommonDrawer__item-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 100px;
  background: #ee5151;
  color: #fff;
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.CommonDrawer__item-ext {
  font-family: $font-condensed;
  font-size: 14px;
  color: rgba(212, 134, 10, 0.55);
}

// ── 底部 ────────────────────────────────────────────────
.CommonDrawer__footer {
  padding: 14px 20px 22px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
}

.CommonDrawer__version {
  font-family: $font-condensed;
  font-size: $fs-label;
  letter-spacing: 0.15em;
  color: rgba(255, 255, 255, 0.25);
}
</style>
