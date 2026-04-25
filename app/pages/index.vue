<script setup lang="ts">
// PageIndex — 首頁跳轉邏輯
const { isSignIn } = StoreSelf();

onMounted(() => {
  if (isSignIn) navigateTo('/home');
  else navigateTo('/home');
});
</script>

<template lang="pug">
.PageIndex
</template>

<style lang="scss" scoped>
.PageIndex { }
</style>
