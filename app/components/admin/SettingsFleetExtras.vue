<script setup lang="ts">
// P23 Stage 5：admin/settings 加值服務 CRUD 區塊
// 從 StoreConfig() 撈 extras 列表，admin 可任意新增/刪除/啟用切換 + 自訂三語 label 與單價。

type DialogMode = 'create' | 'edit';

interface ExtraFormState {
  id: string;
  labelZh: string;
  labelEn: string;
  labelJa: string;
  price: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

const storeConfig = StoreConfig();

const dialog = reactive<{ open: boolean; mode: DialogMode; saving: boolean; error: string }>({
  open: false,
  mode: 'create',
  saving: false,
  error: '',
});

const form = reactive<ExtraFormState>(_emptyForm());
const togglingId = ref('');
const deletingId = ref('');

function _emptyForm(): ExtraFormState {
  return {
    id: '',
    labelZh: '',
    labelEn: '',
    labelJa: '',
    price: 200,
    icon: 'mdi:plus-circle-outline',
    sortOrder: 99,
    enabled: true,
  };
}

const ClickOpenCreate = () => {
  Object.assign(form, _emptyForm());
  const maxOrder = storeConfig.extras.reduce((m, e) => Math.max(m, e.sortOrder), 0);
  form.sortOrder = maxOrder + 1;
  dialog.mode = 'create';
  dialog.error = '';
  dialog.open = true;
};

const ClickOpenEdit = (e: FleetExtraDto) => {
  form.id = e.id;
  form.labelZh = e.label.zh;
  form.labelEn = e.label.en;
  form.labelJa = e.label.ja;
  form.price = e.price;
  form.icon = e.icon;
  form.sortOrder = e.sortOrder;
  form.enabled = e.enabled;
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
    if (storeConfig.extras.some((e) => e.id === form.id.trim())) return 'ID 已存在';
  }
  if (!form.labelZh.trim() || !form.labelEn.trim() || !form.labelJa.trim()) return '三語 label 都必填';
  if (!(form.price >= 0)) return 'price 必須 ≥ 0';
  if (!form.icon.trim()) return 'icon 必填（例：mdi:baby-face-outline）';
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
    const payload: CreateExtraPayload = {
      label: { zh: form.labelZh.trim(), en: form.labelEn.trim(), ja: form.labelJa.trim() },
      price: form.price,
      icon: form.icon.trim(),
      sortOrder: form.sortOrder,
      enabled: form.enabled,
    };
    const res = dialog.mode === 'create'
      ? await $api.CreateFleetExtra({ ...payload, id: form.id.trim() })
      : await $api.UpdateFleetExtra(form.id, payload);
    if (res.status?.code !== 200) {
      dialog.error = res.status?.message?.zh_tw ?? '儲存失敗';
      return;
    }
    await storeConfig.Reload();
    dialog.open = false;
    ElMessage({ message: dialog.mode === 'create' ? '已新增加值服務' : '已更新加值服務', type: 'success' });
  } finally {
    dialog.saving = false;
  }
};

const ClickToggleEnabled = async (e: FleetExtraDto) => {
  togglingId.value = e.id;
  try {
    const res = await $api.UpdateFleetExtra(e.id, {
      label: e.label,
      price: e.price,
      icon: e.icon,
      sortOrder: e.sortOrder,
      enabled: !e.enabled,
    });
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '切換失敗', type: 'error' });
      return;
    }
    await storeConfig.Reload();
  } finally {
    togglingId.value = '';
  }
};

