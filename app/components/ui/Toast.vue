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
  z-index: 300;
  background: var(--da-dark);
  color: var(--da-cream);
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 12px 24px;
  border-radius: 100px;
  white-space: nowrap;
  pointer-events: none;
}

// ── 動畫 ──────────────────────────────────────────────────
.toast-enter-active,
.toast-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }

.toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
.toast-leave-to   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
</style>
