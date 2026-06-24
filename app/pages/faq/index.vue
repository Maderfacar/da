<script setup lang="ts">
// /faq — 服務說明 + 安心保障 + FAQ + 客服（/service 合併進來；2026-06-07）
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { lineOaAddUrl } = useRuntimeConfig().public;
const { t } = useI18n();

// W2 AEO：description / OG / twitter（title 由 front-desk layout titleTemplate 處理）
useSeoMeta({
  description: () => t('meta.description.passenger.faq'),
  ogType: 'website',
  ogTitle: () => `${t('meta.title.passenger.faq')} · ${t('meta.brand.passenger')}`,
  ogDescription: () => t('meta.description.passenger.faq'),
  twitterCard: 'summary_large_image',
});

const ClickSupport = () => {
  if (lineOaAddUrl && typeof window !== 'undefined') {
    window.open(lineOaAddUrl, '_blank', 'noopener,noreferrer');
  }
};
</script>

<template lang="pug">
.PageFaq
  .PageFaq__watermark FAQ

  //- 頁首
  .PageFaq__header
    .PageFaq__header-label INFORMATION DESK
    h1.PageFaq__header-title {{ $t('faq.title') }}
    p.PageFaq__header-intro {{ $t('faq.intro') }}

  //- ── Section 1：服務說明 ───────────────────────────────────
  section.PageFaq__section.is-overview
    .PageFaq__section-label {{ $t('faq.serviceOverview.label') }}
    h2.PageFaq__section-title {{ $t('faq.serviceOverview.title') }}
    h3.PageFaq__overview-heading {{ $t('faq.serviceOverview.heading') }}
    .PageFaq__overview-body
      p {{ $t('faq.serviceOverview.p1') }}
      p {{ $t('faq.serviceOverview.p2') }}

  .PageFaq__stripe

  //- ── Section 2：安心保障 / 司機與保障 ────────────────────
  section.PageFaq__section.is-trust
    .PageFaq__section-label {{ $t('faq.trust.label') }}
    h2.PageFaq__section-title {{ $t('faq.trust.title') }}
    .PageFaq__trust-card
      .PageFaq__trust-subtitle {{ $t('faq.trust.subtitle') }}
      p.PageFaq__trust-tagline {{ $t('faq.trust.tagline') }}
      ul.PageFaq__trust-list
        li {{ $t('faq.trust.item1') }}
        li {{ $t('faq.trust.item2') }}
        li {{ $t('faq.trust.item3') }}
        li {{ $t('faq.trust.item4') }}
        li {{ $t('faq.trust.item5') }}

  .PageFaq__stripe

  //- ── Section 3：FAQ 分類問答 ─────────────────────────────
  .PageFaq__faq-wrap
    .PageFaq__faq-label
      span {{ $t('faq.categoriesLabel') }}
    section.PageFaq__section.is-faq(
      v-for="cat in FAQ_CATEGORIES"
      :key="cat.id"
    )
      .PageFaq__cat-label {{ $t('faq.categories.' + cat.id) }}
      PassengerFaqList(:item-keys="cat.itemKeys")

  //- ── Section 4：沒有找到答案（客服按鈕）─────────────────
  section.PageFaq__contact
    h2.PageFaq__contact-title {{ $t('faq.notFound.title') }}
    p.PageFaq__contact-desc {{ $t('faq.notFound.desc') }}
    button.PageFaq__contact-btn(type="button" @click="ClickSupport")
      | {{ $t('faq.notFound.cta') }}
      span.PageFaq__contact-ext ↗
</template>

<style lang="scss" scoped>
// ── 字體變數 ──────────────────────────────────────────────────────────────────
$font-display: 'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body: 'Barlow', 'Noto Sans TC', sans-serif;

// ── 版面 ──────────────────────────────────────────────────────────────────────
.PageFaq {
  background: var(--da-off-white);
  color: var(--da-dark);
  min-height: 100svh;
  padding-top: 56px;
  position: relative;
  overflow-x: hidden;
}

.PageFaq__watermark {
  position: fixed;
  top: 80px; right: -10px;
  font-family: $font-display;
  font-size: 100px;
  color: var(--da-dark);
  opacity: 0.04;
  pointer-events: none;
  user-select: none;
  letter-spacing: 0.04em;
}

