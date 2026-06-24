<script setup lang="ts">
// PageIndex — 行銷 Landing（W1 AEO，2026-06-25）
//
// 為什麼這頁需要 SSR + 完整內容？
//   前身：layout:false / ssr:false / 空白 .PageIndex —— AI 爬蟲拿到 0 字內容。
//   現況：改用 marketing layout（不依賴 authResolved）+ 預設 SSR + 完整 hero/coverage/features/CTA。
//   未登入訪客：SSR 渲染完整行銷頁面（爬蟲與真實用戶皆可讀）。
//   已登入訪客：hydrate 後 watch 觸發 client-side redirect 至對應角色 home（hero 閃過一瞬）。
//
// Auth 安全性：
//   - middleware/role.ts:34 `if (!authResolved) return` —— SSR 時 plugin auth.client.ts 不跑、
//     authResolved=false → role middleware SSR 早退，不會 server-side redirect。
//   - middleware/auth.ts:22 isPublicRoute('/')=true → skip。
//   - components/common/CommonBootGate.vue:23 公開路由 skip await → 不卡 12s splash。
//   - 本頁 watch handler 第一行 `if (!authStore.authResolved || !authStore.isSignIn) return`
//     —— SSR 與未登入用戶都直接 early return，navigateTo 永不在不該跑的場景觸發。
//
// 詳見 W0 偵察結論（commit message 與 PR description）。

import { resolveAuthTarget } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';

definePageMeta({ layout: 'marketing', middleware: ['role'] });

const { t } = useI18n();
const authStore = StoreAuth();
const route = useRoute();

// ── SEO/AEO meta（W1）─────────────────────────────────────
// 三語對齊 i18n.locale；useSeoMeta 自動補 og:title/og:description fallback。
useSeoMeta({
  title: () => t('landing.meta.title'),
  description: () => t('landing.meta.description'),
  ogType: 'website',
  ogTitle: () => t('landing.meta.title'),
  ogDescription: () => t('landing.meta.description'),
  ogImageAlt: () => t('landing.meta.ogImageAlt'),
  twitterCard: 'summary_large_image',
});

// ── 已登入者 client-side redirect（既有行為，未動）──────────
// 為何 page 內仍保留 watch？
//   race：URL=/ 進站，plugin/auth.client 的 InitAuthFlow 跑完前 middleware 先跑、
//   此時 authResolved=false → middleware early return；之後 authResolved 變 true 時
//   router 沒有 navigation event → middleware 不會重跑 → user 卡在本頁。
//   解法：watch authResolved + isSignIn，用 utils 算同個 target 兜底（同 SSOT 不分歧）。
watch(
  () => [authStore.authResolved, authStore.isSignIn, authStore.roles.join(','), authStore.approved],
  () => {
    if (!authStore.authResolved || !authStore.isSignIn) return;
    // 優先序 1：LIFF OAuth callback 目標
    const liffTarget = resolveLiffTarget({
      query: route.query as Record<string, string | string[] | null | undefined>,
      pathname: typeof window === 'undefined' ? undefined : window.location.pathname,
    });
    if (liffTarget && liffTarget !== route.path) {
      navigateTo(liffTarget, { replace: true });
      return;
    }
    // 優先序 2：依角色算目標（與 middleware/role.ts 共用 utils）
    const target = resolveAuthTarget({
      entryPath: route.path,
      isSignIn: authStore.isSignIn,
      roles: authStore.roles,
      approved: authStore.approved,
    });
    if (target && target !== route.path) {
      navigateTo(target, { replace: true });
    }
  },
  { immediate: true },
);

const AIRPORT_CODES = ['tpe', 'tsa', 'rmq', 'khh'] as const;
const FEATURE_IDS = ['flight', 'transparent', 'service', 'professional'] as const;

const ClickBook = () => navigateTo('/booking');
const ClickFare = () => navigateTo('/fare');
</script>

