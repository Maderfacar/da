<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });
</script>

<template lang="pug">
.PageAdminWarRoom
  h1 管理員作戰室 (Admin War Room)
</template>

<style lang="scss" scoped>
.PageAdminWarRoom { }
</style>
