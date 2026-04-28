<script setup lang="ts">
const { locale, locales, setLocale } = useI18n();

const LANG_LABELS: Record<string, string> = { zh: '中', en: 'EN', ja: 'JP' };

const others = computed(() =>
  (locales.value as Array<{ code: string }>).filter((l) => l.code !== locale.value),
);

const isOpen = ref(false);

const ClickLang = async (code: string) => {
  await setLocale(code);
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
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;

.LangSwitcher {
  position: relative;
}

.LangSwitcher__trigger {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 6px 10px;
  border-radius: 100px;
  border: 1.5px solid var(--da-gray-pale);
  background: transparent;
  color: var(--da-gray);
  cursor: pointer;
  transition: all 0.18s;
  line-height: 1;

  &:hover {
    border-color: var(--da-dark);
    color: var(--da-dark);
  }
}

.LangSwitcher__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: rgba(250, 248, 244, 0.96);
  border: 1px solid var(--da-glass-border);
  border-radius: 12px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  backdrop-filter: blur(16px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  z-index: 200;
  min-width: 52px;
}

.LangSwitcher__item {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 6px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--da-gray);
  cursor: pointer;
  text-align: center;
  transition: all 0.15s;

  &:hover {
    background: rgba(26, 24, 20, 0.06);
    color: var(--da-dark);
  }
}

.lang-drop-enter-active,
.lang-drop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.lang-drop-enter-from,
.lang-drop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
