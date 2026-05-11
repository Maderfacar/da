<script setup lang="ts">
// P23 Stage 5：admin/settings 行李類型 CRUD 區塊
// 從 StoreConfig() 撈 luggageTypes 列表，admin 可改 SU 值與三語 label。
// 行李類型沒有 enabled 欄位（每筆都生效），刪除即從乘客 booking SU stepper 中移除。

type DialogMode = 'create' | 'edit';

interface LuggageFormState {
  id: string;
  labelZh: string;
  labelEn: string;
  labelJa: string;
  su: number;
  sortOrder: number;
}

const storeConfig = StoreConfig();

const dialog = reactive<{ open: boolean; mode: DialogMode; saving: boolean; error: string }>({
  open: false,
  mode: 'create',
  saving: false,
  error: '',
});

const form = reactive<LuggageFormState>(_emptyForm());
const deletingId = ref('');

function _emptyForm(): LuggageFormState {
  return {
    id: '',
    labelZh: '',
    labelEn: '',
    labelJa: '',
    su: 1,
    sortOrder: 99,
  };
}

const ClickOpenCreate = () => {
  Object.assign(form, _emptyForm());
  const maxOrder = storeConfig.luggageTypes.reduce((m, t) => Math.max(m, t.sortOrder), 0);
  form.sortOrder = maxOrder + 1;
  dialog.mode = 'create';
  dialog.error = '';
  dialog.open = true;
};

const ClickOpenEdit = (t: FleetLuggageTypeDto) => {
  form.id = t.id;
  form.labelZh = t.label.zh;
  form.labelEn = t.label.en;
  form.labelJa = t.label.ja;
  form.su = t.su;
  form.sortOrder = t.sortOrder;
  dialog.mode = 'edit';
  dialog.error = '';
  dialog.open = true;
};

const ClickClose = () => {
  if (dialog.saving) return;
  dialog.open = false;
};

const _validate = (): string => {
  if (dialog.mode === 'create') {
    if (!form.id.trim()) return 'ID 必填';
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(form.id.trim())) return 'ID 必須小寫字母 / 數字 / 連字號開頭，最長 50 字';
    if (storeConfig.luggageTypes.some((t) => t.id === form.id.trim())) return 'ID 已存在';
  }
  if (!form.labelZh.trim() || !form.labelEn.trim() || !form.labelJa.trim()) return '三語 label 都必填';
  if (!(form.su >= 0)) return 'su 必須 ≥ 0';
  if (!Number.isInteger(form.sortOrder)) return 'sortOrder 必須整數';
  return '';
};

const ClickSave = async () => {
  const err = _validate();
  if (err) {
    dialog.error = err;
    return;
  }
  dialog.error = '';
  dialog.saving = true;
  try {
    const payload: CreateLuggageTypePayload = {
      label: { zh: form.labelZh.trim(), en: form.labelEn.trim(), ja: form.labelJa.trim() },
      su: form.su,
      sortOrder: form.sortOrder,
    };
    const res = dialog.mode === 'create'
      ? await $api.CreateFleetLuggageType({ ...payload, id: form.id.trim() })
      : await $api.UpdateFleetLuggageType(form.id, payload);
    if (res.status?.code !== 200) {
      dialog.error = res.status?.message?.zh_tw ?? '儲存失敗';
      return;
    }
    await storeConfig.Reload();
    dialog.open = false;
    ElMessage({ message: dialog.mode === 'create' ? '已新增行李類型' : '已更新行李類型', type: 'success' });
  } finally {
    dialog.saving = false;
  }
};

const ClickDelete = async (t: FleetLuggageTypeDto) => {
  const $ask = UseAsk();
  const ok = await $ask.Any(
    `確定刪除行李類型「${t.label.zh}」？\n（既有訂單仍會保留 typeId 字串快照，但乘客 booking 表單將不再顯示此選項）`,
    '刪除行李類型',
    '取消',
    '確定刪除',
    'warning',
  );
  if (!ok) return;
  deletingId.value = t.id;
  try {
    const res = await $api.DeleteFleetLuggageType(t.id);
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '刪除失敗', type: 'error' });
      return;
    }
    await storeConfig.Reload();
    ElMessage({ message: '已刪除', type: 'warning' });
  } finally {
    deletingId.value = '';
  }
};
</script>

