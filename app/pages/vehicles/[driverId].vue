<script setup lang="ts">
// Phase 1C：車輛公開檔案頁
//
// - 公開可讀（passenger / guest 都行）：不掛 auth / role middleware
// - 未驗證車輛 / 不存在 driver → 404（component 內處理）
// - 響應式：mobile 2 cols / tablet 3 cols / desktop 4 cols（gallery 內）
definePageMeta({
  layout: 'front-desk',
  ssr: false,
});

const route = useRoute();
const { locale } = useI18n();

const driverId = computed(() => String(route.params.driverId ?? ''));
</script>

<template lang="pug">
.PageVehiclePublic
  ClientOnly
    VehiclePublicProfile(:driver-id="driverId" :lang="locale as string")
</template>

<style lang="scss" scoped>
.PageVehiclePublic {
  min-height: 100svh;
  background: var(--da-cream);
}
</style>
