<script setup lang="ts">
// LayoutFrontDesk 前台佈局
const storeEnv = StoreEnv();
</script>

<template lang="pug">
.LayoutFrontDesk
  .def-layout-header-area
    p Header
  .def-layout-body-area
    slot
  .def-layout-footer-area
    p Footer
</template>

<style lang="scss" scoped>
// 佈局 ----
.LayoutFrontDesk {
  // TODO
}

// 組件 ----
</style>
