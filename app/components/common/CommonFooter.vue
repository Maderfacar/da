<script setup lang="ts">
// CommonFooter — 首頁與內容頁共用頁尾
// 出現範圍：/home /service /fare /faq /fleet（由各頁面自行掛載，不進 layout）

const { lineOaAddUrl } = useRuntimeConfig().public;

const links = [
  { id: 'booking', path: '/booking' },
  { id: 'fare',    path: '/fare' },
  { id: 'service', path: '/service' },
  { id: 'faq',     path: '/faq' },
  { id: 'fleet',   path: '/fleet' },
  { id: 'orders',  path: '/orders' },
  { id: 'terms',   path: '/legal/terms' },
  { id: 'privacy', path: '/legal/privacy' },
];

const ClickLink = (path: string) => navigateTo(path);

const ClickSupport = () => {
  if (lineOaAddUrl && typeof window !== 'undefined') {
    window.open(lineOaAddUrl, '_blank', 'noopener,noreferrer');
  }
};
</script>

<template lang="pug">
footer.CommonFooter
  .CommonFooter__stripe
  .CommonFooter__inner
    .CommonFooter__brand
      .CommonFooter__logo
        | DEST
        span ∙
        | ANYWHERE
      p.CommonFooter__tagline {{ $t('footer.tagline') }}

    .CommonFooter__col
      .CommonFooter__col-label {{ $t('footer.navLabel') }}
      button.CommonFooter__link(
        v-for="l in links"
        :key="l.id"
        type="button"
        @click="ClickLink(l.path)"
      ) {{ $t('footer.links.' + l.id) }}

    .CommonFooter__col
      .CommonFooter__col-label {{ $t('footer.supportLabel') }}
      button.CommonFooter__support(type="button" @click="ClickSupport")
        span {{ $t('footer.support') }}
        span.CommonFooter__support-ext ↗
      .CommonFooter__hours {{ $t('footer.supportHours') }}

  .CommonFooter__bottom
    span.CommonFooter__copyright {{ $t('footer.copyright') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.CommonFooter {
  background: var(--da-dark);
  color: var(--da-cream);
}

.CommonFooter__stripe {
  height: 12px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow) 0px, var(--da-stripe-yellow) 12px,
    var(--da-stripe-dark) 12px, var(--da-stripe-dark) 24px
  );
  opacity: 0.85;
}

.CommonFooter__inner {
  padding: 40px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.CommonFooter__logo {
  font-family: $font-display;
  font-size: 24px;
  letter-spacing: 0.08em;
}

.CommonFooter__logo span {
  color: var(--da-amber);
}

.CommonFooter__tagline {
  font-family: $font-body;
  font-size: 13px;
  color: rgba(250, 248, 244, 0.55);
  margin-top: 8px;
  line-height: 1.6;
}

.CommonFooter__col-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 12px;
}

.CommonFooter__link,
.CommonFooter__support {
  display: block;
  background: transparent;
  border: none;
  padding: 6px 0;
  color: rgba(250, 248, 244, 0.8);
  font-family: $font-body;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}

.CommonFooter__link:hover,
.CommonFooter__support:hover {
  color: var(--da-cream);
}

.CommonFooter__support-ext {
  color: var(--da-amber);
  margin-left: 6px;
}

.CommonFooter__hours {
  font-size: 12px;
  color: rgba(250, 248, 244, 0.4);
  margin-top: 4px;
}

.CommonFooter__bottom {
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  text-align: center;
}

.CommonFooter__copyright {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.15em;
  color: rgba(255, 255, 255, 0.3);
}
</style>
