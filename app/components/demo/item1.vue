<script setup lang="ts">
// DemoItem1 請填寫功能描述👈
const $mitt = UseMitt();
onMounted(() => {
  $mitt.OnRefresh(() => {
    console.log('refresh');
  });
});
</script>

<template lang="pug">
.DemoItem1
  p DemoItem1
</template>

<style lang="scss" scoped>
// 佈局 ----
.DemoItem1 {
  // TODO
}

// 組件 ----
</style>
