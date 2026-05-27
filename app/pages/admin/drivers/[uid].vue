<script setup lang="ts">
import type {
  DocType,
  PendingDocument,
  VehicleProfileDto,
  VehicleProfilePendingDto,
} from '@/protocol/fetch-api/api/admin';
import type { TagDto } from '@/protocol/fetch-api/api/tag';
import {
  DRIVER_CATEGORY,
  DRIVER_CATEGORY_LABEL,
  DRIVER_CATEGORY_VALUES,
  isDriverCategory,
  type DriverCategory,
} from '~shared/types/driver-category';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const route = useRoute();
const router = useRouter();
const uid = computed(() => String(route.params.uid ?? ''));

interface DriverDocs {
  licenseUrl?: string;
  registrationUrl?: string;
  insuranceUrl?: string;
  goodCitizenUrl?: string;
}

interface DriverDetail {
  displayName: string;
  pictureUrl: string;
  approved: boolean;
  driverCategory: string;
  application: {
    driverName: string;
    phone: string;
    plateNumber: string;
    vehicleType: string;
    vehicleModel: string;
    bankCode: string;
    bankAccount: string;
    documents: DriverDocs;
    documentsPending: Partial<Record<DocType, PendingDocument>>;
    appliedAt: string;
    reviewedAt: string;
    rejectedAt: string;
    rejectReason: string;
  };
  // Phase 1B：driver doc top-level
  tags: string[];
  vehicleProfile: VehicleProfileDto | null;
  vehicleProfilePending: VehicleProfilePendingDto | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

const loading = ref(false);
const driver = ref<DriverDetail | null>(null);
const activeTab = ref<'basic' | 'documents' | 'vehicle'>('basic');

// Phase 1B：active tags 索引（id → TagDto）給 VehicleProfileReview 顯示中文名稱用
const tagIndex = ref<Map<string, TagDto>>(new Map());

const ApiLoadTagIndex = async () => {
  try {
    const res = await $api.GetActiveTags();
    if (res.status?.code === $enum.apiStatus.success && res.data?.tags) {
      const m = new Map<string, TagDto>();
      for (const t of res.data.tags) m.set(t.id, t);
      tagIndex.value = m;
    }
  } catch { /* silent */ }
};

const DOC_FIELDS: { type: DocType; label: string }[] = [
  { type: 'licenseUrl', label: '駕照' },
  { type: 'registrationUrl', label: '行照' },
  { type: 'insuranceUrl', label: '保險卡' },
  { type: 'goodCitizenUrl', label: '良民證' },
];

const VEHICLE_LABEL: Record<string, string> = {
  sedan: '轎車',
  mpv: 'MPV',
  suv: 'SUV',
  van: '廂型車',
};

// 新欄位 vehicleModel 自由文字優先；舊資料 fallback 顯示 4 選 1 分類
const VehicleDisplay = (app: { vehicleModel?: string; vehicleType?: string }): string => {
  const m = app.vehicleModel?.trim();
  if (m) return m;
  const t = app.vehicleType?.trim();
  if (!t) return '—';
  return VEHICLE_LABEL[t] ?? t;
};

const _ts = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const t = v as { toDate?: () => Date };
  return t.toDate?.()?.toISOString?.() ?? null;
};

