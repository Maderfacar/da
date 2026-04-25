<script setup lang="ts">
// TinyEditor：TinyMCE 8 富文本編輯器組件（SSR 安全、v-model 綁定、可覆寫 init）
import Editor from '@tinymce/tinymce-vue';

interface Props {
  modelValue?: string;
  initOverrides?: Record<string, any>;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  initOverrides: () => ({}),
  disabled: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

// 內部 v-model 橋接 -------------------------------------------------------
const innerValue = computed({
  get: () => props.modelValue,
  set: (val: string) => emit('update:modelValue', val)
});

// 圖片上傳 handler -------------------------------------------------------
// TinyMCE 規格：(blobInfo, progress) => Promise<string | { url, fileName? }>
type BlobInfo = { blob: () => Blob; filename: () => string };
const ApiUploadImage = (blobInfo: BlobInfo, _progress: (n: number) => void) => {
  return new Promise<{ url: string; fileName: string }>((resolve, reject) => {
    (async () => {
      try {
        const blob = blobInfo.blob();
        const file = new File([blob], blobInfo.filename(), { type: blob.type });
        const res = await $api.ApiTinymceUpload({ file });
        const successCode = $enum.apiStatus.success;
        if (res.status.code !== successCode && res.status.code !== 0) {
          reject({ message: res.status.message.zh_tw || 'Upload failed', remove: true });
          return;
        }
        resolve({ url: res.data.url, fileName: blobInfo.filename() });
      } catch (_err) {
        reject('Network error');
      }
    })();
  });
};

// 合併 init 配置 -------------------------------------------------------
const mergedInit = computed(() => ({
  ...tinymceDefaultInit,
  ...props.initOverrides,
  images_upload_handler: ApiUploadImage
}));
</script>

<template lang="pug">
.TinyEditor
  ClientOnly
    Editor(
      v-model="innerValue",
      license-key="gpl",
      :tinymce-script-src="tinymceScriptSrc",
      :disabled="disabled",
      :init="mergedInit"
    )
    template(#fallback)
      .TinyEditor__loading 載入編輯器中...
</template>

<style lang="scss" scoped>
.TinyEditor {
  width: 100%;
}

.TinyEditor__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 500px;
  color: #999;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fafafa;
}
</style>
