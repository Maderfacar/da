<script setup lang="ts">
// Phase 1C：車輛公開檔案主元件 — 載入資料、處理 loading / 404、組 hero + gallery + tag groups + CTA
import type { VehiclePublicDto, GetVehiclePublicLang } from '@/protocol/fetch-api/api/vehicle';

interface Props {
  driverId: string;
  /** vue-i18n locale 字串（'zh' / 'en' / 'ja'）；元件內 normalize 成 zh_tw/en/ja */
  lang: string;
}
const props = defineProps<Props>();

const _normalizeLang = (l: string): GetVehiclePublicLang => {
  if (l === 'en') return 'en';
  if (l === 'ja') return 'ja';
  return 'zh_tw';
};

const profile = ref<VehiclePublicDto | null>(null);
const loading = ref(false);
const errorStatus = ref<number | null>(null);

const ApiLoadProfile = async () => {
  if (!props.driverId) return;
  loading.value = true;
  errorStatus.value = null;
  profile.value = null;
  try {
    const res = await $api.GetVehiclePublic(props.driverId, _normalizeLang(props.lang));
    if (res.status?.code === $enum.apiStatus.success) {
      profile.value = (res.data as VehiclePublicDto) ?? null;
    } else {
      errorStatus.value = res.status?.code ?? 500;
    }
  } catch {
    errorStatus.value = 500;
  } finally {
    loading.value = false;
  }
};

watch(() => [props.driverId, props.lang], ApiLoadProfile, { immediate: true });

const FormatDate = (iso: string): string => $dayjs(iso).format('YYYY/MM/DD');
</script>

<template lang="pug">
.VehiclePublicProfile
  //- loading
  .VehiclePublicProfile__loading(v-if="loading")
    .VehiclePublicProfile__spinner

  //- 404 / error
  .VehiclePublicProfile__notfound(v-else-if="!profile")
    .VehiclePublicProfile__notfound-icon 🚗
    h2.VehiclePublicProfile__notfound-title {{ $t('vehicle.public.notFound') }}
    p.VehiclePublicProfile__notfound-desc {{ $t('vehicle.public.notFoundDesc') }}
    NuxtLink.VehiclePublicProfile__notfound-link(to="/home") ← {{ $t('vehicle.public.backHome') }}

  //- 主內容
  template(v-else)
    //- Hero
    .VehiclePublicProfile__hero
      .VehiclePublicProfile__hero-label VEHICLE PROFILE
      h1.VehiclePublicProfile__driver-name
        | {{ profile.driverDisplayName }}
        span.VehiclePublicProfile__verified-badge(v-if="profile.vehicleProfile.verifiedAt")
          | ✓ {{ $t('vehicle.public.verified') }}
      .VehiclePublicProfile__hero-meta
        span.VehiclePublicProfile__meta-item
          | {{ $t('vehicle.public.completedOrders', { count: profile.completedOrders }) }}
        span.VehiclePublicProfile__meta-sep ·
        span.VehiclePublicProfile__meta-item
          | {{ $t('vehicle.public.verifiedAt', { date: FormatDate(profile.vehicleProfile.verifiedAt) }) }}

    //- Photos
    section.VehiclePublicProfile__section(v-if="profile.vehicleProfile.photos.length")
      h3.VehiclePublicProfile__section-title {{ $t('vehicle.public.photoCount', { count: profile.vehicleProfile.photos.length }) }}
      VehiclePhotoGallery(:photos="profile.vehicleProfile.photos")

    //- Vehicle tags
    section.VehiclePublicProfile__section(v-if="profile.vehicleProfile.tags.length")
      h3.VehiclePublicProfile__section-title {{ $t('vehicle.public.vehicleFeatures') }}
      VehicleTagChipGroup(:tags="profile.vehicleProfile.tags" :lang="_normalizeLang(lang)")

    //- Driver tags
    section.VehiclePublicProfile__section(v-if="profile.driverSkillTags.length")
      h3.VehiclePublicProfile__section-title {{ $t('vehicle.public.driverSkills') }}
      VehicleTagChipGroup(:tags="profile.driverSkillTags" :lang="_normalizeLang(lang)")

    //- CTA
    .VehiclePublicProfile__cta
      ElButton.VehiclePublicProfile__cta-btn(
        disabled
        type="primary"
        size="large"
      ) {{ $t('vehicle.public.bookCta') }}
      .VehiclePublicProfile__cta-hint {{ $t('vehicle.public.bookCtaHint') }}
</template>

<style lang="scss" scoped>

.VehiclePublicProfile {
  padding: 24px 16px 80px;
  max-width: 960px;
  margin: 0 auto;
  color: var(--da-dark);
  font-family: var(--ff-ui);
}

// ── loading ─────────────────────────────────────
.VehiclePublicProfile__loading {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

.VehiclePublicProfile__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--da-amber);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 404 ────────────────────────────────────────
.VehiclePublicProfile__notfound {
  text-align: center;
  padding: 60px 20px;
}

.VehiclePublicProfile__notfound-icon {
  font-size: var(--fs-hero);
  margin-bottom: 16px;
  opacity: 0.7;
}

.VehiclePublicProfile__notfound-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h1);
  letter-spacing: var(--ls-label);
  color: var(--da-dark);
  margin: 0 0 8px;
}

.VehiclePublicProfile__notfound-desc {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  color: var(--da-gray);
  margin: 0 0 24px;
}

.VehiclePublicProfile__notfound-link {
  display: inline-block;
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 10px 22px;
  border-radius: var(--r-pill);
  background: var(--da-amber);
  color: var(--surface-raised);
  text-decoration: none;

  &:hover { background: var(--da-amber-light); }
}

// ── Hero ───────────────────────────────────────
.VehiclePublicProfile__hero {
  padding: 24px 0 28px;
  border-bottom: 1px solid var(--da-gray-pale);
  margin-bottom: 24px;
}

.VehiclePublicProfile__hero-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--accent-text);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;

  &::before { content: ''; width: 24px; height: 1.5px; background: var(--da-amber); }
}

.VehiclePublicProfile__driver-name {
  font-family: var(--ff-display);
  font-size: var(--fs-h1);
  letter-spacing: var(--ls-label);
  color: var(--da-dark);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  line-height: var(--lh-tight);
}

.VehiclePublicProfile__verified-badge {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 4px 12px;
  border-radius: var(--r-pill);
  background: var(--good-a15);
  border: 1px solid var(--good-a45);
  color: var(--good);
  line-height: var(--lh-normal);
}

.VehiclePublicProfile__hero-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--da-gray);
}

.VehiclePublicProfile__meta-sep { color: var(--da-gray-light); }

// ── Section ────────────────────────────────────
.VehiclePublicProfile__section {
  margin-bottom: 32px;
}

.VehiclePublicProfile__section-title {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--da-gray);
  margin: 0 0 12px;
}

// ── CTA ────────────────────────────────────────
.VehiclePublicProfile__cta {
  margin-top: 32px;
  padding: 24px;
  border-radius: var(--r-lg);
  background: var(--da-amber-pale);
  border: 1px solid var(--hairline);
  text-align: center;
}

.VehiclePublicProfile__cta-btn {
  min-width: 200px;
}

.VehiclePublicProfile__cta-hint {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--da-gray);
  margin-top: 10px;
}
</style>
