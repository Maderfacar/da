<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { lineOaAddUrl } = useRuntimeConfig().public;

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

  //- 分類問答
  section.PageFaq__section(
    v-for="cat in FAQ_CATEGORIES"
    :key="cat.id"
  )
    .PageFaq__cat-label {{ $t('faq.categories.' + cat.id) }}
    PassengerFaqList(:item-keys="cat.itemKeys")

  //- 找不到答案
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

// ── 分類問答 ──────────────────────────────────────────────────────────────────
.PageFaq__section {
  padding: 0 24px 32px;
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
    width: 24px; height: 1.5px;
    background: var(--da-amber);
  }
}

// ── 找不到答案 ────────────────────────────────────────────────────────────────
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
