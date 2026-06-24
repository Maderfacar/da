<script setup lang="ts">
// 會員服務條款（公開頁，無 auth middleware）
definePageMeta({ layout: 'front-desk' });

const { t } = useI18n();
// W2 AEO：description / OG / twitter（title 由 front-desk layout titleTemplate 處理）
useSeoMeta({
  description: () => t('meta.description.passenger.legalTerms'),
  ogType: 'article',
  ogTitle: () => `${t('meta.title.passenger.legalTerms')} · ${t('meta.brand.passenger')}`,
  ogDescription: () => t('meta.description.passenger.legalTerms'),
  twitterCard: 'summary',
});
</script>

<template lang="pug">
LegalPageView(pageKey="terms")
</template>
