<script setup lang="ts">
interface Props {
  variant?: 'confirmed' | 'pending' | 'success' | 'error' | 'info'
}

withDefaults(defineProps<Props>(), {
  variant: 'info',
});
</script>

<template lang="pug">
span.UiBadge(:class="`is-${variant}`")
  slot
</template>

<style lang="scss" scoped>
.UiBadge {
  display: inline-block;
  font-family: var(--ff-label);
  font-size: $fs-label;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 12px;
  border-radius: var(--r-pill);
  line-height: 1.4;
}

.UiBadge.is-confirmed {
  background: var(--accent-a12);
  color: var(--da-amber);
  border: 1px solid var(--accent-a30);
}

.UiBadge.is-pending {
  background: var(--ink-a06);
  color: var(--da-dark);
  border: 1px solid var(--ink-a12);
}

.UiBadge.is-success {
  background: var(--good-a08);
  color: var(--good);
  border: 1px solid var(--good-a30);
}

.UiBadge.is-error {
  background: var(--stop-a08);
  color: var(--danger);
  border: 1px solid var(--stop-a30);
}

.UiBadge.is-info {
  background: var(--ink-a12);
  color: var(--ink-soft);
  border: 1px solid var(--ink-a20);
}
</style>
