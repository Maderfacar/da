<script setup lang="ts">
// 推薦獎勵機制 Phase 4：admin 推薦活動管理頁
//
// 兩個 tab：
//   - 活動設定：kill-switch 開關 + 獎勵參數表單 + 分享卡編輯
//   - 推薦紀錄：referrals 列表，異常列（單人 rewarded 數超門檻）紅字標示
//
// 權限：canManageFleet（server 端 GET/PUT 強制；非授權者 API 回 403，頁面顯示錯誤）
import type {
  ReferralCampaignConfig,
  ReferralRecordItem,
  ReferralRecordStatus,
} from '@/protocol/fetch-api/api/admin/referral';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

type MainTab = 'settings' | 'records';

const MAIN_TABS: Array<{ key: MainTab; label: string }> = [
  { key: 'settings', label: '活動設定' },
  { key: 'records', label: '推薦紀錄' },
];

const activeTab = ref<MainTab>('settings');

// ── 獎勵參數欄位定義 ──────────────────────────────────────────
type NumericKey =
  | 'welcomeAmount'
  | 'rewardAmount'
  | 'welcomeValidityDays'
  | 'rewardValidityDays'
  | 'minFare'
  | 'pendingTtlDays'
  | 'anomalyThreshold';

interface NumericFieldDef {
  key: NumericKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

const NUMERIC_FIELDS: NumericFieldDef[] = [
  { key: 'welcomeAmount', label: '歡迎碼金額', hint: '被推薦新人領到的折扣金額（NT$）', min: 1, max: 100000, step: 10 },
  { key: 'rewardAmount', label: '推薦獎勵碼金額', hint: '推薦人取得的折扣金額（NT$）', min: 1, max: 100000, step: 10 },
  { key: 'welcomeValidityDays', label: '歡迎碼效期', hint: '鑄碼後的有效天數', min: 1, max: 3650, step: 1 },
  { key: 'rewardValidityDays', label: '推薦獎勵碼效期', hint: '鑄碼後的有效天數', min: 1, max: 3650, step: 1 },
  { key: 'minFare', label: '最低車資門檻', hint: '兩碼皆套用；低於此車資不可折抵（NT$）', min: 0, max: 1000000, step: 50 },
  { key: 'pendingTtlDays', label: 'pending 過期天數', hint: '被推薦人未完成首單的保留天數', min: 1, max: 3650, step: 1 },
  { key: 'anomalyThreshold', label: '異常偵測門檻', hint: '單人 rewarded 數超過即於紀錄頁標紅', min: 1, max: 100000, step: 1 },
];

// ── 活動設定狀態 ──────────────────────────────────────────────
const form = reactive<ReferralCampaignConfig>({
  enabled: false,
  welcomeAmount: 150,
  rewardAmount: 150,
  welcomeValidityDays: 90,
  rewardValidityDays: 60,
  minFare: 500,
  pendingTtlDays: 30,
  anomalyThreshold: 50,
  shareCard: { title: '', imageUrl: '', body: '', ctaLabel: '' },
});

const campaignLoading = ref(false);
const campaignSaving = ref(false);
const campaignError = ref('');

const ApiLoadCampaign = async () => {
  campaignLoading.value = true;
  campaignError.value = '';
  try {
    const res = await $api.GetAdminReferralCampaign();
    if (res.status.code !== $enum.apiStatus.success) {
      campaignError.value = res.status.message?.zh_tw || '載入活動設定失敗';
      return;
    }
    const c = res.data?.campaign;
    if (c) {
      form.enabled = c.enabled;
      form.welcomeAmount = c.welcomeAmount;
      form.rewardAmount = c.rewardAmount;
      form.welcomeValidityDays = c.welcomeValidityDays;
      form.rewardValidityDays = c.rewardValidityDays;
      form.minFare = c.minFare;
      form.pendingTtlDays = c.pendingTtlDays;
      form.anomalyThreshold = c.anomalyThreshold;
      form.shareCard = {
        title: c.shareCard?.title ?? '',
        imageUrl: c.shareCard?.imageUrl ?? '',
        body: c.shareCard?.body ?? '',
        ctaLabel: c.shareCard?.ctaLabel ?? '',
      };
    }
  } finally {
    campaignLoading.value = false;
  }
};

const ClickSaveCampaign = async () => {
  // 數值欄位 ElInputNumber 已限制範圍；此處再防 null（清空時）
  for (const f of NUMERIC_FIELDS) {
    const v = form[f.key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < f.min || v > f.max) {
      ElMessage({ message: `「${f.label}」必須為 ${f.min}–${f.max} 之間的整數`, type: 'warning' });
      return;
    }
  }
  campaignSaving.value = true;
  try {
    const res = await $api.PutAdminReferralCampaign({
      enabled: form.enabled,
      welcomeAmount: form.welcomeAmount,
      rewardAmount: form.rewardAmount,
      welcomeValidityDays: form.welcomeValidityDays,
      rewardValidityDays: form.rewardValidityDays,
      minFare: form.minFare,
      pendingTtlDays: form.pendingTtlDays,
      anomalyThreshold: form.anomalyThreshold,
      shareCard: {
        title: form.shareCard.title.trim(),
        imageUrl: form.shareCard.imageUrl.trim(),
        body: form.shareCard.body.trim(),
        ctaLabel: form.shareCard.ctaLabel.trim(),
      },
    });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '活動設定已儲存', type: 'success' });
    await ApiLoadCampaign();
  } finally {
    campaignSaving.value = false;
  }
};

