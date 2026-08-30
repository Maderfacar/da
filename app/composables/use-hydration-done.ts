/**
 * UseHydrationDone — hydration 同形守門（2026-08-30，根治 layout hydration mismatch）
 *
 * 病根：三端 layout（front-desk / driver / back-desk）在 `authResolved` 上做 SSR 可見的
 * 條件渲染。server 端 authResolved 恆為 false；但 client 端 auth plugin 在 app mount
 * **之前**就可能把它翻成 true（訪客走快速路徑、或 BootGate 已 await 完），於是 client
 * 的「第一次 render」與 SSR 產物不同形：
 *   - front-desk：SSR 沒渲染 slot（註解節點），client 第一次 render 卻要畫 slot（Fragment）
 *   - driver / back-desk：SSR 渲染了 auth loading 遮罩，client 第一次 render 卻不畫
 * → Vue 印「Hydration completed but contains mismatches」，整個 layout 被 client 重畫一次。
 *
 * 解法：回傳一個 ref —— reload 的 hydration 期間為 false，mounted 後翻 true；
 * SPA 導航（非 hydration）一開始就是 true，不引入任何延遲。
 * 用它把 auth 條件渲染「壓」到與 SSR 同形，mounted 後才依真實 auth 狀態切換
 * （這正是現在 mismatch 修復重畫發生的同一時刻，使用者看到的時序不變）。
 *
 * 用法（layout script）：
 *   const hydrationDone = UseHydrationDone();
 *   // SSR 渲染 X 的：v-if="!authResolved || !hydrationDone"（首次 render 保持渲染）
 *   // SSR 不渲染 X 的：v-if="authResolved && hydrationDone"（首次 render 保持不渲染）
 *
 * ⚠ 為什麼不用 nuxtApp.isHydrating 當初值：layout 是 defineAsyncComponent，包在
 * app.vue Suspense + NuxtLayout 的巢狀 suspensible Suspense 裡。實測（2026-08-30，
 * 診斷 build 開 __VUE_PROD_HYDRATION_MISMATCH_DETAILS__）：hydration 還在進行、
 * layout 的 setup 執行當下 isHydrating 已經是 false —— 拿它當初值等於沒守。
 * 一律 false 起步、onMounted 翻 true：SPA 導航時多出的那一個 tick 無感，
 * 換來 reload 時第一次 render 與 SSR 保證同形。
 */
export function UseHydrationDone(): Ref<boolean> {
  const done = ref(false);
  onMounted(() => {
    done.value = true;
  });
  return done;
}
