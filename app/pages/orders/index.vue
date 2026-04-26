<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageOrders
  h1 訂單列表 (Orders)
</template>

<style lang="scss" scoped>
.PageOrders { }
</style>
