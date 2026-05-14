<script setup lang="ts">
// P37 Phase 3.2：公告編輯彈窗
//
// mode：
//   - 'create'    建草稿（POST → 可選擇直接發佈 PATCH status=published）
//   - 'edit'      編輯既有公告（PATCH 內容；可選擇變更 status）
//   - 'republish' archived → published 重發（PATCH status=published；UI 紅色警告）
//
// LINE 重推觸發點（server）：oldStatus !== 'published' && newStatus === 'published'
//   → 編輯 published 不重推（只更新內容），republish (archived→published) 會重推。
import type {
  Announcement,
  AnnouncementChannels,
  AnnouncementCtaButton,
  AnnouncementTargetType,
  CreateAnnouncementBody,
  PatchAnnouncementBody,
} from '@/protocol/fetch-api/api/admin/announcement';

type AnnouncementEditMode = 'create' | 'edit' | 'republish';

interface DialogAnnouncementEditParamsLocal {
  mode: AnnouncementEditMode;
  id?: string;
}

export type AnnouncementEditResult = 'saved' | 'published' | 'archived' | 'cancelled';

interface Props {
  params: DialogAnnouncementEditParamsLocal;
  resolve: (value: AnnouncementEditResult) => void;
  level: number;
}
const props = defineProps<Props>();
const emit = defineEmits<{ 'on-close': [] }>();

// ── 表單狀態 ─────────────────────────────────────────────────
const form = reactive({
  title: '',
  body: '',
  coverImageUrl: null as string | null,
  ctaEnabled: false,
  ctaLabel: '',
  ctaUrl: '',
  targetType: 'all' as AnnouncementTargetType,
  targetOrderId: '',
  channelLine: true,
  channelInApp: true,
});

const loading = ref(false);   // 載入 detail
const submitting = ref(false); // 送出中
const uploadingCover = ref(false);
const coverInputRef = ref<HTMLInputElement | null>(null);
const showPreview = ref(false); // 手機板切換 preview

const currentStatus = ref<Announcement['status'] | null>(null);

const titleLen = computed(() => form.title.length);
const TITLE_MAX = 60;
const CTA_LABEL_MAX = 20;

// ── 載入既有公告（edit / republish） ───────────────────────────
const ApiLoadDetail = async () => {
  if (props.params.mode === 'create' || !props.params.id) return;
  loading.value = true;
  try {
    const res = await $api.GetAdminAnnouncement(props.params.id);
    if (res.status.code !== 200 || !res.data) {
      ElMessage({ message: res.status.message?.zh_tw || '載入公告失敗', type: 'error' });
      emit('on-close');
      props.resolve('cancelled');
      return;
    }
    const a = res.data;
    form.title = a.title;
    form.body = a.body;
    form.coverImageUrl = a.coverImageUrl;
    if (a.ctaButton) {
      form.ctaEnabled = true;
      form.ctaLabel = a.ctaButton.label;
      form.ctaUrl = a.ctaButton.url;
    }
    form.targetType = a.targetType;
    form.targetOrderId = a.targetOrderId ?? '';
    form.channelLine = a.channels.line;
    form.channelInApp = a.channels.inApp;
    currentStatus.value = a.status;
  } finally {
    loading.value = false;
  }
};

// ── 封面圖上傳 ───────────────────────────────────────────────
const ClickPickCover = () => coverInputRef.value?.click();

const OnCoverChange = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  await UploadCoverFlow(file);
  if (target) target.value = ''; // reset 讓相同檔案能再選
};

const OnCoverDrop = async (e: DragEvent) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  await UploadCoverFlow(file);
};

