<script setup lang="ts">
// SystemInappBrowserBlock 內建瀏覽器攔截遮罩
const $inAppBrowser = UseInAppBrowser();

const visible = computed(() => $inAppBrowser.isInApp.value);

/**
 * 使用預設瀏覽器開啟
 */
const OnOpen = () => {
  $inAppBrowser.TryOpenInDefaultBrowser();
};

/**
 * 複製網址
 */
const OnCopy = async () => {
  const ok = await $inAppBrowser.CopyUrl();
  if (ok) {
    // 若專案有 Element Plus，使用訊息提示；否則退回 alert
    // @ts-ignore
    if (typeof ElMessage !== 'undefined') {
      // @ts-ignore
      ElMessage.success('已複製網址');
    } else {
      alert('已複製網址');
    }
  } else {
    alert('複製失敗，請手動長按複製網址');
  }
};
</script>

<template lang="pug">
transition(name="fade")
  .SystemInappBrowserBlock(v-if="visible" class="iab-mask" role="dialog" aria-modal="true")
    .iab-panel
      .iab-title 偵測到於 App 內建瀏覽器開啟
      p.iab-desc 為確保功能正常，請勿使用 App 內建瀏覽器開啟本頁。
      p.iab-desc 您可以嘗試以預設瀏覽器開啟，或先複製網址再貼到外部瀏覽器。
      .iab-actions
        button.iab-btn.primary(@click="OnOpen") 使用預設瀏覽器開啟
        button.iab-btn(@click="OnCopy") 複製網址
</template>

<style scoped lang="scss">
.SystemInappBrowserBlock {
  --green: #16a34a;
  --border: #d0d7de;
  --text: #222;
  --gray: #6b7280;
}
.iab-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1900;
  padding: 24px;
}
.iab-panel {
  width: 100%;
  max-width: 520px;
  background: white;
  color: var(--text);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 12px 32px rgba(0,0,0,.24);
  text-align: center;
}
.iab-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}
.iab-desc {
  margin: 6px 0;
  line-height: 1.6;
  color: var(--gray);
}
.iab-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.iab-btn {
  appearance: none;
  border: 1px solid var(--border);
  background: white;
  color: var(--text);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
}
.iab-btn.primary {
  background: var(--green);
  color: white;
  border-color: var(--green);
}
.fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
