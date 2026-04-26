<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary' | 'glass'
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
  block?: boolean
}

withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
  block: false,
});
</script>

<template lang="pug">
button.UiButton(
  :class="[`is-${variant}`, `is-${size}`, { 'is-disabled': disabled || loading, 'is-loading': loading, 'is-block': block }]"
  :type="type"
  :disabled="disabled || loading"
)
  span.UiButton__spinner(v-if="loading")
  slot
</template>

<style lang="scss" scoped>
.UiButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
  user-select: none;

  &:active { transform: scale(0.97); }
}

// ── 尺寸 ──────────────────────────────────────────────────
.UiButton.is-sm {
  padding: 8px 16px;
  font-size: 12px;
}

.UiButton.is-md {
  padding: 14px 24px;
  font-size: 14px;
}

.UiButton.is-lg {
  padding: 18px 32px;
  font-size: 16px;
}

// ── 變體 ──────────────────────────────────────────────────
.UiButton.is-primary {
  background: var(--da-dark);
  color: var(--da-cream);
  border: none;

  &:hover { opacity: 0.85; }
}

.UiButton.is-secondary {
  background: transparent;
  color: var(--da-dark);
  border: 1.5px solid var(--da-dark);

  &:hover { opacity: 0.7; }
}

.UiButton.is-glass {
  background: var(--da-glass-bg);
  color: var(--da-dark);
  border: 1px solid var(--da-glass-border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  &:hover { opacity: 0.85; }
}

// ── 狀態 ──────────────────────────────────────────────────
.UiButton.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.UiButton.is-block {
  width: 100%;
}

// ── Loading spinner ────────────────────────────────────────
.UiButton__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