const UploadCoverFlow = async (file: File) => {
  // 前端先擋 mime / size，避免無謂往返
  const ALLOWED = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif'];
  if (!ALLOWED.includes(file.type)) {
    ElMessage({ message: '僅接受 jpg / png / gif', type: 'warning' });
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage({ message: '檔案超過 10MB 限制', type: 'warning' });
    return;
  }
  uploadingCover.value = true;
  try {
    const res = await $api.UploadAdminAnnouncementCover(file);
    if (res.status.code !== 200 || !res.data?.url) {
      ElMessage({ message: res.status.message?.zh_tw || '上傳失敗', type: 'error' });
      return;
    }
    form.coverImageUrl = res.data.url;
    ElMessage({ message: '封面已上傳', type: 'success' });
  } finally {
    uploadingCover.value = false;
  }
};

const ClickRemoveCover = () => {
  form.coverImageUrl = null;
};

// ── 驗證 ─────────────────────────────────────────────────────
const ValidateForm = (): string | null => {
  if (!form.title.trim()) return '請輸入標題';
  if (form.title.length > TITLE_MAX) return `標題上限 ${TITLE_MAX} 字`;
  if (!form.body.replace(/<[^>]+>/g, '').trim()) return '請輸入內文';
  if (form.ctaEnabled) {
    if (!form.ctaLabel.trim()) return '請輸入 CTA 按鈕文字';
    if (form.ctaLabel.length > CTA_LABEL_MAX) return `CTA 按鈕文字上限 ${CTA_LABEL_MAX} 字`;
    if (!form.ctaUrl.trim()) return '請輸入 CTA 連結';
    if (!form.ctaUrl.startsWith('https://')) return 'CTA 連結必須以 https:// 開頭';
  }
  if (form.targetType === 'order' && !form.targetOrderId.trim()) {
    return '指定訂單時必須填入訂單編號';
  }
  if (!form.channelLine && !form.channelInApp) {
    return '推送渠道至少擇一（LINE OA / App 內列表）';
  }
  return null;
};

// ── 組裝 payload ──────────────────────────────────────────────
const BuildBody = (): CreateAnnouncementBody => {
  const cta: AnnouncementCtaButton | null = form.ctaEnabled
    ? { label: form.ctaLabel.trim(), url: form.ctaUrl.trim() }
    : null;
  const channels: AnnouncementChannels = {
    line: form.channelLine,
    inApp: form.channelInApp,
  };
  return {
    title: form.title.trim(),
    body: form.body,
    coverImageUrl: form.coverImageUrl,
    ctaButton: cta,
    targetType: form.targetType,
    targetOrderId: form.targetType === 'order' ? form.targetOrderId.trim() : null,
    channels,
  };
};

// ── 動作 ─────────────────────────────────────────────────────
/** 儲存草稿（create: POST as draft / edit: PATCH 內容不動 status） */
const ClickSaveDraft = async () => {
  const err = ValidateForm();
  if (err) {
    ElMessage({ message: err, type: 'warning' });
    return;
  }
  submitting.value = true;
  try {
    if (props.params.mode === 'create') {
      const res = await $api.CreateAdminAnnouncement(BuildBody());
      if (res.status.code !== 200) {
        ElMessage({ message: res.status.message?.zh_tw || '建立失敗', type: 'error' });
        return;
      }
      ElMessage({ message: '已儲存草稿', type: 'success' });
      props.resolve('saved');
      emit('on-close');
    } else {
      // edit 或 republish 模式都走 PATCH（republish 一般不會用「儲存草稿」，但保留邏輯）
      if (!props.params.id) return;
      const body: PatchAnnouncementBody = BuildBody();
      // republish 模式不該用儲存草稿（按鈕已隱藏）；edit 模式存內容不動 status
      const res = await $api.PatchAdminAnnouncement(props.params.id, body);
      if (res.status.code !== 200) {
        ElMessage({ message: res.status.message?.zh_tw || '更新失敗', type: 'error' });
        return;
      }
      ElMessage({
        message: currentStatus.value === 'published'
          ? '已更新（不重推 LINE）'
          : '已儲存',
        type: 'success',
      });
      props.resolve('saved');
      emit('on-close');
    }
  } finally {
    submitting.value = false;
  }
};

