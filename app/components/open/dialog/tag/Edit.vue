<script setup lang="ts">
// Phase 1A：標籤編輯彈窗（OpenDialogTagEdit）
//
// mode='create'：可選群組；scope 依群組自動帶；sortOrder 由 server 自動帶
// mode='edit'：group 鎖死不可改（design §4.4）；其餘可改
//
// 表單僅做 client-side 基本檢查；最終由 server validateTagInput 驗證。
import { TAG_GROUPS, type TagGroup, type TagScope } from '~shared/tagTaxonomy';
import { validateTagInput } from '~shared/tagValidation';
import type { TagDto } from '@/protocol/fetch-api/api/tag';

interface DialogTagEditParamsLocal {
  mode: 'create' | 'edit';
  group?: TagGroup;
  id?: string;
}

export type TagEditResult = 'saved' | 'cancelled';

interface Props {
  params: DialogTagEditParamsLocal;
  resolve: (value: TagEditResult) => void;
  level: number;
}
const props = defineProps<Props>();
const emit = defineEmits<{ 'on-close': [] }>();

const visible = ref(true);
const loading = ref(false);
const submitting = ref(false);

const groupOptions = (Object.keys(TAG_GROUPS) as TagGroup[])
  .map((g) => ({ value: g, label: TAG_GROUPS[g].label.zh_tw }));

const form = reactive({
  nameZh: '',
  nameEn: '',
  nameJa: '',
  group: props.params.group ?? ('power' as TagGroup),
  surchargeAmount: 0,
  sortOrder: undefined as number | undefined,
});

const scopeForCurrentGroup = computed<TagScope>(() => TAG_GROUPS[form.group].scope);

const isEdit = computed(() => props.params.mode === 'edit');

const dialogTitle = computed(() =>
  isEdit.value
    ? '編輯標籤'
    : '新增標籤',
);

const ApiLoadDetail = async () => {
  if (!isEdit.value || !props.params.id) return;
  loading.value = true;
  try {
    // 用 list 端點取單筆（避免新增 [id].get.ts；資料量小，effort/value 不成比例）
    const res = await $api.GetTagList();
    if (res.status?.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入失敗', type: 'error' });
      visible.value = false;
      return;
    }
    const found = (res.data?.tags ?? []).find((t: TagDto) => t.id === props.params.id);
    if (!found) {
      ElMessage({ message: '找不到該標籤', type: 'error' });
      visible.value = false;
      return;
    }
    form.nameZh = found.name.zh_tw;
    form.nameEn = found.name.en;
    form.nameJa = found.name.ja;
    form.group = found.group;
    form.surchargeAmount = found.surchargeAmount;
    form.sortOrder = found.sortOrder;
  } finally {
    loading.value = false;
  }
};

const ClickCancel = () => {
  visible.value = false;
  props.resolve('cancelled');
  emit('on-close');
};

const HandleClosed = () => {
  // ElDialog after-close 統一觸發
  emit('on-close');
};

const SaveFlow = async () => {
  if (submitting.value) return;

  const input = {
    name: {
      zh_tw: form.nameZh,
      en: form.nameEn || undefined,
      ja: form.nameJa || undefined,
    },
    group: form.group,
    scope: scopeForCurrentGroup.value,
    surchargeAmount: form.surchargeAmount,
    sortOrder: form.sortOrder,
  };

  const errors = validateTagInput(input, { isUpdate: isEdit.value });
  if (errors.length > 0) {
    ElMessage({
      message: `欄位驗證失敗：${errors.map((e) => `${e.field}(${e.code})`).join(', ')}`,
      type: 'error',
    });
    return;
  }

  submitting.value = true;
  try {
    if (isEdit.value && props.params.id) {
      const res = await $api.UpdateTag(props.params.id, {
        name: {
          zh_tw: form.nameZh,
          en: form.nameEn,
          ja: form.nameJa,
        },
        surchargeAmount: form.surchargeAmount,
        sortOrder: form.sortOrder,
      });
      if (res.status?.code !== $enum.apiStatus.success) {
        ElMessage({ message: res.status?.message?.zh_tw ?? '更新失敗', type: 'error' });
        return;
      }
      ElMessage({ message: '已更新', type: 'success' });
    } else {
      const res = await $api.CreateTag({
        name: {
          zh_tw: form.nameZh,
          ...(form.nameEn ? { en: form.nameEn } : {}),
          ...(form.nameJa ? { ja: form.nameJa } : {}),
        },
        group: form.group,
        scope: scopeForCurrentGroup.value,
        surchargeAmount: form.surchargeAmount,
        ...(form.sortOrder !== undefined ? { sortOrder: form.sortOrder } : {}),
      });
      if (res.status?.code !== $enum.apiStatus.success) {
        ElMessage({ message: res.status?.message?.zh_tw ?? '新增失敗', type: 'error' });
        return;
      }
      ElMessage({ message: '已新增', type: 'success' });
    }
    visible.value = false;
    props.resolve('saved');
    emit('on-close');
  } finally {
    submitting.value = false;
  }
};

