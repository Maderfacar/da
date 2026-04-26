<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageBooking
  h1 叫車預訂 (Booking)
</template>

<style lang="scss" scoped>
.PageBooking { }
</style>