/** 立即發佈 / 重新發佈 */
const ClickPublish = async () => {
  const err = ValidateForm();
  if (err) {
    ElMessage({ message: err, type: 'warning' });
    return;
  }
  // 重發要二次警告
  if (props.params.mode === 'republish' || currentStatus.value === 'archived') {
    const ok = await UseAsk('將再次推送 LINE 給目標對象，確定要重新發佈？');
    if (!ok) return;
  }
  submitting.value = true;
  try {
    if (props.params.mode === 'create') {
      // create + 立即發佈 = POST 草稿後 PATCH publish
      const createRes = await $api.CreateAdminAnnouncement(BuildBody());
      if (createRes.status.code !== 200 || !createRes.data?.id) {
        ElMessage({ message: createRes.status.message?.zh_tw || '建立失敗', type: 'error' });
        return;
      }
      const patchRes = await $api.PatchAdminAnnouncement(createRes.data.id, { status: 'published' });
      if (patchRes.status.code !== 200) {
        ElMessage({ message: patchRes.status.message?.zh_tw || '發佈失敗（草稿已保存）', type: 'error' });
        // 草稿仍存在，不視為失敗；通知 list 重撈
        props.resolve('saved');
        emit('on-close');
        return;
      }
      ElMessage({ message: '已發佈', type: 'success' });
      props.resolve('published');
      emit('on-close');
    } else {
      if (!props.params.id) return;
      const body: PatchAnnouncementBody = { ...BuildBody(), status: 'published' };
      const res = await $api.PatchAdminAnnouncement(props.params.id, body);
      if (res.status.code !== 200) {
        ElMessage({ message: res.status.message?.zh_tw || '發佈失敗', type: 'error' });
        return;
      }
      ElMessage({
        message: props.params.mode === 'republish' ? '已重新發佈' : '已發佈',
        type: 'success',
      });
      props.resolve('published');
      emit('on-close');
    }
  } finally {
    submitting.value = false;
  }
};

const ClickCancel = () => {
  props.resolve('cancelled');
  emit('on-close');
};

// ── 標題文案 ─────────────────────────────────────────────────
const dialogTitle = computed(() => {
  if (props.params.mode === 'create') return '新增公告';
  if (props.params.mode === 'republish') return '重新發佈公告';
  return '編輯公告';
});

const publishButtonLabel = computed(() => {
  if (props.params.mode === 'republish') return '重新發佈';
  if (currentStatus.value === 'published') return '更新公告';
  return '立即發佈';
});

const showSaveDraft = computed(() => {
  // republish 不顯示「儲存草稿」（避免誤把 archived 收回 draft）
  // 已發佈狀態下，「儲存草稿」改成「更新內容」入口（功能上是 PATCH 內容不動 status）
  return props.params.mode !== 'republish';
});

const saveDraftLabel = computed(() => {
  if (props.params.mode === 'create') return '儲存草稿';
  if (currentStatus.value === 'draft') return '儲存草稿';
  // edit 模式且 status 為 published / archived → 純更新內容
  return '只儲存（不變動狀態）';
});

// ── 生命週期 ─────────────────────────────────────────────────
onMounted(() => {
  ApiLoadDetail();
});
</script>

