<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });
</script>

<template lang="pug">
.PageAdminOrders
  h1 後台訂單管理 (Admin Orders)
</template>

<style lang="scss" scoped>
.PageAdminOrders { }
</style>
