<script setup lang="ts">
// PageIndex — 根路徑入口
//
// 多角色設計：roles 僅判別「能否進入特定路由」，不搶分流。
//   - 未登入 → /login
//   - 已登入 → /home（乘客首頁；想進 driver/admin 端從 layout Header 的切換按鈕進入）
//
// SSR 關閉以避免 hydration mismatch（Firebase auth state 只在 client 解析）
definePageMeta({ layout: false, ssr: false });

const authStore = StoreAuth();

watch(
  () => [authStore.authResolved, authStore.isSignIn],
  () => {
    if (!authStore.authResolved) return;
    if (!authStore.isSignIn) {
      navigateTo('/login', { replace: true });
      return;
    }
    navigateTo('/home', { replace: true });
  },
  { immediate: true },
);
</script>

<template lang="pug">
.PageIndex
</template>

<style lang="scss" scoped>
.PageIndex {
  min-height: 100svh;
  background: var(--da-cream, #faf8f4);
}
</style>
