<script setup lang="ts">
// PageIndex — 三端分流入口
//
// 路由規則：
//   - 未登入 → /login
//   - 已登入：
//     - admin（無 driver / 純 admin）→ /admin/orders
//     - approved driver → /driver/dashboard
//     - 其他（passenger / 未核准 driver / 多重身分含 passenger）→ /home
//
// 多重身分優先順序：driver > admin > passenger（核准司機進駕駛端為主，可由 Header 切回乘客端）
//
// SSR 關閉以避免 hydration mismatch（Firebase auth state 只在 client 解析）
definePageMeta({ layout: false, ssr: false });

const authStore = StoreAuth();

watch(
  () => [authStore.authResolved, authStore.isSignIn, authStore.roles.join(',')],
  () => {
    if (!authStore.authResolved) return;
    if (!authStore.isSignIn) {
      navigateTo('/login', { replace: true });
      return;
    }
    if (authStore.isApprovedDriver) {
      navigateTo('/driver/dashboard', { replace: true });
      return;
    }
    if (authStore.isAdmin) {
      navigateTo('/admin/orders', { replace: true });
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