const ApiLoadDriver = async () => {
  if (!uid.value) return;
  loading.value = true;
  try {
    const { getFirestore, doc, getDoc } = await import('firebase/firestore');
    const { getApps } = await import('firebase/app');
    const app = getApps()[0];
    if (!app) { loading.value = false; return; }
    const db = getFirestore(app);

    const [userSnap, driverSnap] = await Promise.all([
      getDoc(doc(db, 'users', uid.value)),
      getDoc(doc(db, 'drivers', uid.value)),
    ]);

    if (!userSnap.exists() && !driverSnap.exists()) {
      driver.value = null;
      loading.value = false;
      return;
    }

    const userData = userSnap.exists() ? userSnap.data() : {};
    const driverData = driverSnap.exists() ? driverSnap.data() : {};
    const app1 = (driverData.application ?? {}) as Record<string, unknown>;

    // 序列化 documentsPending 內的 Timestamp
    const pendingRaw = (app1.documentsPending ?? {}) as Record<string, {
      url?: string;
      uploadedAt?: unknown;
      status?: 'pending' | 'rejected';
      rejectedAt?: unknown;
      rejectReason?: string | null;
    }>;
    const pending: Partial<Record<DocType, PendingDocument>> = {};
    for (const { type } of DOC_FIELDS) {
      const entry = pendingRaw[type];
      if (entry && entry.url) {
        pending[type] = {
          url: entry.url,
          uploadedAt: _ts(entry.uploadedAt),
          status: (entry.status ?? 'pending') as 'pending' | 'rejected',
          rejectedAt: _ts(entry.rejectedAt),
          rejectReason: entry.rejectReason ?? null,
        };
      }
    }

    // P31：documents + documentsPending 透過 sign endpoint 重簽 4h URL（fallback 原 URL 不阻擋）
    const rawDocs = (app1.documents ?? {}) as DriverDocs;
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
    await Promise.all((Object.keys(pending) as DocType[]).map(async (k) => {
      const e = pending[k];
      if (!e?.url) return;
      try {
        const r = await $api.SignDriverDocument(e.url);
        if (r.status?.code === $enum.apiStatus.success && r.data?.url) e.url = r.data.url;
      } catch { /* 保留原 url */ }
    }));

    // Phase 1B：driver doc top-level
    const vpRaw = driverData.vehicleProfile as
      | { photos?: string[]; tags?: string[]; updatedAt?: unknown }
      | null
      | undefined;
    const vppRaw = driverData.vehicleProfilePending as
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

    driver.value = {
      displayName: (userData.displayName as string) ?? '',
      pictureUrl: (userData.pictureUrl as string) ?? '',
      approved: (userData.approved as boolean) ?? false,
      driverCategory: (driverData.driverCategory as string) ?? '',
      application: {
        driverName: (app1.driverName as string) ?? '',
        phone: (app1.phone as string) ?? '',
        plateNumber: (app1.plateNumber as string) ?? '',
        vehicleType: (app1.vehicleType as string) ?? '',
        vehicleModel: (app1.vehicleModel as string) ?? '',
        bankCode: (app1.bankCode as string) ?? '',
        bankAccount: (app1.bankAccount as string) ?? '',
        documents: freshDocs,
        documentsPending: pending,
        appliedAt: _ts(app1.appliedAt) ?? '',
        reviewedAt: _ts(app1.reviewedAt) ?? '',
        rejectedAt: _ts(app1.rejectedAt) ?? '',
        rejectReason: (app1.rejectReason as string) ?? '',
      },
      tags: Array.isArray(driverData.tags) ? (driverData.tags as string[]) : [],
      vehicleProfile: vpRaw
        ? {
            photos: vpRaw.photos ?? [],
            tags: vpRaw.tags ?? [],
            updatedAt: _ts(vpRaw.updatedAt),
          }
        : null,
      vehicleProfilePending: vppRaw
        ? {
            photos: vppRaw.photos ?? [],
            tags: vppRaw.tags ?? [],
            status: vppRaw.status ?? 'draft',
            submittedAt: _ts(vppRaw.submittedAt),
            rejectedAt: _ts(vppRaw.rejectedAt),
            rejectReason: vppRaw.rejectReason ?? null,
            reviewedBy: vppRaw.reviewedBy ?? null,
            updatedAt: _ts(vppRaw.updatedAt),
          }
        : null,
      verifiedAt: _ts(driverData.verifiedAt),
      verifiedBy: (driverData.verifiedBy as string | null) ?? null,
    };
  } catch (err) {
    console.error('[admin/drivers/[uid]] load failed:', err);
    driver.value = null;
  } finally {
    loading.value = false;
  }
};

// ── phone 編輯 ────────────────────────────────────────────
const editingPhone = ref(false);
const phoneDraft = ref('');
const savingPhone = ref(false);
const TW_MOBILE_RE = /^09\d{8}$/;

const ClickEditPhone = () => {
  if (!driver.value) return;
  phoneDraft.value = driver.value.application.phone;
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
  if (!driver.value) return;
  savingPhone.value = true;
  const res = await $api.PatchAdminDriver(uid.value, { phone: phoneDraft.value });
  savingPhone.value = false;
  if (res.status.code === 200) {
    driver.value.application.phone = phoneDraft.value;
    editingPhone.value = false;
    ElMessage({ message: '電話已更新', type: 'success' });
  } else {
    ElMessage({ message: res.status.message.zh_tw ?? '更新失敗', type: 'error' });
  }
};

