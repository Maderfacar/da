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

// 修 C：解析 LIFF `liff.state` / `next` query（OAuth callback 用此 query 傳遞目標 path）。
// LIFF endpoint URL = `/`，當司機從 driver 路徑進入但需要 OAuth 登入時，callback 會回到
// 根路徑 `/?liff.state=/driver/xxx`。如果 PageIndex 不先看 liff.state 就無條件推 `/home`，
// 司機會被踢去乘客端 → 永遠進不了 driver 端。
// 守則：目標必須 `/` 開頭、不可含 `//`、不可有 scheme — 避免 open redirect。
const _resolveLiffTarget = (): string => {
  if (typeof window === 'undefined') return '';
  // 優先序 1：liff.state / next query（OAuth callback 標準寫法）
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('liff.state') || params.get('next') || '';
  if (raw) {
    try {
      const target = decodeURIComponent(raw);
      if (target.startsWith('/') && !target.includes('//') && !target.includes(':')) {
        return target;
      }
    } catch { /* fallthrough to pathname check */ }
  }
  // 優先序 2：LIFF SDK 可能在 init 內用 history.replaceState 把 URL rewrite 成目標 path，
  // 但 Vue Router 仍停在 `/`（replaceState 不會觸發 router navigation）。這時 pathname 已
  // 是目標 path，PageIndex 還在 mount → 同樣需要 router.replace 過去同步。
  const path = window.location.pathname;
  if (path && path !== '/' && path.startsWith('/') && !path.includes('//') && !path.includes(':')) {
    return path;
  }
  return '';
};

watch(
  () => [authStore.authResolved, authStore.isSignIn],
  () => {
    if (!authStore.authResolved) return;
    if (!authStore.isSignIn) {
      navigateTo('/login', { replace: true });
      return;
    }
    // 已登入：優先檢查 liff.state — 有目標 path 就跳過去（不要推到 /home 卡住司機）
    const liffTarget = _resolveLiffTarget();
    if (liffTarget) {
      navigateTo(liffTarget, { replace: true });
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