// ── 推薦紀錄狀態 ──────────────────────────────────────────────
const STATUS_LABEL: Record<ReferralRecordStatus, string> = {
  pending: '待完成首單',
  qualified: '已達標',
  rewarded: '已發獎勵',
  expired: '已過期',
};

const records = ref<ReferralRecordItem[]>([]);
const recordsAnomalyThreshold = ref(50);
const recordsLoading = ref(false);
const recordsError = ref('');
const recordsLoaded = ref(false);

const anomalyCount = computed(() => records.value.filter((r) => r.anomaly).length);

const ApiLoadRecords = async () => {
  recordsLoading.value = true;
  recordsError.value = '';
  try {
    const res = await $api.GetAdminReferralRecords();
    if (res.status.code !== $enum.apiStatus.success) {
      recordsError.value = res.status.message?.zh_tw || '載入推薦紀錄失敗';
      records.value = [];
      return;
    }
    records.value = res.data?.items ?? [];
    recordsAnomalyThreshold.value = res.data?.anomalyThreshold ?? 50;
    recordsLoaded.value = true;
  } finally {
    recordsLoading.value = false;
  }
};

const ClickTab = (tab: MainTab) => {
  activeTab.value = tab;
  if (tab === 'records' && !recordsLoaded.value) void ApiLoadRecords();
};

const FormatTime = (millis: number | null): string => {
  if (!millis) return '—';
  return $dayjs(millis).format('YYYY/MM/DD HH:mm');
};

const ShortUid = (uid: string): string => (uid.length > 16 ? `${uid.slice(0, 16)}…` : uid || '—');

onMounted(() => {
  void ApiLoadCampaign();
});
</script>

