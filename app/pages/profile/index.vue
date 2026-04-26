<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });
</script>

<template lang="pug">
.PageProfile
  h1 個人資料 (Profile)
</template>

<style lang="scss" scoped>
.PageProfile { }
</style>
