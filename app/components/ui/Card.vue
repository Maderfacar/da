<script setup lang="ts">
interface Props {
  variant?: 'glass' | 'dark' | 'cream'
  padding?: 'sm' | 'md' | 'lg' | 'none'
  accent?: boolean
}

withDefaults(defineProps<Props>(), {
  variant: 'glass',
  padding: 'md',
  accent: false,
});
</script>

<template lang="pug">
.UiCard(
  :class="[`is-${variant}`, `pad-${padding}`, { 'has-accent': accent }]"
)
  slot
</template>

<style lang="scss" scoped>
.UiCard {
  border-radius: var(--r-xl);
  position: relative;
  overflow: hidden;
}

// ── 內距 ──────────────────────────────────────────────────
.UiCard.pad-sm  { padding: 14px; }
.UiCard.pad-md  { padding: 20px; }
.UiCard.pad-lg  { padding: 28px 24px; }
.UiCard.pad-none { padding: 0; }

// ── 變體 ──────────────────────────────────────────────────
.UiCard.is-glass {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-soft);
}

.UiCard.is-dark {
  background: var(--da-dark);
  border: none;
  box-shadow: var(--shadow-lift);
}

.UiCard.is-cream {
  background: var(--da-cream);
  border: 1px solid var(--da-gray-pale);
}

// ── 琥珀色左邊條（行程卡片用）─────────────────────────────
.UiCard.has-accent::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 4px; height: 100%;
  background: var(--da-amber);
  border-radius: var(--r-xl) 0 0 var(--r-xl);
}
</style>