<template lang="pug">
.PageReferral
  .PageReferral__header
    h1.PageReferral__title 推薦獎勵管理
    p.PageReferral__sub Referral Reward Campaign

  //- Tab 切換
  .PageReferral__tabs
    button.PageReferral__tab(
      v-for="tab in MAIN_TABS"
      :key="tab.key"
      :class="{ 'is-active': activeTab === tab.key }"
      @click="ClickTab(tab.key)"
    ) {{ tab.label }}

  //- ── 活動設定 tab ─────────────────────────────────────────
  .PageReferral__panel(v-if="activeTab === 'settings'")
    p.PageReferral__error(v-if="campaignError") {{ campaignError }}

    //- kill-switch
    .PageReferral__section
      .PageReferral__switch-row
        .PageReferral__switch-text
          span.PageReferral__switch-label 活動開關
          span.PageReferral__switch-hint 關閉時推薦綁定一律拒絕、乘客端分享卡不顯示
        ElSwitch(v-model="form.enabled" :disabled="campaignLoading")

    //- 獎勵參數
    .PageReferral__section
      h2.PageReferral__section-title 獎勵參數
      .PageReferral__grid
        .PageReferral__field(v-for="f in NUMERIC_FIELDS" :key="f.key")
          label.PageReferral__label {{ f.label }}
          ElInputNumber(
            v-model="form[f.key]"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            step-strictly
            controls-position="right"
            :disabled="campaignLoading"
          )
          span.PageReferral__hint {{ f.hint }}

    //- 分享卡
    .PageReferral__section
      h2.PageReferral__section-title 分享卡內容
      p.PageReferral__section-desc 乘客分享頁的活動卡文案（標題 / 圖片 / 內文 / 按鈕文字）。
      .PageReferral__card-fields
        .PageReferral__field
          label.PageReferral__label 標題
          ElInput(v-model="form.shareCard.title" maxlength="100" show-word-limit placeholder="例：送你 NT$150 搭車金" :disabled="campaignLoading")
        .PageReferral__field
          label.PageReferral__label 圖片網址
          ElInput(v-model="form.shareCard.imageUrl" maxlength="2000" placeholder="https://..." :disabled="campaignLoading")
        .PageReferral__field
          label.PageReferral__label 按鈕文字
          ElInput(v-model="form.shareCard.ctaLabel" maxlength="40" show-word-limit placeholder="例：立即領取" :disabled="campaignLoading")
        .PageReferral__field
          label.PageReferral__label 內文
          ElInput(
            v-model="form.shareCard.body"
            type="textarea"
            :rows="4"
            maxlength="1000"
            show-word-limit
            placeholder="活動說明文字"
            :disabled="campaignLoading"
          )

      //- 圖片預覽
      .PageReferral__preview(v-if="form.shareCard.imageUrl")
        span.PageReferral__label 圖片預覽
        img.PageReferral__preview-img(:src="form.shareCard.imageUrl" alt="分享卡圖片預覽")

    .PageReferral__actions
      UiButton(type="primary" :loading="campaignSaving" :disabled="campaignLoading" @click="ClickSaveCampaign") 儲存設定

  //- ── 推薦紀錄 tab ─────────────────────────────────────────
  .PageReferral__panel(v-else)
    .PageReferral__records-bar
      p.PageReferral__hint
        | 異常門檻：{{ recordsAnomalyThreshold }} —— 單一推薦人 rewarded 數超過即標紅（不擋綁定，僅提示）
      span.PageReferral__anomaly-count(v-if="anomalyCount > 0") 異常 {{ anomalyCount }} 筆
      UiButton(type="secondary" :loading="recordsLoading" @click="ApiLoadRecords") 重新整理

    p.PageReferral__error(v-if="recordsError") {{ recordsError }}

    .PageReferral__table-wrap
      table.PageReferral__table
        thead
          tr
            th(style="width:150px") 綁定時間
            th(style="width:150px") 被推薦人
            th(style="width:150px") 推薦人
            th(style="width:90px") 推薦碼
            th(style="width:110px") 狀態
            th(style="width:90px") 推薦人累計
            th 鑄碼
        tbody
          tr.PageReferral__row(
            v-for="rec in records"
            :key="rec.refereeUid"
            :class="{ 'is-anomaly': rec.anomaly }"
          )
            td {{ FormatTime(rec.createdAt) }}
            td.PageReferral__uid {{ ShortUid(rec.refereeUid) }}
            td.PageReferral__uid {{ ShortUid(rec.referrerUid) }}
            td.PageReferral__code {{ rec.referrerCode || '—' }}
            td
              span.PageReferral__badge(:class="`is-${rec.status}`") {{ STATUS_LABEL[rec.status] }}
            td.PageReferral__count(:class="{ 'is-anomaly': rec.anomaly }")
              | {{ rec.referrerRewardedCount }}
              span.PageReferral__anomaly-tag(v-if="rec.anomaly") ⚠ 異常
            td.PageReferral__codes
              .PageReferral__code-line(v-if="rec.welcomeCodeId") 歡迎：{{ rec.welcomeCodeId }}
              .PageReferral__code-line(v-if="rec.rewardCodeId") 獎勵：{{ rec.rewardCodeId }}
              span(v-if="!rec.welcomeCodeId && !rec.rewardCodeId") —

      .PageReferral__empty(v-if="!recordsLoading && records.length === 0") 尚無推薦紀錄
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageReferral {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.PageReferral__header { margin-bottom: 20px; }

.PageReferral__title {
  font-family: $font-display;
  font-size: 32px;
  color: var(--da-dark);
  letter-spacing: 0.04em;
}

.PageReferral__sub {
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--da-gray);
  text-transform: uppercase;
  margin-top: 4px;
}

// ── Tabs ───────────────────────────────────────────────────
.PageReferral__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--da-gray-pale);
  margin-bottom: 20px;
}

.PageReferral__tab {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--da-gray);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.PageReferral__tab:hover { color: var(--da-dark); }

.PageReferral__tab.is-active {
  color: var(--da-amber);
  border-bottom-color: var(--da-amber);
}

