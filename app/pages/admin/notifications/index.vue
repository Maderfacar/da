<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageAdminNotifications
  h1 後台推播管理 (Admin Notifications)
</template>

<style lang="scss" scoped>
.PageAdminNotifications { }
</style>
