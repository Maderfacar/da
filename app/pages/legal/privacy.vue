<script setup lang="ts">
// 隱私權政策（公開頁，無 auth middleware）
definePageMeta({ layout: 'front-desk' });

const { t } = useI18n();
// W2 AEO：description / OG / twitter（title 由 front-desk layout titleTemplate 處理）
useSeoMeta({
  description: () => t('meta.description.passenger.legalPrivacy'),
  ogType: 'article',
  ogTitle: () => `${t('meta.title.passenger.legalPrivacy')} · ${t('meta.brand.passenger')}`,
  ogDescription: () => t('meta.description.passenger.legalPrivacy'),
  twitterCard: 'summary',
});
</script>

<template lang="pug">
LegalPageView(pageKey="privacy")
</template>