const ClickDelete = async (e: FleetExtraDto) => {
  const $ask = UseAsk();
  const ok = await $ask.Any(
    `確定刪除加值服務「${e.label.zh}」？\n（既有訂單仍會保留服務 id 字串快照，但乘客 booking 表單將不再顯示此選項）`,
    '刪除加值服務',
    '取消',
    '確定刪除',
    'warning',
  );
  if (!ok) return;
  deletingId.value = e.id;
  try {
    const res = await $api.DeleteFleetExtra(e.id);
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
.SettingsFleetExtras
  .SettingsFleetExtras__head
    .SettingsFleetExtras__head-left
      span.SettingsFleetExtras__count {{ storeConfig.extras.length }} 項
    button.SettingsFleetExtras__add-btn(@click="ClickOpenCreate") + 新增服務

  //- 列表
  .SettingsFleetExtras__empty(v-if="storeConfig.extras.length === 0") 尚無加值服務，按上方「新增服務」開始設定

  .SettingsFleetExtras__list(v-else)
    .SettingsFleetExtras__row(v-for="e in storeConfig.extras" :key="e.id" :class="{ 'is-disabled': !e.enabled }")
      .SettingsFleetExtras__row-main
        .SettingsFleetExtras__row-name
          span.SettingsFleetExtras__row-zh {{ e.label.zh }}
          span.SettingsFleetExtras__row-id {{ '#' + e.id }}
          span.SettingsFleetExtras__row-price NT$ {{ e.price }}
          span.SettingsFleetExtras__row-disabled-tag(v-if="!e.enabled") 已停用
        .SettingsFleetExtras__row-meta
          span EN: {{ e.label.en }}
          span ·
          span JA: {{ e.label.ja }}
          span ·
          span icon: {{ e.icon }}
      .SettingsFleetExtras__row-actions
        button.SettingsFleetExtras__btn.is-toggle(
          :disabled="togglingId === e.id"
          @click="ClickToggleEnabled(e)"
        ) {{ e.enabled ? '停用' : '啟用' }}
        button.SettingsFleetExtras__btn.is-edit(@click="ClickOpenEdit(e)") 編輯
        button.SettingsFleetExtras__btn.is-delete(
          :disabled="deletingId === e.id"
          @click="ClickDelete(e)"
        ) 刪除

  //- 編輯 / 新增彈窗
  .SettingsFleetExtras__mask(v-if="dialog.open" @click.self="ClickClose")
    .SettingsFleetExtras__modal
      .SettingsFleetExtras__modal-title
        | {{ dialog.mode === 'create' ? '新增加值服務' : `編輯「${form.labelZh || form.id}」` }}

      .SettingsFleetExtras__modal-body
        //- ID（僅新增時可填）
        .SettingsFleetExtras__field(v-if="dialog.mode === 'create'")
          label.SettingsFleetExtras__label ID（doc id，小寫字母/數字/連字號）
          input.SettingsFleetExtras__input(
            v-model="form.id"
            placeholder="例：baby-seat / wheelchair / pickup-sign"
            maxlength="50"
          )

        //- 三語 label
        .SettingsFleetExtras__field-grid
          .SettingsFleetExtras__field
            label.SettingsFleetExtras__label 中文名稱
            input.SettingsFleetExtras__input(v-model="form.labelZh" maxlength="30" placeholder="例：嬰兒座椅")
          .SettingsFleetExtras__field
            label.SettingsFleetExtras__label 英文名稱
            input.SettingsFleetExtras__input(v-model="form.labelEn" maxlength="40" placeholder="例：Baby seat")
          .SettingsFleetExtras__field
            label.SettingsFleetExtras__label 日文名稱
            input.SettingsFleetExtras__input(v-model="form.labelJa" maxlength="40" placeholder="例：ベビーシート")

        //- 價格 + icon + sortOrder + enabled
        .SettingsFleetExtras__field-grid
          .SettingsFleetExtras__field
            label.SettingsFleetExtras__label 單價 (NT$)
            input.SettingsFleetExtras__input(
              v-model.number="form.price"
              type="number"
              min="0"
              inputmode="numeric"
            )
          .SettingsFleetExtras__field
            label.SettingsFleetExtras__label 排序（小→大）
            input.SettingsFleetExtras__input(
              v-model.number="form.sortOrder"
              type="number"
              inputmode="numeric"
            )
          .SettingsFleetExtras__field.is-toggle-row
            label.SettingsFleetExtras__label 啟用
            button.SettingsFleetExtras__switch(
              :class="{ 'is-on': form.enabled }"
              @click="form.enabled = !form.enabled"
              type="button"
            )
              span.SettingsFleetExtras__switch-thumb

        .SettingsFleetExtras__field
          label.SettingsFleetExtras__label icon（mdi 字串）
          input.SettingsFleetExtras__input(
            v-model="form.icon"
            maxlength="60"
            placeholder="例：mdi:baby-face-outline / mdi:wheelchair-accessibility"
          )

        .SettingsFleetExtras__error(v-if="dialog.error") ⚠️ {{ dialog.error }}

      .SettingsFleetExtras__modal-foot
        button.SettingsFleetExtras__action.is-secondary(
          :disabled="dialog.saving"
          @click="ClickClose"
        ) 取消
        button.SettingsFleetExtras__action.is-primary(
          :disabled="dialog.saving"
          @click="ClickSave"
        ) {{ dialog.saving ? '儲存中...' : '儲存' }}
</template>

<style lang="scss" scoped>





.SettingsFleetExtras {
  display: flex;
  flex-direction: column;
}

.SettingsFleetExtras__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-a06);
}

