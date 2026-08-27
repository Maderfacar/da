<script setup lang="ts">
// 乘客端深色模式切換（階段 2 W4）
//
// 三選一：淺色 / 深色 / 跟隨系統。走 @nuxtjs/color-mode（模組本來就掛著，
// 但在此之前站上沒有深色模式 —— _theme-colors.css 末段原本留著一句
// 「要做深色模式請另開變更，不要復活這段」）。
//
// preference 預設仍是 'light'（見 nuxt.config.ts）：深色配色是本階段新產出的，
// 不該在上線當天讓所有系統設為深色的乘客直接吃到。想改預設是一行的事。
const colorMode = useColorMode();
const { t } = useI18n();

const OPTIONS = ['light', 'dark', 'system'] as const;
type ThemeChoice = typeof OPTIONS[number];

const labelOf = (v: ThemeChoice) => t(`drawer.theme.${v}`);

const ClickPick = (v: ThemeChoice) => {
  colorMode.preference = v;
};
</script>

<template lang="pug">
.CommonThemeToggle(role="group" :aria-label="$t('drawer.theme.aria')")
  span.CommonThemeToggle__label {{ $t('drawer.theme.aria') }}
  .CommonThemeToggle__seg
    button.CommonThemeToggle__opt(
      v-for="opt in OPTIONS"
      :key="opt"
      type="button"
      :class="{ 'is-on': colorMode.preference === opt }"
      :aria-pressed="colorMode.preference === opt"
      @click="ClickPick(opt)"
    ) {{ labelOf(opt) }}
</template>

<style lang="scss" scoped>
.CommonThemeToggle {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.CommonThemeToggle__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--surface-a40);
}

.CommonThemeToggle__seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 2px;
  background: var(--surface-a06);
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-pill);
}

.CommonThemeToggle__opt {
  min-height: 30px;
  padding: 0 6px;
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-snug);
  color: var(--surface-a50);
  background: none;
  border: none;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.CommonThemeToggle__opt:hover {
  color: var(--surface-a82);
}

.CommonThemeToggle__opt:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-a50);
}

.CommonThemeToggle__opt.is-on {
  color: var(--ink);
  background: var(--accent);
}
</style>
