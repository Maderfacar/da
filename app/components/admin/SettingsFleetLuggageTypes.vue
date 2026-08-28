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





.SettingsFleetLuggage {
  display: flex;
  flex-direction: column;
}

.SettingsFleetLuggage__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-a06);
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--surface-a40);
}

.SettingsFleetLuggage__hint {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.SettingsFleetLuggage__add-btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 6px 14px;
  border-radius: var(--r-sm);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a40);
  color: var(--accent-text);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);

  &:hover { background: var(--accent-a20); }
}

.SettingsFleetLuggage__empty {
  padding: 24px 16px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
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
  border-bottom: 1px solid var(--surface-a06);

  &:last-child { border-bottom: none; }
  &:hover { background: var(--surface-a06); }
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
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 700;
  color: var(--surface-a88);
}

.SettingsFleetLuggage__row-id {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--surface-a40);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}

.SettingsFleetLuggage__row-su {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--accent-text);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a30);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}

.SettingsFleetLuggage__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.SettingsFleetLuggage__row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.SettingsFleetLuggage__btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 5px 12px;
  border-radius: var(--r-sm);
  border: 1px solid;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-edit {
    background: var(--accent-a12);
    border-color: var(--accent-a30);
    color: var(--accent-text);
    &:hover:not(:disabled) { background: var(--accent-a20); }
  }

  &.is-delete {
    background: var(--stop-a08);
    border-color: var(--stop-a30);
    color: var(--stop);
    &:hover:not(:disabled) { background: var(--stop-a15); }
  }
}

// ── Modal ────────────────────────────────────────────────
.SettingsFleetLuggage__mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-2);
  background: var(--ink-a70);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.SettingsFleetLuggage__modal {
  background: var(--surface-deep-2);
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-lg);
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.SettingsFleetLuggage__modal-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--surface-raised);
  padding: 20px 22px 14px;
  border-bottom: 1px solid var(--surface-a06);
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--surface-a40);
}

.SettingsFleetLuggage__input {
  width: 100%;
  padding: 9px 11px;
  border-radius: var(--r-md);
  border: 1px solid var(--surface-a06);
  background: var(--surface-a06);
  color: var(--surface-raised);
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--dur-fast) var(--ease-out);

  &::placeholder { color: var(--surface-a20); }
  &:focus { border-color: var(--accent-a40); }
}

.SettingsFleetLuggage__error {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--wait);
  background: var(--wait-a08);
  border: 1px solid var(--wait-a30);
  border-radius: var(--r-sm);
  padding: 8px 12px;
}

.SettingsFleetLuggage__modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
  border-top: 1px solid var(--surface-a06);
}

.SettingsFleetLuggage__action {
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 10px 18px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: var(--accent);
    color: var(--surface-raised);
    &:hover:not(:disabled) { background: var(--accent-deep); }
  }

  &.is-secondary {
    background: var(--surface-a06);
    color: var(--surface-a72);
    border-color: var(--surface-a06);
    &:hover:not(:disabled) { background: var(--surface-a06); }
  }
}
</style>
