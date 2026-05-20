<script setup lang="ts">
import type {
  DocType,
  PendingDocument,
  VehicleProfileDto,
  VehicleProfilePendingDto,
} from '@/protocol/fetch-api/api/admin';

definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const { user, lineProfile } = storeToRefs(authStore);
const { SignOut } = authStore;

const displayName = computed(() => lineProfile.value?.displayName ?? '司機');
const pictureUrl  = computed(() => lineProfile.value?.pictureUrl ?? '');
const uid         = computed(() => user.value?.uid ?? '');
const lineUid     = computed(() => uid.value.startsWith('line:') ? uid.value.slice(5) : uid.value);

const totalTrips  = ref(0);
const joinedDate  = ref('—');

// P26：profile 編輯欄位
interface DriverDocs {
  licenseUrl?: string;
  registrationUrl?: string;
  insuranceUrl?: string;
  goodCitizenUrl?: string;
}
const phone = ref('');
const documents = ref<DriverDocs>({});
const documentsPending = ref<Partial<Record<DocType, PendingDocument>>>({});

// Phase 1B：driver-scope tags + vehicleProfile + pending
const driverTags = ref<string[]>([]);
const vehicleProfile = ref<VehicleProfileDto | null>(null);
const vehicleProfilePending = ref<VehicleProfilePendingDto | null>(null);

const DOC_FIELDS: { type: DocType; label: string }[] = [
  { type: 'licenseUrl', label: '駕照' },
  { type: 'registrationUrl', label: '行照' },
  { type: 'insuranceUrl', label: '保險卡' },
  { type: 'goodCitizenUrl', label: '良民證' },
];

const ApiLoadDriverData = async () => {
  if (!lineUid.value) return;
  try {
    const { getFirestore, doc, getDoc } = await import('firebase/firestore');
    const { getApps } = await import('firebase/app');
    const app = getApps()[0];
    if (!app) return;
    const db = getFirestore(app);

    // joinedDate 從 users doc 拿 createdAt
    const userSnap = await getDoc(doc(db, 'users', lineUid.value));
    if (userSnap.exists()) {
      const data = userSnap.data();
      if (data.createdAt?.toDate) {
        joinedDate.value = $dayjs(data.createdAt.toDate()).format('YYYY/MM/DD');
      }
    }

    // P26：phone + documents + documentsPending 從 drivers doc 拿
    const driverSnap = await getDoc(doc(db, 'drivers', lineUid.value));
    if (driverSnap.exists()) {
      const driverData = driverSnap.data() ?? {};
      const application = driverData.application as {
        phone?: string;
        documents?: DriverDocs;
        documentsPending?: Record<string, {
          url: string;
          uploadedAt?: { toDate?: () => Date } | string;
          status: 'pending' | 'rejected';
          rejectedAt?: { toDate?: () => Date } | string | null;
          rejectReason?: string | null;
        }>;
      } | undefined;

      phone.value = application?.phone ?? '';

      // Phase 1B：driver-scope tags + vehicleProfile + pending
      const _toIso = (v: unknown): string | null => {
        if (!v) return null;
        if (typeof v === 'string') return v;
        const t = v as { toDate?: () => Date };
        return t.toDate?.()?.toISOString?.() ?? null;
      };
      driverTags.value = Array.isArray(driverData.tags) ? (driverData.tags as string[]) : [];

      const vp = driverData.vehicleProfile as
        | { photos?: string[]; tags?: string[]; updatedAt?: unknown }
        | null
        | undefined;
      vehicleProfile.value = vp
        ? {
            photos: vp.photos ?? [],
            tags: vp.tags ?? [],
            updatedAt: _toIso(vp.updatedAt),
          }
        : null;

      const vpp = driverData.vehicleProfilePending as
        | {
            photos?: string[];
            tags?: string[];
            status?: 'draft' | 'pending_review' | 'rejected';
            submittedAt?: unknown;
            rejectedAt?: unknown;
            rejectReason?: string | null;
            reviewedBy?: string | null;
            updatedAt?: unknown;
          }
        | null
        | undefined;
      vehicleProfilePending.value = vpp
        ? {
            photos: vpp.photos ?? [],
            tags: vpp.tags ?? [],
            status: vpp.status ?? 'draft',
            submittedAt: _toIso(vpp.submittedAt),
            rejectedAt: _toIso(vpp.rejectedAt),
            rejectReason: vpp.rejectReason ?? null,
            reviewedBy: vpp.reviewedBy ?? null,
            updatedAt: _toIso(vpp.updatedAt),
          }
        : null;

      // P31：documents URL 透過 sign endpoint 重簽 4h（fallback 原 URL 不阻擋顯示）
      const rawDocs = application?.documents ?? {};
      const freshDocs: DriverDocs = {};
      await Promise.all((Object.keys(rawDocs) as DocType[]).map(async (k) => {
        const u = rawDocs[k];
        if (!u) return;
        try {
          const r = await $api.SignDriverDocument(u);
          freshDocs[k] = r.status?.code === $enum.apiStatus.success && r.data?.url ? r.data.url : u;
        } catch {
          freshDocs[k] = u;
        }
      }));
      documents.value = freshDocs;

      const pending: Partial<Record<DocType, PendingDocument>> = {};
      const _ts = (v: unknown): string | null => {
        if (!v) return null;
        if (typeof v === 'string') return v;
        const t = v as { toDate?: () => Date };
        return t.toDate?.()?.toISOString?.() ?? null;
      };
      for (const { type } of DOC_FIELDS) {
        const entry = application?.documentsPending?.[type];
        if (entry) {
          // P31：pending URL 也 resign（fallback 原 URL）
          let freshUrl = entry.url;
          try {
            const r = await $api.SignDriverDocument(entry.url);
            if (r.status?.code === $enum.apiStatus.success && r.data?.url) freshUrl = r.data.url;
          } catch { /* 保留原 url */ }
          pending[type] = {
            url: freshUrl,
            uploadedAt: _ts(entry.uploadedAt),
            status: entry.status,
            rejectedAt: _ts(entry.rejectedAt),
            rejectReason: entry.rejectReason ?? null,
          };
        }
      }
      documentsPending.value = pending;
    }
  } catch { /* 靜默失敗 */ }
};

