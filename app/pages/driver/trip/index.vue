<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });
</script>

<template lang="pug">
.PageDriverTrip
  h1 行程執行中 (Driver Trip)
</template>

<style lang="scss" scoped>
.PageDriverTrip { }
</style>
