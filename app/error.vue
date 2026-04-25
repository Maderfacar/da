<script setup lang="ts">
// Error 請填寫功能描述👈
type Props = {
  error: { statusCode: number, statusMessage: string }
}
const props = defineProps<Props>();
const HandleError = () => {
  clearError({ redirect: '/' });
};
</script>

<template lang="pug">
#Error
  p.title {{ props.error.statusCode }}
  p.msg {{ props.error.statusMessage }}
  p.go-home-btn(
    @click="HandleError"
  ) 回到首頁
</template>

<style lang="scss" scoped>
// 佈局 ----
#Error {
  @include wh(100vw, 100vh);
  @include center-col(10px);
  color: white;
  background-color: $primary;
  // TODO
}

// 組件 ----
.title {
  @include fs(100px);
  font-weight: 900;
}
.msg {
  @include fs(30px);
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
