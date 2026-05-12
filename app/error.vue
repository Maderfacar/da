<script setup lang="ts">
// Error 全站錯誤頁
//
// 路由分流（2026-05-12）：
//   - /driver/* 下的錯誤 → 自動導回 /driver/dashboard（含倒數提示）
//   - 其他路徑 → 按鈕導回 /
//
// 用 useRequestURL().pathname 取錯誤發生時的原 URL（SSR + CSR 皆可靠），
// useRoute() 在 error.vue 內某些情境下會回 fallback route，不適合判斷。
type Props = {
  error: { statusCode: number, statusMessage: string }
}
const props = defineProps<Props>();

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