// ── 頁首 ──────────────────────────────────────────────────────────────────────
.PageFaq__header {
  padding: 48px 24px 32px;
}

.PageFaq__header-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 10px;
}

.PageFaq__header-title {
  font-family: $font-display;
  font-size: clamp(48px, 14vw, 64px);
  line-height: 0.92;
  color: var(--da-dark);
}

.PageFaq__header-intro {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  margin-top: 12px;
  line-height: 1.7;
  max-width: 320px;
}

// ── 共用 section ─────────────────────────────────────────────────────────────
.PageFaq__section {
  padding: 72px 24px;
  scroll-margin-top: 56px;
}

.PageFaq__section.is-overview { background: var(--da-cream); }
.PageFaq__section.is-trust    { background: var(--da-off-white); }

.PageFaq__section-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    width: 24px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageFaq__section-title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin-bottom: 20px;
}

// ── 分隔條紋 ─────────────────────────────────────────────────────────────────
.PageFaq__stripe {
  height: 12px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow) 0px, var(--da-stripe-yellow) 12px,
    var(--da-stripe-dark) 12px, var(--da-stripe-dark) 24px
  );
  opacity: 0.85;
}

// ── 服務說明 ─────────────────────────────────────────────────────────────────
.PageFaq__overview-heading {
  font-family: $font-display;
  font-size: clamp(22px, 5vw, 28px);
  line-height: 1.3;
  letter-spacing: 0.02em;
  color: var(--da-dark);
  margin: 8px 0 22px;
  max-width: 480px;
}

.PageFaq__overview-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;

  p {
    font-family: $font-body;
    font-size: 14.5px;
    font-weight: 300;
    color: var(--da-gray);
    line-height: 1.85;
    margin: 0;
  }
}

// ── 安心保障 / 司機與保障 ────────────────────────────────────────────────────
.PageFaq__trust-card {
  background: var(--da-dark);
  color: var(--da-cream);
  border-radius: 20px;
  padding: 28px 24px;
  border: 1px solid rgba(212, 134, 10, 0.18);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
  max-width: 640px;
}

.PageFaq__trust-subtitle {
  font-family: $font-display;
  font-size: 28px;
  letter-spacing: 0.04em;
  color: var(--da-cream);
}

.PageFaq__trust-tagline {
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--da-amber);
  text-transform: uppercase;
  margin: 6px 0 22px;
}

.PageFaq__trust-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PageFaq__trust-list li {
  font-family: $font-body;
  font-size: 14px;
  color: rgba(250, 248, 244, 0.88);
  line-height: 1.75;
  padding-left: 24px;
  position: relative;
}

.PageFaq__trust-list li::before {
  content: '✈';
  position: absolute;
  left: 0;
  top: 1px;
  color: var(--da-amber);
}

// ── FAQ 問答 wrap ─────────────────────────────────────────────────────────────
.PageFaq__faq-wrap {
  background: var(--da-cream);
  padding: 56px 0 16px;
}

.PageFaq__faq-label {
  padding: 0 24px;
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    width: 24px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageFaq__section.is-faq {
  padding: 0 24px 32px;
  background: var(--da-cream);
}

.PageFaq__cat-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    width: 18px; height: 1.5px;
    background: var(--da-amber);
  }
}

// ── 沒有找到答案（客服按鈕）─────────────────────────────────────────────────
.PageFaq__contact {
  margin: 16px 24px 56px;
  padding: 32px 24px;
  background: var(--da-dark);
  border-radius: 20px;
  text-align: center;
}

.PageFaq__contact-title {
  font-family: $font-display;
  font-size: 32px;
  color: var(--da-cream);
  letter-spacing: 0.04em;
}

.PageFaq__contact-desc {
  font-family: $font-body;
  font-size: 13px;
  color: rgba(250, 248, 244, 0.6);
  margin: 8px 0 20px;
}

.PageFaq__contact-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 28px;
  background: var(--da-amber);
  color: var(--da-dark);
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: none;
  border-radius: 100px;
  cursor: pointer;
}

.PageFaq__contact-btn:active {
  transform: scale(0.97);
}

.PageFaq__contact-ext {
  font-size: 12px;
}
</style>