const ApiLoadTripCount = async () => {
  if (!lineUid.value) return;
  const res = await $api.GetDriverStats(lineUid.value);
  if (res.status.code === 200 && res.data) {
    const data = res.data as DriverStats;
    totalTrips.value = data.tripsToday;
  }
};

// ── phone 編輯 ───────────────────────────────────────────
const editingPhone = ref(false);
const phoneDraft = ref('');
const savingPhone = ref(false);
const TW_MOBILE_RE = /^09\d{8}$/;

const ClickEditPhone = () => {
  phoneDraft.value = phone.value;
  editingPhone.value = true;
};

const ClickCancelPhone = () => {
  editingPhone.value = false;
  phoneDraft.value = '';
};

const ClickSavePhone = async () => {
  if (!TW_MOBILE_RE.test(phoneDraft.value)) {
    ElMessage({ message: '電話格式不正確（需 09 開頭 10 碼）', type: 'warning' });
    return;
  }
  savingPhone.value = true;
  const res = await $api.UpdateDriverSelfProfile({ phone: phoneDraft.value });
  savingPhone.value = false;
  if (res.status.code === 200) {
    phone.value = phoneDraft.value;
    editingPhone.value = false;
    ElMessage({ message: '電話已更新', type: 'success' });
  } else {
    ElMessage({ message: res.status.message.zh_tw ?? '更新失敗', type: 'error' });
  }
};

// ── 證件重新上傳 ──────────────────────────────────────
const uploadingType = ref<DocType | ''>('');
const fileInputs = ref<Record<DocType, HTMLInputElement | null>>({
  licenseUrl: null,
  registrationUrl: null,
  insuranceUrl: null,
  goodCitizenUrl: null,
});

