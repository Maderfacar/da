<script setup lang="ts">
// CommonBootGate — 三端 SPA 認證 race 防護閘（LIFF 化方案 1）
//
// 背景：三端（乘客 / 司機 / Admin）reload 時會閃登入畫面、或先顯示 cached 已登入 UI、
// 約 1 秒後才真 loading 成功。根因：
//   - 司機 / Admin 端 page-level `ssr: false` → reload 時瀏覽器顯示上次 cached SPA shell
//   - Pinia store 空白 → 早期渲染若直接看 storeAuth.token=undefined 會誤判未登入
//   - LIFF SDK 的 liff.init() 未在 app boot 時 await → middleware 跑時可能 race
//
// 解法：用 Suspense + 此 BootGate，在 InitAuthFlow 跑完（或 12s safetyTimer）前
// 不 mount NuxtLayout / NuxtPage，由 app.vue 提供的 CommonBootSplash fallback 撐畫面。
//
// 公開頁面（isPublicRoute）skip await — 那些頁是 SSR + SWR cache，內容不依賴 auth，
// client 再去 await 會造成 hydration mismatch（SSR rendered → fallback 閃）。
// 公開路由名單由 shared/constants/auth-public-routes 統一定義（W1 SSOT），
// 同時被 middleware/auth.ts 與 PageIndex 使用，避免散落漂移。
//
// SSR 時也 skip — `import.meta.client=false`；確保 server 端不被 12s timeout 卡住。
import { isPublicRoute } from '~shared/constants/auth-public-routes';

const route = useRoute();

if (import.meta.client && !isPublicRoute(route.path)) {
  const authStore = StoreAuth();
  // race 12s 上限（與 StoreAuth.InitAuthFlow safetyTimer 對齊），避免 LIFF 在 WebView hang 住時永久 splash
  await Promise.race([
    authStore.WaitForAuthResolved(),
    new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
  ]);
}
</script>

<template lang="pug">
slot
</template>