<template lang="pug">
.OpenDialogAnnouncementEdit
  .OpenDialogAnnouncementEdit__mask(@click="ClickCancel")
  .OpenDialogAnnouncementEdit__panel
    //- ── Header ─────────────────────────────────────────
    header.OpenDialogAnnouncementEdit__header
      .OpenDialogAnnouncementEdit__headerLabel ANNOUNCEMENT
      h2.OpenDialogAnnouncementEdit__headerTitle {{ dialogTitle }}
      .OpenDialogAnnouncementEdit__headerActions
        button.OpenDialogAnnouncementEdit__previewToggle(
          type="button"
          @click="showPreview = !showPreview"
        )
          | {{ showPreview ? '← 編輯' : '預覽 →' }}
        button.OpenDialogAnnouncementEdit__close(
          type="button"
          @click="ClickCancel"
          aria-label="關閉"
        )
          NuxtIcon(name="material-symbols:close-rounded")

    //- ── Body ───────────────────────────────────────────
    .OpenDialogAnnouncementEdit__body
      .OpenDialogAnnouncementEdit__loadingMask(v-if="loading") 載入中...

      //- 左欄：表單
      section.OpenDialogAnnouncementEdit__form(
        :class="{ 'is-hiddenOnMobile': showPreview }"
      )
        //- 模式警示
        .OpenDialogAnnouncementEdit__warning(
          v-if="props.params.mode === 'republish'"
        )
          | ⚠ 此動作會再次推送 LINE 給目標對象（如已啟用 LINE 渠道）。

        //- 標題
        .OpenDialogAnnouncementEdit__field
          label.OpenDialogAnnouncementEdit__label
            | 標題
            span.OpenDialogAnnouncementEdit__required *
          input.OpenDialogAnnouncementEdit__input(
            v-model="form.title"
            :maxlength="TITLE_MAX"
            placeholder="例如：母親節活動八折優惠"
          )
          .OpenDialogAnnouncementEdit__counter {{ titleLen }} / {{ TITLE_MAX }}

        //- 內文（TinyEditor）
        .OpenDialogAnnouncementEdit__field
          label.OpenDialogAnnouncementEdit__label
            | 內文
            span.OpenDialogAnnouncementEdit__required *
          TinyEditor(v-model="form.body")

        //- 封面圖
        .OpenDialogAnnouncementEdit__field
          label.OpenDialogAnnouncementEdit__label 封面圖（選填）
          .OpenDialogAnnouncementEdit__coverArea(
            v-if="!form.coverImageUrl"
            :class="{ 'is-uploading': uploadingCover }"
            @click="ClickPickCover"
            @dragover.prevent
            @drop="OnCoverDrop"
          )
            template(v-if="uploadingCover") 上傳中...
            template(v-else)
              .OpenDialogAnnouncementEdit__coverHint 拖放圖片至此 或 點擊選擇檔案
              .OpenDialogAnnouncementEdit__coverSubHint jpg / png / gif，&lt; 10MB
          .OpenDialogAnnouncementEdit__coverPreview(v-else)
            img(:src="form.coverImageUrl" alt="cover")
            button.OpenDialogAnnouncementEdit__coverRemove(
              type="button"
              @click="ClickRemoveCover"
            ) 移除
          input(
            ref="coverInputRef"
            type="file"
            accept="image/jpeg,image/png,image/gif"
            style="display:none"
            @change="OnCoverChange"
          )

        //- CTA 按鈕
        .OpenDialogAnnouncementEdit__field
          label.OpenDialogAnnouncementEdit__checkboxLabel
            input(type="checkbox" v-model="form.ctaEnabled")
            span 啟用 CTA 按鈕
          .OpenDialogAnnouncementEdit__ctaFields(v-if="form.ctaEnabled")
            input.OpenDialogAnnouncementEdit__input(
              v-model="form.ctaLabel"
              :maxlength="CTA_LABEL_MAX"
              placeholder="按鈕文字（例：立即訂車）"
            )
            input.OpenDialogAnnouncementEdit__input(
              v-model="form.ctaUrl"
              placeholder="https:// 開頭的網址"
              inputmode="url"
            )

        //- 目標對象
        .OpenDialogAnnouncementEdit__field
          label.OpenDialogAnnouncementEdit__label
            | 目標對象
            span.OpenDialogAnnouncementEdit__required *
          .OpenDialogAnnouncementEdit__radioGroup
            label.OpenDialogAnnouncementEdit__radio(
              v-for="opt in [{ k:'all', v:'全體' }, { k:'passenger', v:'乘客' }, { k:'driver', v:'司機' }, { k:'order', v:'指定訂單' }]"
              :key="opt.k"
              :class="{ 'is-active': form.targetType === opt.k }"
            )
              input(type="radio" v-model="form.targetType" :value="opt.k" hidden)
              span {{ opt.v }}
          input.OpenDialogAnnouncementEdit__input(
            v-if="form.targetType === 'order'"
            v-model="form.targetOrderId"
            placeholder="輸入訂單編號"
            style="margin-top:8px"
          )

        //- 推送渠道
        .OpenDialogAnnouncementEdit__field
          label.OpenDialogAnnouncementEdit__label
            | 推送渠道
            span.OpenDialogAnnouncementEdit__required *
          .OpenDialogAnnouncementEdit__channelRow
            label.OpenDialogAnnouncementEdit__checkboxLabel
              input(type="checkbox" v-model="form.channelLine")
              span LINE OA
            label.OpenDialogAnnouncementEdit__checkboxLabel
              input(type="checkbox" v-model="form.channelInApp")
              span App 內列表
          .OpenDialogAnnouncementEdit__hint
            template(v-if="props.params.mode === 'edit' && currentStatus === 'published'")
              | 編輯已發佈公告不會重推 LINE；若需重推請先下架再重新發佈。

      //- 右欄：預覽
      section.OpenDialogAnnouncementEdit__preview(
        :class="{ 'is-shownOnMobile': showPreview }"
      )
        OpenDialogAnnouncementPreview(
          :title="form.title"
          :body="form.body"
          :cover-image-url="form.coverImageUrl"
          :cta-button="form.ctaEnabled && form.ctaLabel && form.ctaUrl ? { label: form.ctaLabel, url: form.ctaUrl } : null"
        )

    //- ── Footer ─────────────────────────────────────────
    footer.OpenDialogAnnouncementEdit__footer
      button.OpenDialogAnnouncementEdit__btn.OpenDialogAnnouncementEdit__btn--ghost(
        type="button"
        :disabled="submitting"
        @click="ClickCancel"
      ) 取消
      button.OpenDialogAnnouncementEdit__btn.OpenDialogAnnouncementEdit__btn--secondary(
        v-if="showSaveDraft"
        type="button"
        :disabled="submitting"
        @click="ClickSaveDraft"
      ) {{ saveDraftLabel }}
      button.OpenDialogAnnouncementEdit__btn(
        type="button"
        :class="props.params.mode === 'republish' ? 'OpenDialogAnnouncementEdit__btn--danger' : 'OpenDialogAnnouncementEdit__btn--primary'"
        :disabled="submitting"
        @click="ClickPublish"
      ) {{ submitting ? '處理中...' : publishButtonLabel }}
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$danger: #c0392b;
$muted: rgba(255, 255, 255, 0.4);

