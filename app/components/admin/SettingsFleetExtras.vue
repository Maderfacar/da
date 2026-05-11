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
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.4);
$border: rgba(255, 255, 255, 0.08);
$surface: rgba(255, 255, 255, 0.04);
$surface-2: rgba(255, 255, 255, 0.08);

.SettingsFleetExtras {
  display: flex;
  flex-direction: column;
}

.SettingsFleetExtras__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid $border;
}

.SettingsFleetExtras__count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $muted;
}

.SettingsFleetExtras__add-btn {
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

.SettingsFleetExtras__empty {
  padding: 24px 16px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  &:last-child { border-bottom: none; }
  &:hover { background: rgba(255, 255, 255, 0.02); }
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
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.SettingsFleetExtras__row-id {
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

.SettingsFleetExtras__row-price {
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

.SettingsFleetExtras__row-disabled-tag {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 100, 100, 0.85);
  background: rgba(255, 80, 80, 0.1);
  border: 1px solid rgba(255, 80, 80, 0.3);
  border-radius: 100px;
  padding: 1px 8px;
}

.SettingsFleetExtras__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.SettingsFleetExtras__row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.SettingsFleetExtras__btn {
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

  &.is-toggle {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.7);
    &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: #fff; }
  }

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
.SettingsFleetExtras__mask {
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

.SettingsFleetExtras__modal {
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.SettingsFleetExtras__modal-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.06em;
  color: #fff;
  padding: 20px 22px 14px;
  border-bottom: 1px solid $border;
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
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: $muted;
}

.SettingsFleetExtras__input {
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

.SettingsFleetExtras__switch {
  width: 44px;
  height: 24px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  padding: 2px;
  cursor: pointer;
  transition: background 0.18s;
  position: relative;

  &.is-on {
    background: rgba($amber, 0.7);
    border-color: rgba($amber, 0.9);

    .SettingsFleetExtras__switch-thumb { transform: translateX(20px); }
  }
}

.SettingsFleetExtras__switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.18s;
}

.SettingsFleetExtras__error {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 200, 0, 0.85);
  background: rgba(255, 200, 0, 0.08);
  border: 1px solid rgba(255, 200, 0, 0.25);
  border-radius: 8px;
  padding: 8px 12px;
}

.SettingsFleetExtras__modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
  border-top: 1px solid $border;
}

.SettingsFleetExtras__action {
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
