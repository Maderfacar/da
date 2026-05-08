<script setup lang="ts">
// DriverRegisterUploadField 司機證件單一欄位上傳元件
//
// - 支援拖放、點擊選檔
// - 上傳中顯示進度（雖然 fetch 沒原生 progress，先用 spinner）
// - 上傳成功顯示縮圖預覽（jpg/png）或檔名（pdf）
// - 失敗顯示錯誤訊息可重試
//
// Props:
//   docType: 'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl'
//   label:   顯示給使用者看的中文標籤（駕照 / 行照 / 保險卡 / 良民證）
//   lineUserId: LIFF profile.userId（用於 Storage 路徑）
//   modelValue: 已上傳的 signed URL（v-model 雙向綁定）
//
// 使用：
//   <DriverRegisterUploadField
//     v-model="docs.licenseUrl"
//     docType="licenseUrl"
//     label="駕照"
//     :line-user-id="userId"
//   />

type DocType = 'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl';

const props = defineProps<{
  docType: DocType;
  label: string;
  lineUserId: string;
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
const isUploading = ref(false);
const errorMsg = ref('');
const previewUrl = ref('');

// 已有上傳結果時，直接拿 modelValue 當預覽（admin signed URL 可直接顯示）
const displayUrl = computed(() => previewUrl.value || props.modelValue || '');
const isPdf = computed(() => displayUrl.value.toLowerCase().includes('.pdf'));

const ClickArea = () => {
  if (isUploading.value) return;
  inputRef.value?.click();
};

const ApiUpload = async (file: File) => {
  if (!props.lineUserId) {
    errorMsg.value = '尚未取得 LINE 身分';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    errorMsg.value = '檔案超過 5MB';
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'].includes(file.type)) {
    errorMsg.value = '僅支援 jpg / png / pdf';
    return;
  }
  errorMsg.value = '';
  isUploading.value = true;

  // 預覽（圖片才有 dataURL；pdf 顯示檔名）
  if (file.type !== 'application/pdf') {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewUrl.value = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  try {
    const res = await $api.UploadDriverDocument({
      file,
      docType: props.docType,
      lineUserId: props.lineUserId,
    });
    if (res.status?.code === 200 && res.data?.url) {
      emit('update:modelValue', res.data.url);
    } else {
      errorMsg.value = res.status?.message?.zh_tw ?? '上傳失敗';
      previewUrl.value = '';
    }
  } catch {
    errorMsg.value = '上傳失敗，請重試';
    previewUrl.value = '';
  }
  isUploading.value = false;
};

const ChangeFile = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) ApiUpload(file);
};

const DropFile = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) ApiUpload(file);
};

const ClickClear = () => {
  emit('update:modelValue', '');
  previewUrl.value = '';
  errorMsg.value = '';
  if (inputRef.value) inputRef.value.value = '';
};
</script>

<template lang="pug">
.DriverRegisterUploadField
  .DriverRegisterUploadField__label {{ label }}
    span.DriverRegisterUploadField__required *

  .DriverRegisterUploadField__zone(
    :class="{ 'is-dragging': isDragging, 'is-uploaded': !!modelValue, 'is-uploading': isUploading }"
    @click="ClickArea"
    @dragover.prevent="isDragging = true"
    @dragleave="isDragging = false"
    @drop="DropFile"
  )
    input.DriverRegisterUploadField__input(
      ref="inputRef"
      type="file"
      accept="image/jpeg,image/png,image/jpg,application/pdf"
      @change="ChangeFile"
    )

    template(v-if="isUploading")
      .DriverRegisterUploadField__spinner
      .DriverRegisterUploadField__hint 上傳中…

    template(v-else-if="modelValue")
      img.DriverRegisterUploadField__preview(
        v-if="!isPdf"
        :src="displayUrl"
        :alt="label"
      )
      .DriverRegisterUploadField__pdf(v-else)
        span 📄
        span 已上傳 PDF
      button.DriverRegisterUploadField__clear(
        type="button"
        @click.stop="ClickClear"
      ) ✕

    template(v-else)
      .DriverRegisterUploadField__icon ＋
      .DriverRegisterUploadField__hint 點擊或拖曳檔案
      .DriverRegisterUploadField__sub jpg / png / pdf · ≤ 5MB

  .DriverRegisterUploadField__error(v-if="errorMsg") {{ errorMsg }}
</template>

<style lang="scss" scoped>
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.DriverRegisterUploadField {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.DriverRegisterUploadField__label {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.75);
  display: flex;
  gap: 4px;
}

.DriverRegisterUploadField__required {
  color: #f87171;
}

.DriverRegisterUploadField__zone {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border: 1.5px dashed rgba(212, 134, 10, 0.35);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;

  &:hover {
    border-color: rgba(212, 134, 10, 0.6);
    background: rgba(212, 134, 10, 0.06);
  }

  &.is-dragging {
    border-color: var(--da-amber);
    background: rgba(212, 134, 10, 0.12);
  }

  &.is-uploaded {
    border-style: solid;
    border-color: rgba(80, 200, 120, 0.4);
    background: rgba(80, 200, 120, 0.04);
  }

  &.is-uploading {
    cursor: progress;
  }
}

.DriverRegisterUploadField__input {
  display: none;
}

.DriverRegisterUploadField__icon {
  font-family: $font-condensed;
  font-size: 32px;
  font-weight: 300;
  color: rgba(212, 134, 10, 0.6);
  line-height: 1;
}

.DriverRegisterUploadField__hint {
  font-family: $font-body;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.DriverRegisterUploadField__sub {
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.3);
}

.DriverRegisterUploadField__preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.DriverRegisterUploadField__pdf {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-family: $font-body;
  color: rgba(255, 255, 255, 0.7);

  span:first-child { font-size: 36px; }
  span:last-child { font-size: 12px; }
}

.DriverRegisterUploadField__clear {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;

  &:hover { background: rgba(0, 0, 0, 0.85); }
}

.DriverRegisterUploadField__spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.DriverRegisterUploadField__error {
  font-family: $font-body;
  font-size: 11px;
  color: #f87171;
}
</style>