const ClickPickFile = (docType: DocType) => {
  if (uploadingType.value) return;
  fileInputs.value[docType]?.click();
};

const ApiUploadAndReplace = async (docType: DocType, file: File) => {
  if (file.size > 5 * 1024 * 1024) {
    ElMessage({ message: '檔案超過 5MB', type: 'warning' });
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'].includes(file.type)) {
    ElMessage({ message: '僅支援 jpg / png / pdf', type: 'warning' });
    return;
  }
  uploadingType.value = docType;

  // 步驟 1：上傳到 Storage 拿 signed URL
  const upRes = await $api.UploadDriverDocument({ file, docType, lineUserId: lineUid.value });
  if (upRes.status.code !== 200 || !upRes.data?.url) {
    uploadingType.value = '';
    ElMessage({ message: upRes.status.message.zh_tw ?? '上傳失敗', type: 'error' });
    return;
  }

  // 步驟 2：寫入 documentsPending（不覆蓋現用證件）
  const repRes = await $api.ReplaceDriverDocument({ docType, url: upRes.data.url });
  uploadingType.value = '';
  if (repRes.status.code === 200) {
    documentsPending.value = {
      ...documentsPending.value,
      [docType]: {
        url: upRes.data.url,
        uploadedAt: new Date().toISOString(),
        status: 'pending',
      },
    };
    ElMessage({ message: '已送出審核，請等候管理員核准', type: 'success' });
  } else {
    ElMessage({ message: repRes.status.message.zh_tw ?? '送審失敗', type: 'error' });
  }
};

const ChangeFile = (docType: DocType, e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) ApiUploadAndReplace(docType, file);
  // 清空 input value 讓 driver 可以重新選同一個檔
  if (target) target.value = '';
};

const IsPdf = (url?: string) => !!url && url.toLowerCase().includes('.pdf');
const FormatTime = (iso: string | null) => iso ? $dayjs(iso).format('YYYY/MM/DD HH:mm') : '';

// ── 登出 ─────────────────────────────────────────────────
const signingOut = ref(false);
const ClickSignOut = async () => {
  const ok = await UseAsk('確定要登出嗎？');
  if (!ok) return;
  signingOut.value = true;
  await SignOut();
};

onMounted(() => {
  ApiLoadDriverData();
  ApiLoadTripCount();
});
</script>

