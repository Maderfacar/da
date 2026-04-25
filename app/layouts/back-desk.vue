<script setup lang="ts">
// LayoutBackDesk 後台佈局
const storeEnv = StoreEnv();
</script>

<template lang="pug">
.LayoutBackDesk
  .def-layout-header-area
    p Header
  .def-layout-body-area
    slot
  .def-layout-footer-area
    p Footer
</template>

<style lang="scss" scoped>
// 佈局 ----
.LayoutBackDesk {
  // TODO
}

// 組件 ----
</style>
