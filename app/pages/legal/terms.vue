<script setup lang="ts">
// 會員服務條款（公開頁，無 auth middleware）
// 2026-06-25 SSR fix v2：layout front-desk → marketing（見 faq/index.vue 同樣註記）
definePageMeta({ layout: 'marketing' });

const { t } = useI18n();
// W2 AEO + SSR fix v2：description / OG / twitter + title（marketing layout 無 titleTemplate）
useSeoMeta({
  title: () => `${t('meta.title.passenger.legalTerms')} · ${t('meta.brand.passenger')}`,
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
