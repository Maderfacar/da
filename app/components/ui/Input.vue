<script setup lang="ts">
interface Props {
  label?: string
  placeholder?: string
  type?: string
  error?: string
  hint?: string
  disabled?: boolean
  maxlength?: number
  inputmode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url'
  theme?: 'light' | 'dark'
}

withDefaults(defineProps<Props>(), {
  label: undefined,
  placeholder: undefined,
  type: 'text',
  error: undefined,
  hint: undefined,
  disabled: false,
  maxlength: 200,
  inputmode: undefined,
  theme: 'light',
});

const model = defineModel<string | number>();
</script>

<template lang="pug">
.UiInput(:class="[`is-${theme}`, { 'is-error': !!error, 'is-disabled': disabled }]")
  label.UiInput__label(v-if="label") {{ label }}
  .UiInput__wrap
    input.UiInput__field(
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :maxlength="maxlength"
      :inputmode="inputmode"
    )
  p.UiInput__error(v-if="error") {{ error }}
  p.UiInput__hint(v-else-if="hint") {{ hint }}
</template>

<style lang="scss" scoped>
.UiInput {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.UiInput__label {
  font-family: var(--ff-label);
  font-size: $fs-label;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-gray);
  display: block;
}

.UiInput__wrap {
  position: relative;
}

.UiInput__field {
  width: 100%;
  min-height: 44px;
  padding: 12px 16px;
  border-radius: var(--r-md);
  font-family: var(--ff-ui);
  font-size: 15px;
  color: var(--da-dark);
  outline: none;
  transition: border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out);
  -webkit-appearance: none;

  &::placeholder {
    color: var(--da-gray-light);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// ── Light 主題 ─────────────────────────────────────────────
.UiInput.is-light .UiInput__field {
  background: var(--surface-a82);
  border: 1.5px solid var(--da-gray-pale);

  &:focus {
    border-color: var(--da-amber);
    background: var(--surface-raised);
  }
}

// ── Dark 主題 ──────────────────────────────────────────────
.UiInput.is-dark .UiInput__label {
  color: var(--surface-a50);
}

.UiInput.is-dark .UiInput__field {
  background: var(--surface-a06);
  border: 1px solid var(--surface-a12);
  color: var(--da-cream);

  &::placeholder { color: var(--surface-a20); }

  &:focus {
    border-color: var(--da-amber);
    background: var(--surface-a12);
  }
}

// ── 錯誤狀態 ───────────────────────────────────────────────
.UiInput.is-error .UiInput__field {
  border-color: var(--danger);
}

.UiInput__error {
  font-family: var(--ff-ui);
  font-size: 12px;
  color: var(--danger);
  line-height: 1.4;
}

.UiInput__hint {
  font-family: var(--ff-ui);
  font-size: 12px;
  color: var(--da-gray-light);
  line-height: 1.4;
}
</style>
