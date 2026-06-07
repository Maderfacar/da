<script setup lang="ts">
// CommonFooter — 乘客端共用頁尾
// 由 front-desk layout 統一掛載，所有 layout: 'front-desk' 頁面皆顯示
//
// QR Code（2026-06-07 升級）：
//   - 用 qrcode 套件 client-side 動態生成 lineOaAddUrl 的可掃描 QR（base64 PNG）
//   - 點擊 navigator.share() 分享 OA URL；不支援時 fallback 複製連結 + Toast；最終 fallback 開新分頁

const { lineOaAddUrl } = useRuntimeConfig().public;
const { t } = useI18n();
const { showToast } = useToast();

const qrSrc = ref<string>('');
const qrError = ref(false);

onMounted(async () => {
  if (!lineOaAddUrl) {
    qrError.value = true;
    return;
  }
  try {
    const QRCode = (await import('qrcode')).default;
    qrSrc.value = await QRCode.toDataURL(lineOaAddUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#0f1115', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  } catch {
    qrError.value = true;
  }
});

const links = [
  { id: 'booking', path: '/booking' },
  { id: 'fare',    path: '/fare' },
  { id: 'faq',     path: '/faq' },
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

// QR card 點擊：分享 LINE OA URL（手機原生分享 sheet → fallback 複製連結 → fallback 開新分頁）
const ClickQrShare = async () => {
  if (!lineOaAddUrl || typeof navigator === 'undefined') return;

  const shareData: ShareData = {
    title: t('footer.lineQrLabel'),
    text: t('footer.lineQrCaption'),
    url: lineOaAddUrl,
  };

  // 1. Web Share API（手機優先）
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      // 使用者取消 → 不再 fallback
      if ((err as { name?: string }).name === 'AbortError') return;
      // 其他錯誤 → 繼續 fallback
    }
  }

  // 2. Clipboard 複製連結
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(lineOaAddUrl);
      showToast(t('footer.lineQrCopied'));
      return;
    } catch {
      // fallthrough
    }
  }

  // 3. 終極 fallback：開新分頁
  window.open(lineOaAddUrl, '_blank', 'noopener,noreferrer');
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

    //- LINE 官方帳號 QR Code（每頁顯示；qrcode lib 動態生成可掃描，點擊分享）
    .CommonFooter__qr
      .CommonFooter__col-label {{ $t('footer.lineQrLabel') }}
      button.CommonFooter__qr-card(
        type="button"
        :aria-label="$t('footer.lineQrShare')"
        @click="ClickQrShare"
      )
        ClientOnly
          img.CommonFooter__qr-img(
            v-if="qrSrc"
            :src="qrSrc"
            alt="LINE QR Code"
            width="120"
            height="120"
          )
          //- 載入中 / 失敗時顯示 SVG fallback placeholder
          img.CommonFooter__qr-img(
            v-else-if="qrError"
            src="/img/line-qr.svg"
            alt="LINE QR Placeholder"
            width="120"
            height="120"
          )
          .CommonFooter__qr-loading(v-else)
          template(#fallback)
            .CommonFooter__qr-loading
      .CommonFooter__qr-caption {{ $t('footer.lineQrCaption') }}
      .CommonFooter__qr-hint {{ $t('footer.lineQrShareHint') }}

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
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: #fff;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  width: 136px;
  height: 136px;
}

.CommonFooter__qr-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}

.CommonFooter__qr-card:active {
  transform: translateY(0) scale(0.97);
}

.CommonFooter__qr-img {
  display: block;
  width: 120px;
  height: 120px;
  border-radius: 4px;
  image-rendering: pixelated; // QR 邊緣清晰
}

.CommonFooter__qr-loading {
  width: 120px;
  height: 120px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04),
    rgba(0, 0, 0, 0.1),
    rgba(0, 0, 0, 0.04)
  );
  background-size: 200% 100%;
  animation: CommonFooter-shimmer 1.2s infinite;
}

@keyframes CommonFooter-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.CommonFooter__qr-caption {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: rgba(250, 248, 244, 0.5);
  max-width: 136px;
  line-height: 1.4;
}

.CommonFooter__qr-hint {
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--da-amber);
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &::before {
    content: '↗';
    font-size: 11px;
  }
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
