<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageDriverDashboard
  h1 司機儀表板 (Driver Dashboard)
</template>

<style lang="scss" scoped>
.PageDriverDashboard { }
</style>