.OpenDialogAnnouncementEdit {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: stretch;
  justify-content: center;
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
}

.OpenDialogAnnouncementEdit__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.OpenDialogAnnouncementEdit__panel {
  position: relative;
  margin: 4vh auto;
  width: min(1200px, 96vw);
  max-height: 92vh;
  background: $bg;
  border: 1px solid $border;
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}

// ── Header ────────────────────────────────────────────────
.OpenDialogAnnouncementEdit__header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid $border;
  flex-shrink: 0;
}

.OpenDialogAnnouncementEdit__headerLabel {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: $amber;
  display: flex;
  align-items: center;
  gap: 8px;
  &::before { content: ''; width: 16px; height: 1.5px; background: $amber; }
}

.OpenDialogAnnouncementEdit__headerTitle {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 24px;
  letter-spacing: 0.04em;
  margin: 0;
}

.OpenDialogAnnouncementEdit__headerActions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}

.OpenDialogAnnouncementEdit__previewToggle {
  display: none; // 桌機隱藏
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
}

.OpenDialogAnnouncementEdit__close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid $border;
  background: $surface;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

// ── Body ──────────────────────────────────────────────────
.OpenDialogAnnouncementEdit__body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.OpenDialogAnnouncementEdit__loadingMask {
  position: absolute;
  inset: 0;
  background: rgba(13, 15, 20, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  letter-spacing: 0.16em;
  color: $muted;
  z-index: 2;
}

.OpenDialogAnnouncementEdit__form {
  padding: 18px 22px 22px;
  overflow-y: auto;
  border-right: 1px solid $border;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.OpenDialogAnnouncementEdit__preview {
  padding: 18px 22px 22px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.2);
}

.OpenDialogAnnouncementEdit__warning {
  background: rgba($danger, 0.12);
  border: 1px solid rgba($danger, 0.4);
  color: #ffb4ab;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
}

// ── Field ─────────────────────────────────────────────────
.OpenDialogAnnouncementEdit__field { display: block; }

.OpenDialogAnnouncementEdit__label {
  display: block;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: $muted;
  margin-bottom: 8px;
}

.OpenDialogAnnouncementEdit__required {
  color: $amber;
  margin-left: 4px;
}

.OpenDialogAnnouncementEdit__input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
  &::placeholder { color: rgba(255, 255, 255, 0.25); }
  &:focus { border-color: rgba($amber, 0.5); }
}

