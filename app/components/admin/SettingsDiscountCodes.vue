<script setup lang="ts">
// 折扣碼管理（admin/settings 內 PROMOTIONS section）
//
// 列表 + 建立 / 編輯表單（同頁切換）。停用 = enabled:false，不提供刪除。
import { ORDER_TYPES } from '~shared/pricing';
import type { DiscountCodeDto } from '@/protocol/fetch-api/api/admin/discount-code';

interface FormState {
  code: string;
  discountAmount: number | null;
  validFrom: string;
  validUntil: string;
  maxRedemptions: number | null;
  perUserLimit: number | null;
  minFare: number | null;
  allowedOrderTypes: string[];
  enabled: boolean;
}

const CODE_MAX = 32;

const emptyForm = (): FormState => ({
  code: '',
  discountAmount: null,
  validFrom: '',
  validUntil: '',
  maxRedemptions: null,
  perUserLimit: null,
  minFare: null,
  allowedOrderTypes: [],
  enabled: true,
});

const list = ref<DiscountCodeDto[]>([]);
const loading = ref(false);
const saving = ref(false);
// mode：'list' 列表 / 'create' 新建 / 'edit' 編輯（editingCode 為被編輯的碼）
const mode = ref<'list' | 'create' | 'edit'>('list');
const editingCode = ref('');
const form = reactive<FormState>(emptyForm());

const ApiLoad = async () => {
  loading.value = true;
  try {
    const res = await $api.GetDiscountCodes();
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入失敗', type: 'error' });
      return;
    }
    list.value = res.data.items;
  } finally {
    loading.value = false;
  }
};

const _IsoToDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

const ClickCreate = () => {
  Object.assign(form, emptyForm());
  editingCode.value = '';
  mode.value = 'create';
};

const ClickEdit = (d: DiscountCodeDto) => {
  Object.assign(form, {
    code: d.code,
    discountAmount: d.discountAmount,
    validFrom: _IsoToDateInput(d.validFrom),
    validUntil: _IsoToDateInput(d.validUntil),
    maxRedemptions: d.maxRedemptions,
    perUserLimit: d.perUserLimit,
    minFare: d.minFare,
    allowedOrderTypes: d.allowedOrderTypes ?? [],
    enabled: d.enabled,
  });
  editingCode.value = d.code;
  mode.value = 'edit';
};

const ClickCancel = () => {
  mode.value = 'list';
};

const ClickToggleEnabled = async (d: DiscountCodeDto) => {
  const ok = await UseAsk(d.enabled ? `確定停用折扣碼「${d.code}」？` : `確定啟用折扣碼「${d.code}」？`);
  if (!ok) return;
  const res = await $api.UpdateDiscountCode(d.code, {
    discountAmount: d.discountAmount,
    validFrom: d.validFrom,
    validUntil: d.validUntil ?? '',
    maxRedemptions: d.maxRedemptions,
    perUserLimit: d.perUserLimit,
    minFare: d.minFare,
    allowedOrderTypes: d.allowedOrderTypes,
    enabled: !d.enabled,
  });
  if (res.status?.code !== $enum.apiStatus.success) {
    ElMessage({ message: res.status?.message?.zh_tw ?? '更新失敗', type: 'error' });
    return;
  }
  ElMessage({ message: '已更新', type: 'success' });
  await ApiLoad();
};

const _ValidateForm = (): string => {
  if (mode.value === 'create' && !/^[A-Za-z0-9]{3,32}$/.test(form.code.trim())) {
    return '折扣碼必須為 3-32 碼英數字';
  }
  if (!form.discountAmount || form.discountAmount <= 0) return '折抵金額必須大於 0';
  if (!form.validUntil) return '到期日為必填';
  if (form.validFrom && form.validFrom > form.validUntil) return '生效日不可晚於到期日';
  return '';
};

