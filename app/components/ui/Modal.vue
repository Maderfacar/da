<script setup lang="ts">
interface Props {
  title?: string
  maxWidth?: string
}

withDefaults(defineProps<Props>(), {
  title: undefined,
  maxWidth: '480px',
});

const model = defineModel<boolean>({ default: false });

function close() {
  model.value = false;
}
</script>

<template lang="pug">
teleport(to="body")
  transition(name="modal-overlay")
    .UiModal(v-if="model" @click.self="close")
      transition(name="modal-sheet")
        .UiModal__sheet(v-if="model" :style="{ maxWidth }")
          .UiModal__handle
          .UiModal__header(v-if="title || $slots.header")
            slot(name="header")
              .UiModal__title {{ title }}
          .UiModal__body
            slot
          .UiModal__footer(v-if="$slots.footer")
            slot(name="footer")
</template>

<style lang="scss" scoped>
.UiModal {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(26, 24, 20, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.UiModal__sheet {
  width: 100%;
  background: var(--da-off-white);
  border-radius: 24px 24px 0 0;
  padding: 20px 24px 48px;
  padding-bottom: max(48px, env(safe-area-inset-bottom, 48px));
}

.UiModal__handle {
  width: 40px; height: 4px;
  background: var(--da-gray-pale);
  border-radius: 2px;
  margin: 0 auto 20px;
}

.UiModal__title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  letter-spacing: 0.04em;
  color: var(--da-dark);
  margin-bottom: 16px;
}

.UiModal__body {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: var(--da-gray);
  line-height: 1.8;
}

.UiModal__footer {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

// ── 動畫 ──────────────────────────────────────────────────
.modal-overlay-enter-active,
.modal-overlay-leave-active { transition: opacity 0.25s ease; }

.modal-overlay-enter-from,
.modal-overlay-leave-to { opacity: 0; }

.modal-sheet-enter-active,
.modal-sheet-leave-active { transition: transform 0.3s ease; }

.modal-sheet-enter-from,
.modal-sheet-leave-to { transform: translateY(100%); }
</style>