// ── 司機分級編輯（Wave 2A）────────────────────────────────
// driverCategory '0' NOVICE / '1' STANDARD / '2' PRO，影響派單分級可見性
// 提交呼叫 PATCH /nuxt-api/admin/users/{uid} 既有 endpoint（已支援 driverCategory + audit log）
const editingCategory = ref(false);
const categoryDraft = ref<DriverCategory>(DRIVER_CATEGORY.NOVICE);
const savingCategory = ref(false);
const lastCategoryChange = ref<{ at: string; actor: string } | null>(null);

const categoryOptions = computed(() =>
  DRIVER_CATEGORY_VALUES.map((v) => ({
    value: v,
    label: `${DRIVER_CATEGORY_LABEL[v].zh}（${v}）`,
  })),
);

const currentCategoryLabel = computed(() => {
  const raw = driver.value?.driverCategory;
  const key: DriverCategory = isDriverCategory(raw) ? raw : DRIVER_CATEGORY.NOVICE;
  return `${DRIVER_CATEGORY_LABEL[key].zh}（${key}）`;
});

const ClickEditCategory = () => {
  if (!driver.value) return;
  const raw = driver.value.driverCategory;
  categoryDraft.value = isDriverCategory(raw) ? raw : DRIVER_CATEGORY.NOVICE;
  editingCategory.value = true;
};

const ClickCancelCategory = () => {
  editingCategory.value = false;
};

