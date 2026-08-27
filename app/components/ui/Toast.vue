<script setup lang="ts">
const { toastState } = useToast();
</script>

<template lang="pug">
teleport(to="body")
  transition(name="toast")
    .UiToast(v-if="toastState.visible") {{ toastState.message }}
</template>

<style lang="scss" scoped>
.UiToast {
  position: fixed;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  background: var(--da-dark);
  color: var(--da-cream);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 12px 24px;
  border-radius: var(--r-pill);
  white-space: nowrap;
  pointer-events: none;
}

// ── 動畫 ──────────────────────────────────────────────────
.toast-enter-active,
.toast-leave-active { transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out); }

.toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
.toast-leave-to   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
</style>
