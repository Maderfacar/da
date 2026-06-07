<script setup lang="ts">
// CommonFooter — 乘客端共用頁尾
// 由 front-desk layout 統一掛載，所有 layout: 'front-desk' 頁面皆顯示

const { lineOaAddUrl } = useRuntimeConfig().public;

// QR 圖檔：優先用 PNG（請放置 `public/img/line-qr.png`），讀不到時 fallback 到 SVG placeholder
const qrSrc = ref('/img/line-qr.png');
const OnQrError = () => {
  if (qrSrc.value !== '/img/line-qr.svg') qrSrc.value = '/img/line-qr.svg';
};

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

    //- LINE 官方帳號 QR Code（每頁顯示，桌機右側、手機底部）
    .CommonFooter__qr
      .CommonFooter__col-label {{ $t('footer.lineQrLabel') }}
      a.CommonFooter__qr-card(
        :href="lineOaAddUrl || '#'"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="$t('footer.lineQrLabel')"
      )
        img.CommonFooter__qr-img(
          :src="qrSrc"
          alt="LINE QR Code"
          width="120"
          height="120"
          loading="lazy"
          @error="OnQrError"
        )
      .CommonFooter__qr-caption {{ $t('footer.lineQrCaption') }}

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
  display: grid;
  grid-template-columns: 1fr;
  gap: 28px;

  @media (min-width: 768px) {
    grid-template-columns: 1.4fr 1fr 1fr auto;
    gap: 32px;
    align-items: start;
    max-width: 1200px;
    margin: 0 auto;
    padding: 56px 32px 32px;
  }
}

.CommonFooter__qr {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.CommonFooter__qr-card {
  display: inline-flex;
  padding: 8px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.CommonFooter__qr-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}

.CommonFooter__qr-img {
  display: block;
  width: 120px;
  height: 120px;
  border-radius: 4px;
}

.CommonFooter__qr-caption {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: rgba(250, 248, 244, 0.5);
  max-width: 136px;
  line-height: 1.4;
}

@media (min-width: 768px) {
  .CommonFooter__qr {
    align-items: center;
    text-align: center;
  }
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