<template lang="pug">
.PageLanding
  //- ── HERO ─────────────────────────────────────────────────────
  section.PageLanding__hero
    .PageLanding__hero-bg
    .PageLanding__hero-runway

    .PageLanding__hero-inner
      p.PageLanding__hero-tag {{ $t('landing.hero.tag') }}
      h1.PageLanding__hero-title
        span.PageLanding__hero-title-display
          | {{ $t('landing.hero.titleA') }}
          br
          | {{ $t('landing.hero.titleB') }}
        span.PageLanding__hero-title-sub {{ $t('landing.hero.subtitle') }}
      .PageLanding__hero-cta
        button.PageLanding__cta-primary(type="button" @click="ClickBook") {{ $t('landing.hero.ctaPrimary') }}
        button.PageLanding__cta-secondary(type="button" @click="ClickFare") {{ $t('landing.hero.ctaSecondary') }}

  //- ── 斜紋分隔（黃黑跑道意象，與 /home /faq 風格一致）─────────────
  .PageLanding__stripe

  //- ── SERVICE OVERVIEW ────────────────────────────────────────
  section.PageLanding__section.is-overview
    .PageLanding__section-label {{ $t('landing.overview.label') }}
    h2.PageLanding__section-title {{ $t('landing.overview.heading') }}
    .PageLanding__overview-body
      p {{ $t('landing.overview.p1') }}
      p {{ $t('landing.overview.p2') }}

  //- ── COVERAGE：4 airports ───────────────────────────────────
  section.PageLanding__section.is-coverage
    .PageLanding__section-label {{ $t('landing.coverage.label') }}
    h2.PageLanding__section-title {{ $t('landing.coverage.title') }}
    p.PageLanding__section-desc {{ $t('landing.coverage.desc') }}
    .PageLanding__airports
      article.PageLanding__airport(v-for="code in AIRPORT_CODES" :key="code")
        .PageLanding__airport-code {{ $t(`landing.coverage.airports.${code}.code`) }}
        h3.PageLanding__airport-name {{ $t(`landing.coverage.airports.${code}.name`) }}
        p.PageLanding__airport-desc {{ $t(`landing.coverage.airports.${code}.desc`) }}

  .PageLanding__stripe

  //- ── FEATURES：4 cards ─────────────────────────────────────
  section.PageLanding__section.is-features
    .PageLanding__section-label {{ $t('landing.features.label') }}
    h2.PageLanding__section-title {{ $t('landing.features.title') }}
    .PageLanding__features
      article.PageLanding__feature(v-for="id in FEATURE_IDS" :key="id")
        h3.PageLanding__feature-title {{ $t(`landing.features.items.${id}.title`) }}
        p.PageLanding__feature-body {{ $t(`landing.features.items.${id}.body`) }}

  //- ── FINAL CTA ──────────────────────────────────────────────
  section.PageLanding__cta-section
    .PageLanding__cta-card
      .PageLanding__cta-label {{ $t('landing.cta.label') }}
      h2.PageLanding__cta-title {{ $t('landing.cta.title') }}
      p.PageLanding__cta-desc {{ $t('landing.cta.desc') }}
      button.PageLanding__cta-btn(type="button" @click="ClickBook")
        | {{ $t('landing.cta.btn') }}
        span.PageLanding__cta-btn-arrow →
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageLanding {
  background: var(--da-off-white);
  color: var(--da-dark);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

// ── HERO ────────────────────────────────────────────────────
.PageLanding__hero {
  position: relative;
  min-height: 100svh;
  padding-top: 56px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding-bottom: 64px;
  overflow: hidden;
}

.PageLanding__hero-bg {
  position: absolute;
  inset: 0;
  background: var(--da-cream);
  z-index: 0;
}

.PageLanding__hero-runway {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 220px;
  background: repeating-linear-gradient(
    -45deg,
    rgba(245, 200, 66, 0.12) 0px, rgba(245, 200, 66, 0.12) 20px,
    transparent 20px, transparent 40px
  );
  pointer-events: none;
  z-index: 0;
}

.PageLanding__hero-inner {
  position: relative;
  z-index: 1;
  padding: 0 24px;
  max-width: 720px;
}

.PageLanding__hero-tag {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin: 0 0 18px;
}

.PageLanding__hero-title {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.PageLanding__hero-title-display {
  font-family: $font-display;
  font-size: clamp(64px, 18vw, 128px);
  line-height: 0.9;
  letter-spacing: 0.02em;
  color: var(--da-dark);
}

.PageLanding__hero-title-sub {
  font-family: $font-body;
  font-size: clamp(14px, 3.4vw, 17px);
  font-weight: 300;
  line-height: 1.65;
  color: var(--da-gray);
  max-width: 560px;
}

.PageLanding__hero-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.PageLanding__cta-primary,
.PageLanding__cta-secondary {
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 14px 26px;
  border-radius: 100px;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s, background 0.15s;

  &:active { transform: scale(0.97); }
}

.PageLanding__cta-primary {
  background: var(--da-dark);
  color: var(--da-cream);
  border: 1px solid var(--da-dark);
  &:hover { opacity: 0.88; }
}

.PageLanding__cta-secondary {
  background: transparent;
  color: var(--da-dark);
  border: 1px solid rgba(0, 0, 0, 0.16);
  &:hover {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.24);
  }
}

// ── 斜紋分隔 ────────────────────────────────────────────────
.PageLanding__stripe {
  height: 12px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow, #F5C842) 0px, var(--da-stripe-yellow, #F5C842) 12px,
    var(--da-stripe-dark, #1A1814) 12px, var(--da-stripe-dark, #1A1814) 24px
  );
  opacity: 0.85;
}

// ── 共用 section ──────────────────────────────────────────────
.PageLanding__section {
  padding: 72px 24px;
}

.PageLanding__section.is-overview  { background: var(--da-cream); }
.PageLanding__section.is-coverage  { background: var(--da-off-white); }
.PageLanding__section.is-features  { background: var(--da-cream); }

.PageLanding__section-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    width: 24px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageLanding__section-title {
  font-family: $font-display;
  font-size: clamp(42px, 12vw, 56px);
  line-height: 0.92;
  letter-spacing: 0.01em;
  color: var(--da-dark);
  margin: 0 0 18px;
}

.PageLanding__section-desc {
  font-family: $font-body;
  font-size: 14.5px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.7;
  margin: 0 0 32px;
  max-width: 560px;
}

// ── SERVICE OVERVIEW body ────────────────────────────────────
.PageLanding__overview-body {
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

// ── COVERAGE airports grid ───────────────────────────────────
.PageLanding__airports {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  max-width: 760px;

  @media (min-width: 640px) {
    grid-template-columns: 1fr 1fr;
  }
}

.PageLanding__airport {
  background: var(--da-cream);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  padding: 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.15s, transform 0.15s;

  &:hover {
    border-color: rgba(212, 134, 10, 0.32);
    transform: translateY(-2px);
  }
}

.PageLanding__airport-code {
  font-family: $font-display;
  font-size: 32px;
  letter-spacing: 0.06em;
  color: var(--da-amber);
  line-height: 1;
  margin-bottom: 4px;
}

.PageLanding__airport-name {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  color: var(--da-dark);
  margin: 0;
  letter-spacing: 0.02em;
}

.PageLanding__airport-desc {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.65;
  margin: 0;
}

// ── FEATURES grid ───────────────────────────────────────────
.PageLanding__features {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  max-width: 760px;

  @media (min-width: 640px) {
    grid-template-columns: 1fr 1fr;
  }
}

.PageLanding__feature {
  background: var(--da-off-white);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  padding: 24px 22px;
}

.PageLanding__feature-title {
  font-family: $font-condensed;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--da-dark);
  margin: 0 0 8px;
}

.PageLanding__feature-body {
  font-family: $font-body;
  font-size: 13.5px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.75;
  margin: 0;
}

// ── CTA section ─────────────────────────────────────────────
.PageLanding__cta-section {
  padding: 64px 24px;
  background: var(--da-off-white);
}

.PageLanding__cta-card {
  background: var(--da-dark);
  color: var(--da-cream);
  border-radius: 24px;
  padding: 44px 32px;
  text-align: center;
  max-width: 640px;
  margin: 0 auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
}

.PageLanding__cta-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 12px;
}

.PageLanding__cta-title {
  font-family: $font-display;
  font-size: clamp(36px, 9vw, 48px);
  letter-spacing: 0.02em;
  color: var(--da-cream);
  margin: 0 0 12px;
}

.PageLanding__cta-desc {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: rgba(250, 248, 244, 0.75);
  line-height: 1.7;
  margin: 0 0 28px;
}

.PageLanding__cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 32px;
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
  transition: opacity 0.15s, transform 0.1s;

  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.97); }
}

.PageLanding__cta-btn-arrow {
  font-size: 16px;
}
</style>
