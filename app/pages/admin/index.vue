<script setup lang="ts">
// /admin 入口 — 統一導向 /admin/orders（與 login / driver/auth 完成 admin 登入後的落點一致）
definePageMeta({ layout: false, ssr: false });
navigateTo('/admin/orders', { replace: true });
</script>

<template lang="pug">
div
</template>