<template lang="pug">
.PageDriverProfile
  .PageDriverProfile__header
    .PageDriverProfile__header-label MY PROFILE
    h1.PageDriverProfile__header-title 我的資料

  //- 頭像 + 名稱
  .PageDriverProfile__hero
    .PageDriverProfile__avatar-wrap
      img.PageDriverProfile__avatar(v-if="pictureUrl" :src="pictureUrl" alt="avatar")
      .PageDriverProfile__avatar-fallback(v-else) {{ displayName.slice(0, 1) }}
    .PageDriverProfile__hero-info
      .PageDriverProfile__name {{ displayName }}
      .PageDriverProfile__uid UID · {{ lineUid.slice(0, 8) }}

  //- 統計
  .PageDriverProfile__stats
    .PageDriverProfile__stat
      .PageDriverProfile__stat-label TODAY TRIPS
      .PageDriverProfile__stat-val {{ totalTrips }}
    .PageDriverProfile__stat
      .PageDriverProfile__stat-label JOINED
      .PageDriverProfile__stat-val {{ joinedDate }}
    .PageDriverProfile__stat
      .PageDriverProfile__stat-label ROLE
      .PageDriverProfile__stat-val 司機

  //- 聯絡電話（可編輯）
  .PageDriverProfile__section
    .PageDriverProfile__section-label CONTACT
    .PageDriverProfile__rows
      .PageDriverProfile__row
        span.PageDriverProfile__row-key 聯絡電話
        template(v-if="!editingPhone")
          .PageDriverProfile__row-right
            span.PageDriverProfile__row-val {{ phone || '尚未設定' }}
            button.PageDriverProfile__row-edit(@click="ClickEditPhone") 編輯
        template(v-else)
          .PageDriverProfile__row-editing
            ElInput(
              v-model="phoneDraft"
              maxlength="10"
              inputmode="numeric"
              placeholder="09xxxxxxxx"
              :disabled="savingPhone"
              size="small"
            )
            button.PageDriverProfile__row-save(
              :disabled="savingPhone"
              @click="ClickSavePhone"
            ) {{ savingPhone ? '...' : '儲存' }}
            button.PageDriverProfile__row-cancel(
              :disabled="savingPhone"
              @click="ClickCancelPhone"
            ) 取消

  //- 證件（可重新上傳，admin 核准前不覆蓋現用版本）
  .PageDriverProfile__section
    .PageDriverProfile__section-label DOCUMENTS
    .PageDriverProfile__docs
      .PageDriverProfile__doc(
        v-for="field in DOC_FIELDS"
        :key="field.type"
      )
        .PageDriverProfile__doc-label {{ field.label }}
        //- 現用證件預覽
        .PageDriverProfile__doc-preview
          template(v-if="documents[field.type]")
            img.PageDriverProfile__doc-img(
              v-if="!IsPdf(documents[field.type])"
              :src="documents[field.type]"
              :alt="field.label"
            )
            .PageDriverProfile__doc-pdf(v-else) 📄 PDF
          template(v-else)
            .PageDriverProfile__doc-empty 未上傳

        //- pending 狀態 banner
        template(v-if="documentsPending[field.type]")
          .PageDriverProfile__doc-banner(
            :class="{ 'is-rejected': documentsPending[field.type]?.status === 'rejected' }"
          )
            template(v-if="documentsPending[field.type]?.status === 'pending'")
              .PageDriverProfile__doc-banner-title 審核中
              .PageDriverProfile__doc-banner-sub {{ FormatTime(documentsPending[field.type]?.uploadedAt ?? null) }} 上傳
            template(v-else)
              .PageDriverProfile__doc-banner-title ⚠ 上次上傳被退回
              .PageDriverProfile__doc-banner-sub 退回原因：{{ documentsPending[field.type]?.rejectReason || '—' }}

        //- 上傳按鈕
        button.PageDriverProfile__doc-btn(
          :disabled="uploadingType !== ''"
          @click="ClickPickFile(field.type)"
        ) {{ uploadingType === field.type ? '上傳中...' : (documents[field.type] ? '重新上傳' : '上傳') }}
        input.PageDriverProfile__doc-input(
          :ref="el => fileInputs[field.type] = el as HTMLInputElement"
          type="file"
          accept="image/jpeg,image/png,image/jpg,application/pdf"
          @change="ChangeFile(field.type, $event)"
        )

  //- Phase 1B：車輛資料 + 司機能力標籤
  .PageDriverProfile__section
    .PageDriverProfile__section-label VEHICLE & SKILLS
    .PageDriverProfile__vehicle-wrap
      DriverVehicleProfileEditor(
        :driver-tags="driverTags"
        :vehicle-profile="vehicleProfile"
        :pending="vehicleProfilePending"
        @refresh="ApiLoadDriverData"
      )

  //- 帳號資訊
  .PageDriverProfile__section
    .PageDriverProfile__section-label ACCOUNT
    .PageDriverProfile__rows
      .PageDriverProfile__row
        span.PageDriverProfile__row-key LINE 帳號
        span.PageDriverProfile__row-val {{ displayName }}
      .PageDriverProfile__row
        span.PageDriverProfile__row-key 身份
        span.PageDriverProfile__row-val 已核准司機

  //- 登出
  button.PageDriverProfile__signout(
    :disabled="signingOut"
    @click="ClickSignOut"
  ) {{ signingOut ? '登出中...' : '登出' }}
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.35);
$danger: #f87171;

.PageDriverProfile {
  padding: 80px 20px 32px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageDriverProfile__header {
  margin-bottom: 24px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    letter-spacing: 0.04em;
    color: #fff;
  }
}

