<script setup lang="ts">
import type { SelfLang } from '@/protocol/fetch-api/api/self';

const { locale, locales, setLocale } = useI18n();

const LANG_LABELS: Record<string, string> = { zh: '中', en: 'EN', ja: 'JP' };

const others = computed(() =>
  (locales.value as Array<{ code: string }>).filter((l) => l.code !== locale.value),
);

const isOpen = ref(false);

/**
 * P42：i18n locale code → server SelfLang
 * - i18n 用 'zh' / 'en' / 'ja'（與 i18n locale 檔名對齊）
 * - server users.lang / richmenu lang 用 'zh_tw' / 'en' / 'ja'（與 i18n-message.ts Lang type 對齊）
 */
const _toServerLang = (code: string): SelfLang | null => {
  if (code === 'zh') return 'zh_tw';
  if (code === 'en') return 'en';
  if (code === 'ja') return 'ja';
  return null;
};

const ClickLang = async (code: string) => {
  await setLocale(code);

  // P42：登入 user 同步 lang 至 Firestore + 觸發 LINE richmenu 重綁
  // 訪客 / 未登入 → 只切 cookie（不 call endpoint）
  const authStore = StoreAuth();
  if (authStore.isSignIn) {
    const serverLang = _toServerLang(code);
    if (serverLang) {
      try {
        await $api.PatchSelfLang({ lang: serverLang });
      } catch (err) {
        // 切換失敗不阻擋 i18n 體驗（cookie 已切；下次 login 會同步）
        console.warn('[LangSwitcher] sync lang to server failed:', err);
      }
    }
  }

  isOpen.value = false;
};

onMounted(() => {
  const handler = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.LangSwitcher')) isOpen.value = false;
  };
  document.addEventListener('click', handler);
  onUnmounted(() => document.removeEventListener('click', handler));
});
</script>

<template lang="pug">
.LangSwitcher(@click.stop="isOpen = !isOpen")
  button.LangSwitcher__trigger {{ LANG_LABELS[locale] ?? locale.toUpperCase() }}
  Transition(name="lang-drop")
    .LangSwitcher__menu(v-if="isOpen")
      button.LangSwitcher__item(
        v-for="l in others"
        :key="l.code"
        @click.stop="ClickLang(l.code)"
      ) {{ LANG_LABELS[l.code] ?? l.code.toUpperCase() }}
</template>

<style lang="scss" scoped>

.LangSwitcher {
  position: relative;
}

.LangSwitcher__trigger {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  padding: 6px 10px;
  border-radius: var(--r-pill);
  border: 1.5px solid var(--da-gray-pale);
  background: transparent;
  color: var(--da-gray);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
  line-height: var(--lh-flat);

  &:hover {
    border-color: var(--da-dark);
    color: var(--da-dark);
  }
}

.LangSwitcher__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--surface-a96);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: var(--shadow-soft);
  z-index: var(--z-overlay);
  min-width: 52px;
}

.LangSwitcher__item {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 6px 10px;
  border-radius: var(--r-sm);
  border: none;
  background: transparent;
  color: var(--da-gray);
  cursor: pointer;
  text-align: center;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--ink-a06);
    color: var(--da-dark);
  }
}

.lang-drop-enter-active,
.lang-drop-leave-active { transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.lang-drop-enter-from,
.lang-drop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