const ApiLoadLastCategoryChange = async () => {
  // 從 audit_logs 撈最新一筆 driver.category_change（client-side 直接讀 firestore；rules 已限 admin 可讀）
  if (!uid.value) return;
  try {
    const { getFirestore, collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');
    const { getApps } = await import('firebase/app');
    const app = getApps()[0];
    if (!app) return;
    const db = getFirestore(app);
    const q = query(
      collection(db, 'audit_logs'),
      where('targetType', '==', 'driver'),
      where('targetId', '==', uid.value),
      where('action', '==', 'driver.category_change'),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      lastCategoryChange.value = null;
      return;
    }
    const data = snap.docs[0]?.data() ?? {};
    const ts = data.createdAt as { toDate?: () => Date } | undefined;
    const iso = ts?.toDate?.()?.toISOString?.() ?? '';
    lastCategoryChange.value = {
      at: iso,
      actor: (data.actorDisplayName as string) || (data.actorUid as string) || '—',
    };
  } catch (err) {
    // audit_logs rules 限制非 admin 讀會 throw；非 admin 進不來，silent
    console.warn('[admin/drivers/[uid]] load last category change failed:', err);
    lastCategoryChange.value = null;
  }
};

const ClickSaveCategory = async () => {
  if (!driver.value) return;
  if (!isDriverCategory(categoryDraft.value)) {
    ElMessage({ message: '司機分級值不合法', type: 'warning' });
    return;
  }
  const before = isDriverCategory(driver.value.driverCategory)
    ? (driver.value.driverCategory as DriverCategory)
    : DRIVER_CATEGORY.NOVICE;
  if (categoryDraft.value === before) {
    ElMessage({ message: '分級未變更', type: 'info' });
    editingCategory.value = false;
    return;
  }

  const ok = await UseAsk().Any(
    `將司機分級從「${DRIVER_CATEGORY_LABEL[before].zh}（${before}）」變更為「${DRIVER_CATEGORY_LABEL[categoryDraft.value].zh}（${categoryDraft.value}）」？\n此變更會影響該司機可見的派單範圍。`,
    '變更司機分級',
    '取消',
    '確定變更',
  );
  if (!ok) return;

  savingCategory.value = true;
  try {
    const res = await $api.PatchAdminUser(uid.value, { driverCategory: categoryDraft.value });
    if (res.status.code === $enum.apiStatus.success) {
      driver.value.driverCategory = categoryDraft.value;
      editingCategory.value = false;
      ElMessage({ message: '司機分級已更新', type: 'success' });
      void ApiLoadLastCategoryChange();
    } else {
      ElMessage({ message: res.status.message?.zh_tw ?? '更新失敗', type: 'error' });
    }
  } finally {
    savingCategory.value = false;
  }
};

// ── 證件審批 ──────────────────────────────────────────────
const reviewing = ref<DocType | ''>('');

const ClickApproveDoc = async (docType: DocType) => {
  const ok = await UseAsk(`核准此「${DOC_FIELDS.find((f) => f.type === docType)?.label}」變更？\n核准後新版證件會立即覆蓋現用版本。`);
  if (!ok) return;
  reviewing.value = docType;
  const res = await $api.ReviewDriverDocument(uid.value, { docType, decision: 'approve' });
  reviewing.value = '';
  if (res.status.code === 200) {
    ElMessage({ message: '已核准，已通知司機', type: 'success' });
    await ApiLoadDriver();
  } else {
    ElMessage({ message: res.status.message.zh_tw ?? '操作失敗', type: 'error' });
  }
};

const ClickRejectDoc = async (docType: DocType) => {
  const reason = window.prompt('請輸入退回原因（將傳給司機）') ?? '';
  if (!reason.trim()) return;
  reviewing.value = docType;
  const res = await $api.ReviewDriverDocument(uid.value, { docType, decision: 'reject', reason: reason.trim() });
  reviewing.value = '';
  if (res.status.code === 200) {
    ElMessage({ message: '已退回，已通知司機', type: 'warning' });
    await ApiLoadDriver();
  } else {
    ElMessage({ message: res.status.message.zh_tw ?? '操作失敗', type: 'error' });
  }
};

const IsPdf = (url?: string) => !!url && url.toLowerCase().includes('.pdf');
const FormatTime = (iso: string | null) => iso ? $dayjs(iso).format('YYYY/MM/DD HH:mm') : '—';

const ClickBack = () => router.push('/admin/drivers');

onMounted(() => {
  void ApiLoadDriver();
  void ApiLoadTagIndex();
  void ApiLoadLastCategoryChange();
});
</script>

<template lang="pug">
.PageAdminDriverDetail
  //- header
  .PageAdminDriverDetail__header
    button.PageAdminDriverDetail__back(@click="ClickBack") ← 返回列表
    h1.PageAdminDriverDetail__title 司機詳情

  template(v-if="loading")
    .PageAdminDriverDetail__loading 載入中...

  template(v-else-if="!driver")
    .PageAdminDriverDetail__empty 找不到該司機

  template(v-else)
    //- 司機卡片頂部
    .PageAdminDriverDetail__hero
      img.PageAdminDriverDetail__avatar(v-if="driver.pictureUrl" :src="driver.pictureUrl" alt="avatar")
      .PageAdminDriverDetail__avatar-fallback(v-else) {{ driver.displayName.slice(0, 1) || '?' }}
      .PageAdminDriverDetail__hero-info
        .PageAdminDriverDetail__hero-name {{ driver.application.driverName || driver.displayName }}
        .PageAdminDriverDetail__hero-meta
          span(:class="['status-pill', driver.approved ? 'is-approved' : 'is-pending']") {{ driver.approved ? '已核准' : '未核准' }}
          span.PageAdminDriverDetail__hero-uid UID: {{ uid.slice(0, 12) }}...

    //- Tabs
    ElTabs(v-model="activeTab" class="PageAdminDriverDetail__tabs")
      ElTabPane(label="基本資料" name="basic")
        .PageAdminDriverDetail__pane
          .PageAdminDriverDetail__rows
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key 司機真實姓名
              span.PageAdminDriverDetail__row-val {{ driver.application.driverName || '—' }}
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key 聯絡電話
              template(v-if="!editingPhone")
                .PageAdminDriverDetail__row-right
                  span.PageAdminDriverDetail__row-val {{ driver.application.phone || '—' }}
                  button.PageAdminDriverDetail__row-edit(@click="ClickEditPhone") 編輯
              template(v-else)
                .PageAdminDriverDetail__row-editing
                  ElInput(
                    v-model="phoneDraft"
                    maxlength="10"
                    inputmode="numeric"
                    placeholder="09xxxxxxxx"
                    :disabled="savingPhone"
                    size="small"
                  )
                  ElButton(type="primary" size="small" :loading="savingPhone" @click="ClickSavePhone") 儲存
                  ElButton(size="small" :disabled="savingPhone" @click="ClickCancelPhone") 取消
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key 車牌號碼
              span.PageAdminDriverDetail__row-val {{ driver.application.plateNumber || '—' }}
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key 車輛品牌與型號
              span.PageAdminDriverDetail__row-val {{ VehicleDisplay(driver.application) }}
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key 銀行代號 / 帳號
              span.PageAdminDriverDetail__row-val {{ driver.application.bankCode || '—' }} / {{ driver.application.bankAccount || '—' }}
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key 申請時間
              span.PageAdminDriverDetail__row-val {{ FormatTime(driver.application.appliedAt) }}
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key 上次審核時間
              span.PageAdminDriverDetail__row-val {{ FormatTime(driver.application.reviewedAt) }}
            .PageAdminDriverDetail__row(v-if="driver.application.rejectedAt")
              span.PageAdminDriverDetail__row-key 上次退回原因
              span.PageAdminDriverDetail__row-val {{ driver.application.rejectReason || '—' }}

            //- Wave 2A：司機分級編輯（NOVICE / STANDARD / PRO）
            .PageAdminDriverDetail__row
              span.PageAdminDriverDetail__row-key {{ $t('admin.drivers.categoryEdit.label') }}
              template(v-if="!editingCategory")
                .PageAdminDriverDetail__row-right
                  span.PageAdminDriverDetail__row-val {{ currentCategoryLabel }}
                  button.PageAdminDriverDetail__row-edit(@click="ClickEditCategory") {{ $t('admin.drivers.categoryEdit.edit') }}
              template(v-else)
                .PageAdminDriverDetail__row-editing
                  ElSelect(
                    v-model="categoryDraft"
                    size="small"
                    :disabled="savingCategory"
                    value-on-clear=""
                    style="min-width: 140px"
                  )
                    ElOption(
                      v-for="opt in categoryOptions"
                      :key="opt.value"
                      :value="opt.value"
                      :label="opt.label"
                    )
                  ElButton(type="primary" size="small" :loading="savingCategory" @click="ClickSaveCategory") {{ $t('admin.drivers.categoryEdit.save') }}
                  ElButton(size="small" :disabled="savingCategory" @click="ClickCancelCategory") {{ $t('admin.drivers.categoryEdit.cancel') }}
            .PageAdminDriverDetail__row(v-if="lastCategoryChange")
              span.PageAdminDriverDetail__row-key {{ $t('admin.drivers.categoryEdit.lastChanged') }}
              span.PageAdminDriverDetail__row-val
                | {{ FormatTime(lastCategoryChange.at) }}
                |  ·
                | {{ lastCategoryChange.actor }}

      ElTabPane(:label="`車輛 Profile ${driver.vehicleProfilePending?.status === 'pending_review' ? '⚠ 待審' : ''}`" name="vehicle")
        .PageAdminDriverDetail__pane
          AdminVehicleProfileReview(
            :uid="uid"
            :current="driver.vehicleProfile"
            :pending="driver.vehicleProfilePending"
            :verified-at="driver.verifiedAt"
            :verified-by="driver.verifiedBy"
            :tag-index="tagIndex"
            @refresh="ApiLoadDriver"
          )

      ElTabPane(:label="`證件審核 ${Object.keys(driver.application.documentsPending).length ? '(' + Object.keys(driver.application.documentsPending).length + ')' : ''}`" name="documents")
        .PageAdminDriverDetail__pane
          .PageAdminDriverDetail__docs
            .PageAdminDriverDetail__doc(v-for="field in DOC_FIELDS" :key="field.type")
              .PageAdminDriverDetail__doc-head {{ field.label }}
              .PageAdminDriverDetail__doc-row
                //- 現用版
                .PageAdminDriverDetail__doc-col
                  .PageAdminDriverDetail__doc-col-label CURRENT
                  .PageAdminDriverDetail__doc-preview
                    template(v-if="driver.application.documents[field.type]")
                      img.PageAdminDriverDetail__doc-img(
                        v-if="!IsPdf(driver.application.documents[field.type])"
                        :src="driver.application.documents[field.type]"
                        :alt="field.label"
                      )
                      .PageAdminDriverDetail__doc-pdf(v-else) 📄 PDF
                    template(v-else)
                      .PageAdminDriverDetail__doc-empty 未上傳
                //- pending 版
                .PageAdminDriverDetail__doc-col
                  .PageAdminDriverDetail__doc-col-label
                    template(v-if="driver.application.documentsPending[field.type]?.status === 'pending'") PENDING（待審核）
                    template(v-else-if="driver.application.documentsPending[field.type]?.status === 'rejected'") REJECTED（已退回）
                    template(v-else) NO PENDING
                  .PageAdminDriverDetail__doc-preview(v-if="driver.application.documentsPending[field.type]")
                    img.PageAdminDriverDetail__doc-img(
                      v-if="!IsPdf(driver.application.documentsPending[field.type]?.url)"
                      :src="driver.application.documentsPending[field.type]?.url"
                      :alt="field.label"
                    )
                    .PageAdminDriverDetail__doc-pdf(v-else) 📄 PDF
                  .PageAdminDriverDetail__doc-preview(v-else)
                    .PageAdminDriverDetail__doc-empty —

              //- pending meta + 操作按鈕
              .PageAdminDriverDetail__doc-meta(v-if="driver.application.documentsPending[field.type]")
                .PageAdminDriverDetail__doc-meta-line {{ FormatTime(driver.application.documentsPending[field.type]?.uploadedAt ?? null) }} 上傳
                .PageAdminDriverDetail__doc-meta-line(
                  v-if="driver.application.documentsPending[field.type]?.status === 'rejected'"
                  style="color: #f87171"
                ) 退回原因：{{ driver.application.documentsPending[field.type]?.rejectReason || '—' }}
                .PageAdminDriverDetail__doc-actions(v-if="driver.application.documentsPending[field.type]?.status === 'pending'")
                  ElButton(
                    type="success"
                    size="small"
                    :loading="reviewing === field.type"
                    @click="ClickApproveDoc(field.type)"
                  ) 核准（覆蓋現用）
                  ElButton(
                    type="danger"
                    size="small"
                    plain
                    :disabled="reviewing !== ''"
                    @click="ClickRejectDoc(field.type)"
                  ) 退回（需填原因）
</template>

<style lang="scss" scoped>
.PageAdminDriverDetail {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.PageAdminDriverDetail__header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.PageAdminDriverDetail__back {
  padding: 6px 12px;
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;

  &:hover { background: #f5f7fa; }
}

.PageAdminDriverDetail__title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.PageAdminDriverDetail__loading,
.PageAdminDriverDetail__empty {
  padding: 60px 0;
  text-align: center;
  color: #909399;
}

.PageAdminDriverDetail__hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  margin-bottom: 16px;
}

.PageAdminDriverDetail__avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  object-fit: cover;
}

.PageAdminDriverDetail__avatar-fallback {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: #ecf5ff;
  color: #409eff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 600;
}

.PageAdminDriverDetail__hero-name {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.PageAdminDriverDetail__hero-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.status-pill {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;

  &.is-approved {
    background: #f0f9eb;
    color: #67c23a;
  }
  &.is-pending {
    background: #fdf6ec;
    color: #e6a23c;
  }
}

.PageAdminDriverDetail__hero-uid {
  font-size: 12px;
  color: #909399;
  font-family: 'Barlow', sans-serif;
}

.PageAdminDriverDetail__tabs {
  background: #fff;
  border-radius: 12px;
  padding: 0 16px;
}

.PageAdminDriverDetail__pane {
  padding: 16px 0;
}

.PageAdminDriverDetail__rows {
  display: flex;
  flex-direction: column;
}

.PageAdminDriverDetail__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #f0f2f5;

  &:last-child { border-bottom: none; }

  &-key {
    color: #909399;
    font-size: 13px;
  }

  &-val {
    color: #303133;
    font-size: 14px;
    font-weight: 500;
    text-align: right;
    max-width: 60%;
    word-break: break-word;
  }
}

.PageAdminDriverDetail__row-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PageAdminDriverDetail__row-edit {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #409eff;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
  cursor: pointer;

  &:hover { background: #d9ecff; }
}

.PageAdminDriverDetail__row-editing {
  display: flex;
  align-items: center;
  gap: 6px;
}

.PageAdminDriverDetail__docs {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.PageAdminDriverDetail__doc {
  background: #fafbfc;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px;
}

.PageAdminDriverDetail__doc-head {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.PageAdminDriverDetail__doc-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 599.98px) {
  .PageAdminDriverDetail__doc-row {
    grid-template-columns: 1fr;
  }
}

.PageAdminDriverDetail__doc-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageAdminDriverDetail__doc-col-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #909399;
}

.PageAdminDriverDetail__doc-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 6px;
  overflow: hidden;
  background: #f0f2f5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.PageAdminDriverDetail__doc-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.PageAdminDriverDetail__doc-pdf,
.PageAdminDriverDetail__doc-empty {
  font-size: 13px;
  color: #909399;
}

.PageAdminDriverDetail__doc-meta {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #ebeef5;

  &-line {
    font-size: 12px;
    color: #606266;
    margin-bottom: 4px;
  }
}

.PageAdminDriverDetail__doc-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
</style>