// ── Panel / Section ────────────────────────────────────────
.PageReferral__panel { animation: fade-in 0.2s ease; }

@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.PageReferral__section {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-gray-pale);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.PageReferral__section-title {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--da-dark);
  margin-bottom: 4px;
}

.PageReferral__section-desc {
  font-family: $font-body;
  font-size: 13px;
  color: var(--da-gray);
  margin-bottom: 16px;
}

// ── kill-switch ────────────────────────────────────────────
.PageReferral__switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.PageReferral__switch-text { display: flex; flex-direction: column; gap: 4px; }

.PageReferral__switch-label {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  color: var(--da-dark);
}

.PageReferral__switch-hint {
  font-family: $font-body;
  font-size: 13px;
  color: var(--da-gray);
}

// ── 參數 grid ──────────────────────────────────────────────
.PageReferral__grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  margin-top: 12px;
}

.PageReferral__card-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.PageReferral__field { display: flex; flex-direction: column; gap: 6px; }

.PageReferral__label {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--da-gray);
}

.PageReferral__hint {
  font-family: $font-body;
  font-size: 12px;
  color: var(--da-gray);
  line-height: 1.4;
}

// ── 圖片預覽 ───────────────────────────────────────────────
.PageReferral__preview {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageReferral__preview-img {
  max-width: 320px;
  max-height: 200px;
  border-radius: 10px;
  border: 1px solid var(--da-gray-pale);
  object-fit: cover;
}

// ── actions ────────────────────────────────────────────────
.PageReferral__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.PageReferral__error {
  color: #e74c3c;
  font-family: $font-body;
  font-size: 14px;
  margin-bottom: 12px;
}

// ── 紀錄 tab ───────────────────────────────────────────────
.PageReferral__records-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.PageReferral__records-bar .PageReferral__hint { flex: 1; min-width: 240px; }

.PageReferral__anomaly-count {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #e74c3c;
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
  padding: 4px 10px;
  border-radius: 100px;
}

.PageReferral__table-wrap {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-gray-pale);
  border-radius: 12px;
  overflow: hidden;
}

.PageReferral__table {
  width: 100%;
  border-collapse: collapse;
  font-family: $font-body;
  font-size: 13px;

  thead {
    background: var(--da-dark);
    color: #fff;
  }

  th {
    text-align: left;
    padding: 12px 14px;
    font-family: $font-condensed;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 700;
  }

  td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--da-gray-pale);
    vertical-align: top;
    color: var(--da-dark);
  }
}

.PageReferral__row.is-anomaly td { background: rgba(231, 76, 60, 0.06); }

.PageReferral__uid {
  font-family: monospace;
  font-size: 11px;
  color: var(--da-gray);
  word-break: break-all;
}

.PageReferral__code {
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--da-dark);
}

.PageReferral__badge {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 10px;
  border-radius: 100px;

  &.is-pending   { background: rgba(127, 140, 141, 0.12); color: #7f8c8d; border: 1px solid rgba(127, 140, 141, 0.3); }
  &.is-qualified { background: rgba(52, 152, 219, 0.12);  color: #3498db; border: 1px solid rgba(52, 152, 219, 0.3); }
  &.is-rewarded  { background: rgba(39, 174, 96, 0.12);   color: #27ae60; border: 1px solid rgba(39, 174, 96, 0.3); }
  &.is-expired   { background: rgba(189, 195, 199, 0.18); color: #95a5a6; border: 1px solid rgba(189, 195, 199, 0.4); }
}

.PageReferral__count {
  font-family: $font-condensed;
  font-size: 14px;
  font-weight: 700;
  color: var(--da-dark);

  &.is-anomaly { color: #e74c3c; }
}

.PageReferral__anomaly-tag {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: #e74c3c;
  margin-top: 2px;
}

.PageReferral__codes {
  font-family: monospace;
  font-size: 11px;
  color: var(--da-gray);
}

.PageReferral__code-line { word-break: break-all; }

.PageReferral__empty {
  padding: 60px 16px;
  text-align: center;
  color: var(--da-gray);
  font-family: $font-body;
}

@media (max-width: 768px) {
  .PageReferral {
    padding: 16px;
  }

  .PageReferral__grid { grid-template-columns: 1fr; }

  .PageReferral__table { font-size: 11px; }

  .PageReferral__table th,
  .PageReferral__table td { padding: 8px; }
}
</style>
