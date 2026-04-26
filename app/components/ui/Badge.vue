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
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 12px;
  border-radius: 100px;
  line-height: 1.4;
}

.UiBadge.is-confirmed {
  background: rgba(212, 134, 10, 0.12);
  color: var(--da-amber);
  border: 1px solid rgba(212, 134, 10, 0.3);
}

.UiBadge.is-pending {
  background: rgba(26, 24, 20, 0.06);
  color: var(--da-dark);
  border: 1px solid rgba(26, 24, 20, 0.15);
}

.UiBadge.is-success {
  background: rgba(34, 197, 94, 0.1);
  color: #16a34a;
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.UiBadge.is-error {
  background: rgba(238, 81, 81, 0.1);
  color: var(--err);
  border: 1px solid rgba(238, 81, 81, 0.25);
}

.UiBadge.is-info {
  background: rgba(107, 101, 96, 0.1);
  color: var(--da-gray);
  border: 1px solid rgba(107, 101, 96, 0.2);
}
</style>
