<script setup lang="ts">
import { DESIGN_COLORS } from '~shared/design-colors';
// 推薦獎勵機制 Phase 3：LIFF 分享頁
// 設計：openspec/changes/2026-05-20-referral-share-reward/design.md §4 ② / §C4 / §8
//
// liff.shareTargetPicker() 組裝活動 Flex（CTA 連結帶 ?ref=<我的 referralCode>）；
// 非 LINE 環境（isApiAvailable=false）降級為「複製分享連結」。
import type { ReferralShareCard } from '@/protocol/fetch-api/api/referral';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();
const config = useRuntimeConfig().public;

const loading = ref(true);
const referralCode = ref('');
const enabled = ref(false);
const shareCard = ref<ReferralShareCard | null>(null);
const sharing = ref(false);

// 分享連結：優先用乘客 LIFF 連結（可在 LINE 內直接開啟），fallback 站內 /home
const shareLink = computed(() => {
  const code = referralCode.value;
  if (!code) return '';
  const liffId = config.lineLiffIdPassenger as string | undefined;
  if (liffId) return `https://liff.line.me/${liffId}?ref=${code}`;
  if (typeof window !== 'undefined') return `${window.location.origin}/home?ref=${code}`;
  return '';
});

// 分享卡欄位（空值套 i18n 預設文案）
const cardTitle = computed(() => shareCard.value?.title?.trim() || t('referral.share.defaultTitle'));
const cardBody = computed(() => shareCard.value?.body?.trim() || t('referral.share.defaultBody'));
const cardCta = computed(() => shareCard.value?.ctaLabel?.trim() || t('referral.share.defaultCta'));
const cardImage = computed(() => {
  const url = shareCard.value?.imageUrl?.trim() || '';
  return url.startsWith('https://') ? url : '';
});

const ApiLoadMe = async () => {
  loading.value = true;
  try {
    const res = await $api.GetReferralMe();
    if (res.status?.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status?.message?.zh_tw ?? t('referral.loadFailed'), type: 'error' });
      return;
    }
    referralCode.value = res.data.referralCode ?? '';
    enabled.value = res.data.campaign?.enabled ?? false;
    shareCard.value = res.data.campaign?.shareCard ?? null;
  } finally {
    loading.value = false;
  }
};

// 組推薦活動 Flex bubble（LINE Flex Message 結構）
const BuildFlexMessage = () => {
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: cardTitle.value, weight: 'bold', size: 'xl', wrap: true },
        { type: 'text', text: cardBody.value, size: 'sm', color: DESIGN_COLORS.inkSoft, wrap: true },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: DESIGN_COLORS.accent,
          action: { type: 'uri', label: cardCta.value.slice(0, 20), uri: shareLink.value },
        },
      ],
    },
  };
  if (cardImage.value) {
    bubble.hero = {
      type: 'image',
      url: cardImage.value,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }
  return { type: 'flex', altText: cardTitle.value, contents: bubble };
};

const ShareFlow = async () => {
  if (sharing.value || !shareLink.value) return;
  sharing.value = true;
  try {
    const liff = (await import('@line/liff')).default;
    const liffId = (config.lineLiffIdPassenger as string | undefined) ?? '';

    // 防禦性 liff.init：store-auth 的 _InitLiffFlow 若 timeout / chunk 分裂導致此 share.vue
    // 拿到的 liff singleton 未 init，這裡補 init 一次（LIFF SDK 對二次 init 是 no-op，安全）。
    if (liffId) {
      try {
        await liff.init({ liffId });
      } catch (initErr) {
        console.warn('[referral/share] liff.init failed:', initErr);
      }
    }

    if (!liff.isApiAvailable('shareTargetPicker')) {
      // 非 LINE 環境（桌機 / 外部瀏覽器）：降級為複製連結
      await CopyLinkFlow();
      return;
    }
    const msg = BuildFlexMessage();
    await liff.shareTargetPicker([msg] as Parameters<typeof liff.shareTargetPicker>[0]);
    ElMessage({ message: t('referral.share.sent'), type: 'success' });
  } catch (err) {
    // 使用者於 picker 取消亦會 reject — 不視為錯誤
    console.warn('[referral/share] shareTargetPicker failed or cancelled:', err);
  } finally {
    sharing.value = false;
  }
};

const CopyLinkFlow = async () => {
  if (!shareLink.value) return;
  try {
    await navigator.clipboard.writeText(shareLink.value);
    ElMessage({ message: t('referral.share.copied'), type: 'success' });
  } catch {
    ElMessage({ message: t('referral.share.copyFailed'), type: 'error' });
  }
};

const ClickShare = () => { void ShareFlow(); };
const ClickCopyLink = () => { void CopyLinkFlow(); };

onMounted(ApiLoadMe);
</script>

