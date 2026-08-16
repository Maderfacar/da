<script setup lang="ts">
// Error 全站錯誤頁
//
// 路由分流（2026-05-12）：
//   - /driver/* 下的錯誤 → 自動導回 /driver/dashboard（含倒數提示）
//   - 其他路徑 → 按鈕導回 /
//
// 用 useRequestURL().pathname 取錯誤發生時的原 URL（SSR + CSR 皆可靠），
// useRoute() 在 error.vue 內某些情境下會回 fallback route，不適合判斷。
// 2026-08-17：錯誤頁本身就是最後、也最可靠的一道收集器。
// error-handler.client.ts 的三道（window.onerror / unhandledrejection / vueApp.errorHandler）
// 攔不到 route middleware、plugin、setup() 拋出的錯誤 —— Nuxt 直接接住並渲染本頁，
// 所以現場只看得到全螢幕 500、log 一片空白（司機 OA 進站閃 500 即屬此類）。
// 本頁拿得到完整 error 物件，在此補記一筆，把這塊盲區徹底補上。
import { logUnhandled } from '~/utils/error-log';

type Props = {
  error: { statusCode: number, statusMessage: string, message?: string, stack?: string }
}
const props = defineProps<Props>();

onMounted(() => {
  logUnhandled({
    event: 'app.error-page',
    severity: 'error',
    message: `[${props.error?.statusCode}] ${props.error?.message || props.error?.statusMessage || '(無訊息)'}`,
    stack: props.error?.stack,
    metadata: {
      statusCode: props.error?.statusCode,
      statusMessage: props.error?.statusMessage,
      href: typeof window === 'undefined' ? '' : window.location.href.slice(0, 500),
    },
  });
});

const requestUrl = useRequestURL();
const isDriverPath = requestUrl.pathname.startsWith('/driver');
const redirectTarget = isDriverPath ? '/driver/dashboard' : '/';
const redirectLabel = isDriverPath ? '回到司機後台' : '回到首頁';

// 倒數自動跳轉（僅 driver 路徑啟用，乘客端保留手動點擊以保留錯誤資訊）
const countdown = ref(3);
let timer: ReturnType<typeof setInterval> | null = null;

const HandleError = () => {
  if (timer) clearInterval(timer);
  clearError({ redirect: redirectTarget });
};

onMounted(() => {
  if (!isDriverPath) return;
  timer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      if (timer) clearInterval(timer);
      clearError({ redirect: redirectTarget });
    }
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template lang="pug">
#Error
  p.title {{ props.error.statusCode }}
  p.msg {{ props.error.statusMessage }}
  p.countdown(v-if="isDriverPath") {{ countdown }} 秒後自動返回司機後台
  p.go-home-btn(
    @click="HandleError"
  ) {{ redirectLabel }}
</template>

<style lang="scss" scoped>
// 佈局 ----
#Error {
  @include wh(100vw, 100vh);
  @include center-col(10px);
  color: white;
  background-color: $primary;
}

// 組件 ----
.title {
  @include fs(100px);
  font-weight: 900;
}
.msg {
  @include fs(30px);
  margin-bottom: 12px;
}
.countdown {
  @include fs(16px);
  opacity: 0.7;
  margin-bottom: 20px;
}
.go-home-btn {
  @include fs(20px);
  @include center;
  cursor: pointer;
  padding: 10px 40px;
  border: 1px solid white;
  border-radius: 10px;
}
</style>