const ClickSave = async () => {
  if (saving.value) return;
  const err = _ValidateForm();
  if (err) {
    ElMessage({ message: err, type: 'error' });
    return;
  }
  saving.value = true;
  try {
    const body = {
      discountAmount: form.discountAmount as number,
      validFrom: form.validFrom || null,
      validUntil: form.validUntil,
      maxRedemptions: form.maxRedemptions,
      perUserLimit: form.perUserLimit,
      minFare: form.minFare,
      allowedOrderTypes: form.allowedOrderTypes.length > 0 ? form.allowedOrderTypes : null,
      enabled: form.enabled,
    };
    const res = mode.value === 'create'
      ? await $api.CreateDiscountCode({ code: form.code.trim().toUpperCase(), ...body })
      : await $api.UpdateDiscountCode(editingCode.value, body);
    if (res.status?.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已儲存', type: 'success' });
    mode.value = 'list';
    await ApiLoad();
  } finally {
    saving.value = false;
  }
};

const FormatDate = (iso: string | null) => (iso ? $dayjs(iso).format('YYYY-MM-DD') : '—');
const RedemptionLabel = (d: DiscountCodeDto) =>
  `${d.redemptionCount} / ${d.maxRedemptions ?? '∞'}`;

onMounted(() => { void ApiLoad(); });
</script>

<template lang="pug">
.SettingsDiscountCodes
  //- ── 列表模式 ──────────────────────────────────────────
  template(v-if="mode === 'list'")
    .SettingsDiscountCodes__toolbar
      button.SettingsDiscountCodes__btn.is-approve(@click="ClickCreate") + 新增折扣碼

    .SettingsDiscountCodes__loading(v-if="loading") 載入中…

    template(v-else)
      .SettingsDiscountCodes__empty(v-if="list.length === 0") 目前沒有折扣碼

      .SettingsDiscountCodes__list(v-else)
        .SettingsDiscountCodes__item(
          v-for="d in list"
          :key="d.code"
          :class="{ 'is-disabled': !d.enabled }"
        )
          .SettingsDiscountCodes__item-main
            .SettingsDiscountCodes__item-code {{ d.code }}
            .SettingsDiscountCodes__item-meta
              span 折抵 NT${{ d.discountAmount }}
              span · {{ FormatDate(d.validFrom) }} ~ {{ FormatDate(d.validUntil) }}
              span · 已用 {{ RedemptionLabel(d) }}
          .SettingsDiscountCodes__item-actions
            span.SettingsDiscountCodes__badge(:class="d.enabled ? 'is-on' : 'is-off'")
              | {{ d.enabled ? '啟用中' : '已停用' }}
            button.SettingsDiscountCodes__btn.is-toggle(@click="ClickEdit(d)") 編輯
            button.SettingsDiscountCodes__btn.is-toggle(@click="ClickToggleEnabled(d)")
              | {{ d.enabled ? '停用' : '啟用' }}

  //- ── 建立 / 編輯表單 ───────────────────────────────────
  template(v-else)
    .SettingsDiscountCodes__form-title
      | {{ mode === 'create' ? '新增折扣碼' : `編輯折扣碼：${editingCode}` }}

    .SettingsDiscountCodes__field(v-if="mode === 'create'")
      label.SettingsDiscountCodes__label 折扣碼（3-32 碼英數字，自動轉大寫）
      ElInput(
        v-model="form.code"
        :maxlength="CODE_MAX"
        placeholder="例：WELCOME100"
      )

    .SettingsDiscountCodes__grid
      .SettingsDiscountCodes__field
        label.SettingsDiscountCodes__label 折抵金額（NT$）
        ElInput(v-model.number="form.discountAmount" type="number" inputmode="numeric" maxlength="9")
      .SettingsDiscountCodes__field
        label.SettingsDiscountCodes__label 生效日（留空＝立即生效）
        ElInput(v-model="form.validFrom" type="date")
      .SettingsDiscountCodes__field
        label.SettingsDiscountCodes__label 到期日
        ElInput(v-model="form.validUntil" type="date")
      .SettingsDiscountCodes__field
        label.SettingsDiscountCodes__label 全域總量上限（留空＝不限）
        ElInput(v-model.number="form.maxRedemptions" type="number" inputmode="numeric" maxlength="9")
      .SettingsDiscountCodes__field
        label.SettingsDiscountCodes__label 每人次數上限（留空＝不限）
        ElInput(v-model.number="form.perUserLimit" type="number" inputmode="numeric" maxlength="9")
      .SettingsDiscountCodes__field
        label.SettingsDiscountCodes__label 最低車資門檻（留空＝無門檻）
        ElInput(v-model.number="form.minFare" type="number" inputmode="numeric" maxlength="9")

    .SettingsDiscountCodes__field
      label.SettingsDiscountCodes__label 適用行程類型（不選＝全部適用）
      .SettingsDiscountCodes__types
        label.SettingsDiscountCodes__type(v-for="ot in ORDER_TYPES" :key="ot.value")
          input(type="checkbox" :value="ot.value" v-model="form.allowedOrderTypes")
          span {{ ot.label }}

    .SettingsDiscountCodes__field
      label.SettingsDiscountCodes__switch
        input(type="checkbox" v-model="form.enabled")
        span 啟用此折扣碼

    .SettingsDiscountCodes__actions
      button.SettingsDiscountCodes__btn.is-approve(:disabled="saving" @click="ClickSave")
        | {{ saving ? '儲存中…' : '儲存' }}
      button.SettingsDiscountCodes__btn.is-toggle(:disabled="saving" @click="ClickCancel") 取消
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$border: rgba(255, 255, 255, 0.08);
$muted: rgba(255, 255, 255, 0.5);

.SettingsDiscountCodes {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.SettingsDiscountCodes__toolbar {
  display: flex;
  justify-content: flex-end;
}

.SettingsDiscountCodes__loading,
.SettingsDiscountCodes__empty {
  padding: 32px;
  text-align: center;
  color: $muted;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
}

.SettingsDiscountCodes__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.SettingsDiscountCodes__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid $border;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.SettingsDiscountCodes__item.is-disabled {
  opacity: 0.55;
}

.SettingsDiscountCodes__item-code {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 18px;
  letter-spacing: 0.06em;
  color: $amber;
}

.SettingsDiscountCodes__item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  margin-top: 2px;
}

.SettingsDiscountCodes__item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.SettingsDiscountCodes__badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  border-radius: 100px;
  padding: 2px 8px;
  border: 1px solid;
}

.SettingsDiscountCodes__badge.is-on {
  color: #4ade80;
  border-color: rgba(74, 222, 128, 0.4);
  background: rgba(74, 222, 128, 0.1);
}

.SettingsDiscountCodes__badge.is-off {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}

.SettingsDiscountCodes__form-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: $amber;
}

.SettingsDiscountCodes__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.SettingsDiscountCodes__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.SettingsDiscountCodes__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.7);
}

.SettingsDiscountCodes__types {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.SettingsDiscountCodes__type {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}

.SettingsDiscountCodes__switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}

.SettingsDiscountCodes__actions {
  display: flex;
  gap: 10px;
  padding-top: 4px;
}

.SettingsDiscountCodes__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 18px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.SettingsDiscountCodes__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.SettingsDiscountCodes__btn.is-approve {
  background: $amber;
  color: #fff;
}

.SettingsDiscountCodes__btn.is-approve:hover:not(:disabled) {
  background: #b8730a;
}

.SettingsDiscountCodes__btn.is-toggle {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.75);
}

.SettingsDiscountCodes__btn.is-toggle:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

@media (max-width: 767.98px) {
  .SettingsDiscountCodes__grid { grid-template-columns: 1fr; }
}
</style>
