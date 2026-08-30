<script setup lang="ts">
import { DESIGN_COLORS } from '~shared/design-colors';
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
      color: { dark: DESIGN_COLORS.ink, light: DESIGN_COLORS.surfaceRaised },
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

/* 2026-08-30 改版（Brain AI 拍板）：舊版是整塊縞黑大底 —— 那是 cream 改版前的
   遺產，而且違反口袋航廈提案「/home 唯一縞黑面是下一趟主卡」的規則。
   改成 cream 資訊層（提案規則三：行銷降成資訊層）：底色比頁面低一階
   （off-white → cream），文字走灰階、標籤走古銅，跑道斜紋帶保留當品牌記號。 */
.CommonFooter {
  background: var(--da-cream);
  color: var(--da-dark);
}

/* 帶寬與手機底部四格上方那條（CommonTabBar__stripe）一致：10px 一節，兩端同語彙 */
.CommonFooter__stripe {
  height: 8px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-dark) 0 10px,
    var(--da-stripe-yellow) 10px 20px
  );
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
  background: var(--surface-raised);
  border-radius: var(--r-md);
  border: 1px solid var(--da-gray-pale);
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  width: 136px;
  height: 136px;
}

.CommonFooter__qr-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}

.CommonFooter__qr-card:active {
  transform: translateY(0) scale(0.97);
}

.CommonFooter__qr-img {
  display: block;
  width: 120px;
  height: 120px;
  border-radius: var(--r-xs);
  image-rendering: pixelated; // QR 邊緣清晰
}

.CommonFooter__qr-loading {
  width: 120px;
  height: 120px;
  border-radius: var(--r-xs);
  background: linear-gradient(
    90deg,
    var(--ink-a06),
    var(--ink-a12),
    var(--ink-a06)
  );
  background-size: 200% 100%;
  animation: CommonFooter-shimmer 1.2s infinite;
}

@keyframes CommonFooter-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.CommonFooter__qr-caption {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--da-gray);
  max-width: 136px;
  line-height: var(--lh-normal);
}

.CommonFooter__qr-hint {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--accent-text);
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &::before {
    content: '↗';
    font-size: var(--fs-label);
  }
}

@media (min-width: 768px) {
  .CommonFooter__qr {
    align-items: center;
    text-align: center;
  }
}

.CommonFooter__logo {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-wide);
}

.CommonFooter__logo span {
  color: var(--accent-text);
}

.CommonFooter__tagline {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--da-gray);
  margin-top: 8px;
  line-height: var(--lh-relaxed);
}

.CommonFooter__col-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--accent-text);
  margin-bottom: 12px;
}

.CommonFooter__link,
.CommonFooter__support {
  display: block;
  background: transparent;
  border: none;
  padding: 6px 0;
  color: var(--da-gray);
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  cursor: pointer;
  text-align: left;
  transition: color var(--dur-fast) var(--ease-out);
}

.CommonFooter__link:hover,
.CommonFooter__support:hover {
  color: var(--da-dark);
}

.CommonFooter__support-ext {
  color: var(--accent-text);
  margin-left: 6px;
}

.CommonFooter__hours {
  font-size: var(--fs-label);
  color: var(--da-gray-light);
  margin-top: 4px;
}

.CommonFooter__bottom {
  padding: 16px 24px;
  border-top: 1px solid var(--da-gray-pale);
  text-align: center;
}

.CommonFooter__copyright {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-caps-lg);
  color: var(--da-gray-light);
}
</style>
