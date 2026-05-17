<script setup lang="ts">
// /admin 入口 — 統一導向 /admin/dashboard（admin 登入後的落點）
definePageMeta({ layout: false, ssr: false });
navigateTo('/admin/dashboard', { replace: true });
</script>

<template lang="pug">
div
</template>
