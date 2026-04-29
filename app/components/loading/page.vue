<script setup lang="ts">
// .LoadingPage
const nuxtApp = useNuxtApp();
const isFinish = ref(false);
const isHide = ref(false);

const _hide = () => {
  if (isHide.value) return;
  isHide.value = true;
  setTimeout(() => { isFinish.value = true; }, 600);
};

nuxtApp.hooks.hookOnce('page:finish', _hide);

nuxtApp.hooks.hookOnce('app:rendered', (e) => {
  if (e.ssrContext?.error) {
    isHide.value = true;
    isFinish.value = true;
  }
});

// Fallback：若 page:finish 在 8 秒內未觸發（LINE WebView 特殊情況），強制隱藏
setTimeout(_hide, 8_000);
</script>

<template lang="pug">
.LoadingPage(v-if="!isFinish" :class="{'is-hide': isHide}")
  NuxtIcon(name="my-icon:loading")
</template>

<style lang="scss" scoped>

.LoadingPage {
  @include fs(50px);
  @include center;
  @include fixed(fill);
  color: $primary;
  background-color: white;
  opacity: 1;
  z-index: 9999;
  transition: opacity .4s ease;
}

// 組件 ----
.is-hide {
  opacity: 0 !important;
  pointer-events: none;
}
</style>