<template lang="pug">
.PageReferralShare
  //- 返回
  .PageReferralShare__topbar
    NuxtLink.PageReferralShare__back(to="/orders")
      span ←
      span {{ $t('referral.share.back') }}

  .PageReferralShare__header
    .PageReferralShare__header-label REFER A FRIEND
    h1.PageReferralShare__header-title {{ $t('referral.share.title') }}

  //- 載入中
  .PageReferralShare__loading(v-if="loading")
    .PageReferralShare__spinner

  //- 活動未開放（§8）
  .PageReferralShare__notice(v-else-if="!enabled")
    .PageReferralShare__notice-icon ☕
    p.PageReferralShare__notice-text {{ $t('referral.share.disabled') }}
    NuxtLink.PageReferralShare__notice-link(to="/orders") {{ $t('referral.share.back') }}

  template(v-else)
    //- 我的推薦碼
    section.PageReferralShare__code
      .PageReferralShare__code-label {{ $t('referral.share.myCode') }}
      .PageReferralShare__code-value {{ referralCode || '——' }}
      p.PageReferralShare__code-hint {{ $t('referral.share.codeHint') }}

    //- 活動卡預覽
    section.PageReferralShare__preview
      .PageReferralShare__preview-label PREVIEW
      .PageReferralShare__card
        img.PageReferralShare__card-img(
          v-if="cardImage"
          :src="cardImage"
          :alt="cardTitle"
        )
        .PageReferralShare__card-body
          .PageReferralShare__card-title {{ cardTitle }}
          p.PageReferralShare__card-text {{ cardBody }}
          .PageReferralShare__card-cta {{ cardCta }}

    //- 操作
    .PageReferralShare__actions
      button.PageReferralShare__share(
        :disabled="sharing || !referralCode"
        @click="ClickShare"
      ) {{ sharing ? $t('referral.share.sharing') : $t('referral.share.shareBtn') }}
      button.PageReferralShare__copy(
        :disabled="!referralCode"
        @click="ClickCopyLink"
      ) {{ $t('referral.share.copyBtn') }}
</template>

<style lang="scss" scoped>
// cream theme 對齊 booking / orders 家族

.PageReferralShare {
  padding: 72px 24px 0;
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}


// ── Topbar ────────────────────────────────────────────────
.PageReferralShare__topbar {
  margin-bottom: 14px;
}

.PageReferralShare__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  color: var(--da-gray);
  text-decoration: none;
  transition: color var(--dur-fast) var(--ease-out);

  &:hover { color: var(--accent-text); }
}

// ── 頁首 ──────────────────────────────────────────────────
.PageReferralShare__header {
  padding: 16px 0 28px;
}

.PageReferralShare__header-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--accent-text);
  margin-bottom: 10px;
}

.PageReferralShare__header-title {
  font-family: var(--ff-display);
  font-size: clamp(40px, 12vw, 56px);
  line-height: var(--lh-flat);
  color: var(--da-dark);
}

// ── 載入中 ────────────────────────────────────────────────
.PageReferralShare__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageReferralShare__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--da-amber);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 活動未開放 ────────────────────────────────────────────
.PageReferralShare__notice {
  text-align: center;
  padding: 56px 20px;

  &-icon { font-size: var(--fs-display); margin-bottom: 14px; }

  &-text {
    font-family: var(--ff-ui);
    font-size: var(--fs-body);
    color: var(--da-gray);
    margin-bottom: 18px;
  }

  &-link {
    display: inline-block;
    font-family: var(--ff-label);
    font-size: var(--fs-body-sm);
    font-weight: 700;
    letter-spacing: var(--ls-wide);
    padding: 9px 22px;
    border-radius: var(--r-pill);
    background: var(--da-amber);
    color: var(--surface-raised);
    text-decoration: none;
  }
}

// ── 我的推薦碼 ────────────────────────────────────────────
.PageReferralShare__code {
  background: var(--da-dark);
  border: 1px solid var(--accent-a30);
  border-radius: var(--r-xl);
  padding: 22px 18px;
  text-align: center;
  margin-bottom: 16px;
  box-shadow: var(--shadow-pop);
}

.PageReferralShare__code-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--da-amber-light);
  margin-bottom: 8px;
}

.PageReferralShare__code-value {
  font-family: var(--ff-data);
  font-size: var(--fs-display);
  letter-spacing: var(--ls-caps-lg);
  color: var(--da-cream);
  font-variant-numeric: tabular-nums;
}

.PageReferralShare__code-hint {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  line-height: var(--lh-normal);
  color: var(--surface-a60);
  margin-top: 8px;
}

// ── 活動卡預覽 ────────────────────────────────────────────
.PageReferralShare__preview {
  margin-bottom: 20px;
}

.PageReferralShare__preview-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--accent-text);
  margin-bottom: 8px;
}

.PageReferralShare__card {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
}

.PageReferralShare__card-img {
  display: block;
  width: 100%;
  aspect-ratio: 20 / 13;
  object-fit: cover;
}

.PageReferralShare__card-body {
  padding: 16px;
}

.PageReferralShare__card-title {
  font-family: var(--ff-label);
  font-size: var(--fs-h4);
  font-weight: 700;
  letter-spacing: var(--ls-snug);
  color: var(--da-dark);
  margin-bottom: 6px;
}

.PageReferralShare__card-text {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-relaxed);
  color: var(--da-gray);
  margin-bottom: 14px;
}

.PageReferralShare__card-cta {
  display: block;
  text-align: center;
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 10px;
  border-radius: var(--r-md);
  background: var(--da-amber);
  color: var(--surface-raised);
}

// ── 操作 ──────────────────────────────────────────────────
.PageReferralShare__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageReferralShare__share {
  width: 100%;
  padding: 14px;
  background: var(--line-green);
  border: 1px solid var(--line-green);
  border-radius: var(--r-md);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--surface-raised);
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) { opacity: 0.92; }
  &:active { transform: scale(0.99); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.PageReferralShare__copy {
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 1px solid var(--accent-a40);
  border-radius: var(--r-md);
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--accent-text);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) { background: var(--da-amber-pale); }
  &:active { transform: scale(0.99); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