onMounted(() => {
  void ApiLoadDetail();
});
</script>

<template lang="pug">
ElDialog(
  v-model="visible"
  :title="dialogTitle"
  width="520px"
  :close-on-click-modal="false"
  append-to-body
  @closed="HandleClosed"
)
  .OpenDialogTagEdit(v-loading="loading")
    .OpenDialogTagEdit__field
      label.OpenDialogTagEdit__label
        | {{ $t('admin.tagManagement.fieldNameZh') }}
        span.OpenDialogTagEdit__required *
      ElInput(
        v-model="form.nameZh"
        maxlength="32"
        show-word-limit
        placeholder="例：純電"
      )

    .OpenDialogTagEdit__field
      label.OpenDialogTagEdit__label {{ $t('admin.tagManagement.fieldNameEn') }}
      ElInput(
        v-model="form.nameEn"
        maxlength="32"
        show-word-limit
        placeholder="e.g. EV"
      )

    .OpenDialogTagEdit__field
      label.OpenDialogTagEdit__label {{ $t('admin.tagManagement.fieldNameJa') }}
      ElInput(
        v-model="form.nameJa"
        maxlength="32"
        show-word-limit
        placeholder="例：EV"
      )

    .OpenDialogTagEdit__field
      label.OpenDialogTagEdit__label {{ $t('admin.tagManagement.fieldGroup') }}
      ElSelect(
        v-model="form.group"
        :disabled="isEdit"
        value-on-clear=""
      )
        ElOption(
          v-for="o in groupOptions"
          :key="o.value"
          :value="o.value"
          :label="o.label"
        )

    .OpenDialogTagEdit__field
      label.OpenDialogTagEdit__label {{ $t('admin.tagManagement.fieldScope') }}
      .OpenDialogTagEdit__readonly
        | {{ scopeForCurrentGroup === 'driver' ? $t('admin.tagManagement.scopeDriver') : $t('admin.tagManagement.scopeVehicle') }}

    .OpenDialogTagEdit__field
      label.OpenDialogTagEdit__label {{ $t('admin.tagManagement.fieldSurcharge') }}
      ElInputNumber(
        v-model="form.surchargeAmount"
        :min="0"
        :step="50"
        controls-position="right"
        inputmode="numeric"
      )

    .OpenDialogTagEdit__field
      label.OpenDialogTagEdit__label {{ $t('admin.tagManagement.fieldSortOrder') }}（可選）
      ElInputNumber(
        v-model="form.sortOrder"
        :min="0"
        controls-position="right"
        inputmode="numeric"
      )

  template(#footer)
    ElButton(@click="ClickCancel") 取消
    ElButton(type="primary" :loading="submitting" @click="SaveFlow") 儲存
</template>

<style lang="scss" scoped>
.OpenDialogTagEdit__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.OpenDialogTagEdit__label {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.75);
}

.OpenDialogTagEdit__required {
  color: #d4860a;
  margin-left: 4px;
}

.OpenDialogTagEdit__readonly {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 6px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.6);
}
</style>
