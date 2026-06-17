<script setup lang="ts">
// PageIndex — 根路徑入口
//
// W2：所有分流決策已收斂進 middleware/role.ts（共用 shared/utils/auth-target 的 SSOT logic）。
//   - 未登入訪客 → 留在本頁顯示 hero（W1 把 / 加入公開路由）
//   - 已登入 → middleware/role.ts 依角色 + LIFF deep link 算 target，replace 過去
//
// 為何 page 內仍保留 watch？
//   race：user 進站 URL=/，plugin/auth.client 的 InitAuthFlow 跑完前 middleware 先跑、
//   此時 authResolved=false → middleware early return；之後 authResolved 變 true 時
//   router 沒有 navigation event → middleware 不會重跑 → user 卡在本頁。
//   解法：watch authResolved + isSignIn，用 utils 算同個 target 兜底（同 SSOT，無分歧）。
import { resolveAuthTarget } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';

definePageMeta({ layout: false, ssr: false, middleware: ['role'] });

const authStore = StoreAuth();
const route = useRoute();

watch(
  () => [authStore.authResolved, authStore.isSignIn, authStore.roles.join(','), authStore.approved],
  () => {
    if (!authStore.authResolved || !authStore.isSignIn) return;
    // 優先序 1：LIFF OAuth callback 目標
    const liffTarget = resolveLiffTarget({
      query: route.query as Record<string, string | string[] | null | undefined>,
      pathname: typeof window === 'undefined' ? undefined : window.location.pathname,
    });
    if (liffTarget && liffTarget !== route.path) {
      navigateTo(liffTarget, { replace: true });
      return;
    }
    // 優先序 2：依角色算目標（與 middleware/role.ts 共用 utils）
    const target = resolveAuthTarget({
      entryPath: route.path,
      isSignIn: authStore.isSignIn,
      roles: authStore.roles,
      approved: authStore.approved,
    });
    if (target && target !== route.path) {
      navigateTo(target, { replace: true });
    }
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