<template lang="pug">
.SettingsFleetLuggage
  .SettingsFleetLuggage__head
    .SettingsFleetLuggage__head-left
      span.SettingsFleetLuggage__count {{ storeConfig.luggageTypes.length }} 種
      span.SettingsFleetLuggage__hint · SU 值代表「該行李在車型容量中佔的單位」
    button.SettingsFleetLuggage__add-btn(@click="ClickOpenCreate") + 新增類型

  //- 列表
  .SettingsFleetLuggage__empty(v-if="storeConfig.luggageTypes.length === 0") 尚無行李類型，按上方「新增類型」開始設定

  .SettingsFleetLuggage__list(v-else)
    .SettingsFleetLuggage__row(v-for="t in storeConfig.luggageTypes" :key="t.id")
      .SettingsFleetLuggage__row-main
        .SettingsFleetLuggage__row-name
          span.SettingsFleetLuggage__row-zh {{ t.label.zh }}
          span.SettingsFleetLuggage__row-id {{ '#' + t.id }}
          span.SettingsFleetLuggage__row-su SU {{ t.su }}
        .SettingsFleetLuggage__row-meta
          span EN: {{ t.label.en }}
          span ·
          span JA: {{ t.label.ja }}
          span ·
          span 排序 {{ t.sortOrder }}
      .SettingsFleetLuggage__row-actions
        button.SettingsFleetLuggage__btn.is-edit(@click="ClickOpenEdit(t)") 編輯
        button.SettingsFleetLuggage__btn.is-delete(
          :disabled="deletingId === t.id"
          @click="ClickDelete(t)"
        ) 刪除

  //- 編輯 / 新增彈窗
  .SettingsFleetLuggage__mask(v-if="dialog.open" @click.self="ClickClose")
    .SettingsFleetLuggage__modal
      .SettingsFleetLuggage__modal-title
        | {{ dialog.mode === 'create' ? '新增行李類型' : `編輯「${form.labelZh || form.id}」` }}

      .SettingsFleetLuggage__modal-body
        //- ID（僅新增時可填）
        .SettingsFleetLuggage__field(v-if="dialog.mode === 'create'")
          label.SettingsFleetLuggage__label ID（doc id，小寫字母/數字/連字號）
          input.SettingsFleetLuggage__input(
            v-model="form.id"
            placeholder="例：small / medium / large / special"
            maxlength="50"
          )

        //- 三語 label
        .SettingsFleetLuggage__field-grid
          .SettingsFleetLuggage__field
            label.SettingsFleetLuggage__label 中文名稱
            input.SettingsFleetLuggage__input(v-model="form.labelZh" maxlength="40" placeholder='例：20 吋以下登機箱')
          .SettingsFleetLuggage__field
            label.SettingsFleetLuggage__label 英文名稱
            input.SettingsFleetLuggage__input(v-model="form.labelEn" maxlength="60" placeholder='例：Carry-on (≤ 20")')
          .SettingsFleetLuggage__field
            label.SettingsFleetLuggage__label 日文名稱
            input.SettingsFleetLuggage__input(v-model="form.labelJa" maxlength="60" placeholder='例：機内持込（20"以下）')

        //- SU + sortOrder
        .SettingsFleetLuggage__field-grid.is-two
          .SettingsFleetLuggage__field
            label.SettingsFleetLuggage__label SU 值（佔用車型容量單位）
            input.SettingsFleetLuggage__input(
              v-model.number="form.su"
              type="number"
              min="0"
              inputmode="numeric"
            )
          .SettingsFleetLuggage__field
            label.SettingsFleetLuggage__label 排序（小→大）
            input.SettingsFleetLuggage__input(
              v-model.number="form.sortOrder"
              type="number"
              inputmode="numeric"
            )

        .SettingsFleetLuggage__error(v-if="dialog.error") ⚠️ {{ dialog.error }}

      .SettingsFleetLuggage__modal-foot
        button.SettingsFleetLuggage__action.is-secondary(
          :disabled="dialog.saving"
          @click="ClickClose"
        ) 取消
        button.SettingsFleetLuggage__action.is-primary(
          :disabled="dialog.saving"
          @click="ClickSave"
        ) {{ dialog.saving ? '儲存中...' : '儲存' }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.4);