.OpenDialogAnnouncementEdit__counter {
  text-align: right;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: $muted;
  margin-top: 4px;
}

// ── Cover ─────────────────────────────────────────────────
.OpenDialogAnnouncementEdit__coverArea {
  border: 2px dashed $border;
  border-radius: 12px;
  padding: 30px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
  background: rgba(255, 255, 255, 0.02);

  &:hover { border-color: rgba($amber, 0.4); background: rgba($amber, 0.04); }
  &.is-uploading { pointer-events: none; opacity: 0.6; }
}

.OpenDialogAnnouncementEdit__coverHint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 4px;
}

.OpenDialogAnnouncementEdit__coverSubHint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: $muted;
  letter-spacing: 0.08em;
}

.OpenDialogAnnouncementEdit__coverPreview {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid $border;

  img {
    display: block;
    width: 100%;
    max-height: 240px;
    object-fit: cover;
  }
}

.OpenDialogAnnouncementEdit__coverRemove {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 10px;
  border-radius: 100px;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  &:hover { background: rgba($danger, 0.8); }
}

// ── CTA / Channels / Radio ────────────────────────────────
.OpenDialogAnnouncementEdit__ctaFields {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.OpenDialogAnnouncementEdit__radioGroup {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.OpenDialogAnnouncementEdit__radio {
  padding: 6px 14px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: $muted;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.1);
    color: $amber;
  }
}

.OpenDialogAnnouncementEdit__channelRow {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.OpenDialogAnnouncementEdit__checkboxLabel {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;

  input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: $amber;
    cursor: pointer;
  }
}

.OpenDialogAnnouncementEdit__hint {
  margin-top: 6px;
  font-size: 11px;
  color: $muted;
  line-height: 1.5;
}

// ── Footer ────────────────────────────────────────────────
.OpenDialogAnnouncementEdit__footer {
  border-top: 1px solid $border;
  padding: 14px 22px;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.2);
}

.OpenDialogAnnouncementEdit__btn {
  padding: 10px 22px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: $surface;
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &--ghost {
    border-color: $border;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    &:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.2); }
  }

  &--secondary {
    border-color: $border;
    background: rgba(255, 255, 255, 0.06);
    &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
  }

  &--primary {
    background: $amber;
    color: #fff;
    &:hover:not(:disabled) { background: darken(#d4860a, 8%); }
  }

  &--danger {
    background: $danger;
    color: #fff;
    &:hover:not(:disabled) { background: darken(#c0392b, 8%); }
  }
}

// ── 響應式：手機 ───────────────────────────────────────────
@media (max-width: 768px) {
  .OpenDialogAnnouncementEdit__panel {
    margin: 0;
    width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }

  .OpenDialogAnnouncementEdit__previewToggle { display: inline-flex; }

  .OpenDialogAnnouncementEdit__body {
    grid-template-columns: 1fr;
  }

  .OpenDialogAnnouncementEdit__form {
    border-right: none;

    &.is-hiddenOnMobile { display: none; }
  }

  .OpenDialogAnnouncementEdit__preview {
    display: none;

    &.is-shownOnMobile { display: block; }
  }
}
</style>
