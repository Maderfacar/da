<script setup lang="ts">
// OpenDialogAdminPinPrompt — admin 敏感操作 PIN 提示彈窗
//
// 不走 $open 系統（沒有 params / resolve props）；改透過 UseAskForPin module-level state 驅動。
// 在 back-desk layout 內掛一個實例即可；askForPin() 任意呼叫端共用此實例。

const { submitPin, cancel, _visible, _busy, _errorMsg } = UseAskForPin();

const pin = ref('');

watch(_visible, (v) => {
  if (v) {
    pin.value = '';
  }
});

const ClickConfirm = async () => {
  await submitPin(pin.value);
  // submitPin 成功會自動關 visible；失敗保留輸入讓使用者重試
};

const ClickCancel = () => {
  cancel();
};
</script>

<template lang="pug">
ElDialog(
  v-model="_visible"
  title="需要二次驗證"
  width="380px"
  :close-on-click-modal="false"
  :show-close="false"
)
  .OpenDialogAdminPinPrompt
    p.OpenDialogAdminPinPrompt__lead 此為敏感操作，請輸入您的 4-8 位數 PIN。
    ElInput(
      v-model="pin"
      maxlength="8"
      minlength="4"
      inputmode="numeric"
      placeholder="••••"
      show-password
      @keyup.enter="ClickConfirm"
    )
    .OpenDialogAdminPinPrompt__error(v-if="_errorMsg") {{ _errorMsg }}
  template(#footer)
    ElButton(@click="ClickCancel" :disabled="_busy") 取消
    ElButton(type="primary" :loading="_busy" @click="ClickConfirm") 確認
</template>

<style lang="scss" scoped>
.OpenDialogAdminPinPrompt {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.OpenDialogAdminPinPrompt__lead {
  font-size: 13px;
  color: #555;
  margin: 0;
  line-height: 1.6;
}
.OpenDialogAdminPinPrompt__error {
  color: #c4262e;
  font-size: 12px;
  margin: 0;
}
</style>