.SettingsFleetExtras__count {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--surface-a40);
}

.SettingsFleetExtras__add-btn {
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

.SettingsFleetExtras__empty {
  padding: 24px 16px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
  text-align: center;
}

.SettingsFleetExtras__list {
  display: flex;
  flex-direction: column;
}

.SettingsFleetExtras__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-a06);

  &:last-child { border-bottom: none; }
  &:hover { background: var(--surface-a06); }
  &.is-disabled { opacity: 0.5; }
}

.SettingsFleetExtras__row-main {
  flex: 1;
  min-width: 0;
}

.SettingsFleetExtras__row-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.SettingsFleetExtras__row-zh {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 700;
  color: var(--surface-a88);
}

.SettingsFleetExtras__row-id {
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

.SettingsFleetExtras__row-price {
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

.SettingsFleetExtras__row-disabled-tag {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--stop);
  background: var(--stop-a08);
  border: 1px solid var(--stop-a30);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}

.SettingsFleetExtras__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.SettingsFleetExtras__row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.SettingsFleetExtras__btn {
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

  &.is-toggle {
    background: var(--surface-a06);
    border-color: var(--surface-a20);
    color: var(--surface-a72);
    &:hover:not(:disabled) { background: var(--surface-a12); color: var(--surface-raised); }
  }

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
.SettingsFleetExtras__mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-2);
  background: var(--ink-a70);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.SettingsFleetExtras__modal {
  background: var(--surface-deep-2);
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-lg);
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.SettingsFleetExtras__modal-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--surface-raised);
  padding: 20px 22px 14px;
  border-bottom: 1px solid var(--surface-a06);
}

.SettingsFleetExtras__modal-body {
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.SettingsFleetExtras__field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

@media (max-width: 599.98px) {
  .SettingsFleetExtras__field-grid { grid-template-columns: 1fr 1fr; }
}

.SettingsFleetExtras__field {
  display: flex;
  flex-direction: column;
  gap: 5px;

  &.is-toggle-row {
    align-items: flex-start;
    justify-content: flex-start;
  }
}

.SettingsFleetExtras__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--surface-a40);
}

.SettingsFleetExtras__input {
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

.SettingsFleetExtras__switch {
  width: 44px;
  height: 24px;
  border-radius: var(--r-pill);
  background: var(--surface-a12);
  border: 1px solid var(--surface-a20);
  padding: 2px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
  position: relative;

  &.is-on {
    background: var(--accent-a70);
    border-color: var(--accent-a90);

    .SettingsFleetExtras__switch-thumb { transform: translateX(20px); }
  }
}

.SettingsFleetExtras__switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: var(--r-round);
  background: var(--surface-raised);
  transition: transform var(--dur-fast) var(--ease-out);
}

.SettingsFleetExtras__error {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--wait);
  background: var(--wait-a08);
  border: 1px solid var(--wait-a30);
  border-radius: var(--r-sm);
  padding: 8px 12px;
}

.SettingsFleetExtras__modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
  border-top: 1px solid var(--surface-a06);
}

.SettingsFleetExtras__action {
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
