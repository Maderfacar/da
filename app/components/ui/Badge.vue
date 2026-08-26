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
  border-radius: 100px;
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
  background: rgba(34, 197, 94, 0.1);
  color: #16a34a;
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.UiBadge.is-error {
  background: rgba(238, 81, 81, 0.1);
  color: var(--danger);
  border: 1px solid rgba(238, 81, 81, 0.25);
}

.UiBadge.is-info {
  background: rgba(107, 101, 96, 0.1);
  color: var(--da-gray);
  border: 1px solid rgba(107, 101, 96, 0.2);
}
</style>
