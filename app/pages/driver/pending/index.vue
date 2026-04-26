<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageDriverPending
  h1 司機待命中 (Driver Pending)
</template>

<style lang="scss" scoped>
.PageDriverPending { }
</style>
