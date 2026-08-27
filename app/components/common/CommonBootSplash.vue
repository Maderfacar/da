<script setup lang="ts">
// CommonBootSplash — App boot 期間 brand splash
//
// 用途：作為 app.vue Suspense 的 fallback，在 BootGate 等 InitAuthFlow 完成期間顯示
// 與 layouts 內 `!authResolved` overlay 同樣風格（DEST ∙ ANYWHERE + 琥珀 spinner），
// 避免 reload 期間瀏覽器顯示 cached SPA shell（看似已登入卻其實還沒 boot 完）的閃爍。
</script>

<template lang="pug">
.CommonBootSplash
  .CommonBootSplash__logo
    | DEST
    span ∙
    | ANYWHERE
  .CommonBootSplash__spinner
</template>

<style lang="scss" scoped>

.CommonBootSplash {
  position: fixed;
  inset: 0;
  z-index: var(--z-boot);
  background: var(--da-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.CommonBootSplash__logo {
  font-family: var(--ff-display);
  font-size: 32px;
  letter-spacing: 0.08em;
  color: var(--da-cream);
  line-height: 1;

  span { color: var(--da-amber); }
}

.CommonBootSplash__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--da-amber);
  border-radius: var(--r-round);
  animation: CommonBootSplash-spin 0.8s linear infinite;
}

@keyframes CommonBootSplash-spin {
  to { transform: rotate(360deg); }
}
</style>