$border: rgba(255, 255, 255, 0.08);
$surface: rgba(255, 255, 255, 0.04);
$surface-2: rgba(255, 255, 255, 0.08);

.SettingsFleetLuggage {
  display: flex;
  flex-direction: column;
}

.SettingsFleetLuggage__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid $border;
  gap: 8px;
  flex-wrap: wrap;
}

.SettingsFleetLuggage__head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.SettingsFleetLuggage__count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $muted;
}

.SettingsFleetLuggage__hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
}

.SettingsFleetLuggage__add-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba($amber, 0.12);
  border: 1px solid rgba($amber, 0.4);
  color: $amber;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba($amber, 0.22); }
}

.SettingsFleetLuggage__empty {
  padding: 24px 16px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  text-align: center;
}

.SettingsFleetLuggage__list {
  display: flex;
  flex-direction: column;
}

.SettingsFleetLuggage__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  &:last-child { border-bottom: none; }
  &:hover { background: rgba(255, 255, 255, 0.02); }
}

.SettingsFleetLuggage__row-main {
  flex: 1;
  min-width: 0;
}

.SettingsFleetLuggage__row-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.SettingsFleetLuggage__row-zh {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.SettingsFleetLuggage__row-id {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: $muted;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid $border;
  border-radius: 100px;
  padding: 1px 8px;
}

.SettingsFleetLuggage__row-su {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: $amber;
  background: rgba($amber, 0.1);
  border: 1px solid rgba($amber, 0.3);
  border-radius: 100px;
  padding: 1px 8px;
}

.SettingsFleetLuggage__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.SettingsFleetLuggage__row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.SettingsFleetLuggage__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-edit {
    background: rgba($amber, 0.1);
    border-color: rgba($amber, 0.35);
    color: $amber;
    &:hover:not(:disabled) { background: rgba($amber, 0.2); }
  }

  &.is-delete {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.35);
    color: #f87171;
    &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
  }
}

// ── Modal ────────────────────────────────────────────────
.SettingsFleetLuggage__mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.SettingsFleetLuggage__modal {
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.SettingsFleetLuggage__modal-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.06em;
  color: #fff;
  padding: 20px 22px 14px;
  border-bottom: 1px solid $border;
}

.SettingsFleetLuggage__modal-body {
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.SettingsFleetLuggage__field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;

  &.is-two { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 599.98px) {
  .SettingsFleetLuggage__field-grid {
    grid-template-columns: 1fr;
    &.is-two { grid-template-columns: 1fr 1fr; }
  }
}

.SettingsFleetLuggage__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.SettingsFleetLuggage__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: $muted;
}

.SettingsFleetLuggage__input {
  width: 100%;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &::placeholder { color: rgba(255, 255, 255, 0.2); }
  &:focus { border-color: rgba($amber, 0.4); }
}

.SettingsFleetLuggage__error {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 200, 0, 0.85);
  background: rgba(255, 200, 0, 0.08);
  border: 1px solid rgba(255, 200, 0, 0.25);
  border-radius: 8px;
  padding: 8px 12px;
}

.SettingsFleetLuggage__modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
  border-top: 1px solid $border;
}

.SettingsFleetLuggage__action {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: $amber;
    color: #fff;
    &:hover:not(:disabled) { background: darken($amber, 6%); }
  }

  &.is-secondary {
    background: $surface;
    color: rgba(255, 255, 255, 0.7);
    border-color: $border;
    &:hover:not(:disabled) { background: $surface-2; }
  }
}
</style>