.PageDriverProfile__hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: $surface;
  border: 1px solid $border;
  border-radius: 18px;
  margin-bottom: 16px;
}

.PageDriverProfile__avatar-wrap { flex-shrink: 0; }

.PageDriverProfile__avatar {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba($amber, 0.4);
}

.PageDriverProfile__avatar-fallback {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: rgba($amber, 0.15);
  border: 2px solid rgba($amber, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: $amber;
}

.PageDriverProfile__hero-info { flex: 1; min-width: 0; }

.PageDriverProfile__name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
}

.PageDriverProfile__uid {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  margin-top: 2px;
}

.PageDriverProfile__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

@media (max-width: 479.98px) {
  .PageDriverProfile__stats {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}

.PageDriverProfile__stat {
  background: $surface;
  border: 1px solid $border;
  border-radius: 14px;
  padding: 12px 14px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: $muted;
    margin-bottom: 6px;
  }

  &-val {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 20px;
    color: #fff;
    line-height: 1;
  }
}

.PageDriverProfile__section {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 14px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: $muted;
    padding: 10px 16px 8px;
    border-bottom: 1px solid $border;
    background: rgba(255, 255, 255, 0.02);
  }
}

.PageDriverProfile__rows { display: flex; flex-direction: column; }

.PageDriverProfile__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  &:last-child { border-bottom: none; }

  &-key {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    color: $muted;
  }

  &-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.8);
  }
}

.PageDriverProfile__row-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PageDriverProfile__row-edit {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba($amber, 0.4);
  background: rgba($amber, 0.08);
  color: $amber;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba($amber, 0.16); }
}

.PageDriverProfile__row-editing {
  display: flex;
  align-items: center;
  gap: 6px;

  :deep(.el-input__wrapper) {
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 0 0 1px rgba($amber, 0.4) inset;
  }
  :deep(.el-input__inner) {
    color: #fff;
    font-family: 'Barlow', sans-serif;
  }
}

.PageDriverProfile__row-save,
.PageDriverProfile__row-cancel {
  padding: 6px 10px;
  border-radius: 8px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  border: 1px solid;
  transition: background 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.PageDriverProfile__row-save {
  border-color: rgba($amber, 0.4);
  background: $amber;
  color: #fff;
  &:hover:not(:disabled) { background: lighten($amber, 5%); }
}

.PageDriverProfile__row-cancel {
  border-color: rgba(255, 255, 255, 0.2);
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
}

// ── 證件區 ────────────────────────────────────────────
.PageDriverProfile__docs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 12px;
}

@media (max-width: 479.98px) {
  .PageDriverProfile__docs {
    grid-template-columns: 1fr;
  }
}

.PageDriverProfile__doc {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 10px;
}

.PageDriverProfile__doc-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.7);
}

.PageDriverProfile__doc-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

.PageDriverProfile__doc-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.PageDriverProfile__doc-pdf {
  font-family: 'Barlow', sans-serif;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.65);
}

.PageDriverProfile__doc-empty {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: $muted;
}

.PageDriverProfile__doc-banner {
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba($amber, 0.12);
  border: 1px solid rgba($amber, 0.35);

  &.is-rejected {
    background: rgba($danger, 0.1);
    border-color: rgba($danger, 0.4);
  }

  &-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: $amber;
  }

  &.is-rejected &-title { color: $danger; }

  &-sub {
    font-family: 'Barlow', sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 2px;
  }
}

.PageDriverProfile__doc-btn {
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba($amber, 0.4);
  background: rgba($amber, 0.08);
  color: $amber;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: background 0.15s;

  &:hover:not(:disabled) { background: rgba($amber, 0.16); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.PageDriverProfile__doc-input {
  display: none;
}

.PageDriverProfile__vehicle-wrap {
  padding: 12px;
}

.PageDriverProfile__signout {
  width: 100%;
  margin-top: 8px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 80, 80, 0.25);
  background: rgba(255, 80, 80, 0.06);
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 100, 100, 0.7);
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:active:not(:disabled) { transform: scale(0.98); }
}
</style>
