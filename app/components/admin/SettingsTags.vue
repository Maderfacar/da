<script setup lang="ts">
// Phase 1A：車輛 / 司機標籤管理（embedded in /admin/settings 「車輛標籤」tab）
//
// - 依 TAG_GROUPS_ORDERED 分群展示；每群一個 ElTable
// - 「載入預設標籤」按鈕：只在 tags 完全空時顯示（idempotent server side 已守住）
// - 新增 / 編輯走 OpenDialogTagEdit；archive / restore 走 inline 按鈕；audit log 走 ElDrawer

import { TAG_GROUPS_ORDERED, type TagGroup } from '~shared/tagTaxonomy';
import type { TagDto, TagAuditLogDto } from '@/protocol/fetch-api/api/tag';

const { t } = useI18n();

const tags = ref<TagDto[]>([]);
const loading = ref(false);
const seedLoading = ref(false);

const drawerOpen = ref(false);
const drawerTag = ref<TagDto | null>(null);
const drawerLogs = ref<TagAuditLogDto[]>([]);
const drawerLoading = ref(false);

const hasAnyTag = computed(() => tags.value.length > 0);

const tagsByGroup = (group: TagGroup): TagDto[] =>
  tags.value
    .filter((t) => t.group === group)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

// ── API ───────────────────────────────────────────────
const ApiLoadTags = async () => {
  loading.value = true;
  try {
    const res = await $api.GetTagList();
    if (res.status?.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入標籤失敗', type: 'error' });
      tags.value = [];
      return;
    }
    tags.value = res.data?.tags ?? [];
  } finally {
    loading.value = false;
  }
};

const ApiLoadAuditLogs = async (tagId: string) => {
  drawerLoading.value = true;
  try {
    const res = await $api.GetTagAuditLogs(tagId, { limit: 50 });
    if (res.status?.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入歷史失敗', type: 'error' });
      drawerLogs.value = [];
      return;
    }
    drawerLogs.value = res.data?.logs ?? [];
  } finally {
    drawerLoading.value = false;
  }
};

// ── Click handlers ────────────────────────────────────
const ClickLoadSeed = async () => {
  const ok = await UseAsk(t('admin.tagManagement.loadSeedConfirm'));
  if (!ok) return;
  seedLoading.value = true;
  try {
    const res = await $api.SeedTags();
    if (res.status?.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入失敗', type: 'error' });
      return;
    }
    const seeded = res.data?.seeded ?? 0;
    ElMessage({ message: `已載入 ${seeded} 個預設標籤`, type: 'success' });
    await ApiLoadTags();
  } finally {
    seedLoading.value = false;
  }
};

const ClickAdd = async (group: TagGroup) => {
  const result = await $open.DialogTagEdit({ mode: 'create', group });
  if (result === 'saved') await ApiLoadTags();
};

const ClickEdit = async (row: TagDto) => {
  const result = await $open.DialogTagEdit({ mode: 'edit', id: row.id });
  if (result === 'saved') await ApiLoadTags();
};

const ClickArchive = async (row: TagDto) => {
  const wantArchive = row.status === 'active';
  const messageKey = wantArchive
    ? 'admin.tagManagement.archiveConfirm'
    : 'admin.tagManagement.restoreConfirm';
  const ok = await UseAsk(t(messageKey, { name: row.name.zh_tw }));
  if (!ok) return;
  const res = await $api.ArchiveTag(row.id, { archive: wantArchive });
  if (res.status?.code !== $enum.apiStatus.success) {
    ElMessage({ message: res.status?.message?.zh_tw ?? '操作失敗', type: 'error' });
    return;
  }
  ElMessage({ message: wantArchive ? '已封存' : '已還原', type: 'success' });
  await ApiLoadTags();
};

const ClickAuditLogs = async (row: TagDto) => {
  drawerTag.value = row;
  drawerOpen.value = true;
  drawerLogs.value = [];
  await ApiLoadAuditLogs(row.id);
};

const FormatTimestamp = (iso: string | null): string =>
  iso ? $dayjs(iso).format('YYYY-MM-DD HH:mm:ss') : '—';

const FormatAction = (action: TagAuditLogDto['action']): string =>
  t(`admin.tagManagement.auditAction.${action}`);

const FormatJson = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const ShortUid = (uid: string): string => (uid.length > 12 ? `${uid.slice(0, 8)}…` : uid);

onMounted(() => {
  void ApiLoadTags();
});
</script>

<template lang="pug">
.AdminSettingsTags
  .AdminSettingsTags__header
    h3.AdminSettingsTags__title {{ $t('admin.tagManagement.title') }}
    p.AdminSettingsTags__desc {{ $t('admin.tagManagement.subtitle') }}
    ElButton(
      v-if="!loading && !hasAnyTag"
      type="primary"
      :loading="seedLoading"
      @click="ClickLoadSeed"
    ) {{ $t('admin.tagManagement.loadSeed') }}

  .AdminSettingsTags__loading(v-if="loading") 載入中...

  template(v-else)
    .AdminSettingsTags__group(v-for="entry in TAG_GROUPS_ORDERED" :key="entry[0]")
      .AdminSettingsTags__group-head
        span.AdminSettingsTags__group-name {{ entry[1].label.zh_tw }}
        span.AdminSettingsTags__group-meta
          | {{ entry[1].multiplicity === 'single' ? $t('admin.tagManagement.multiplicitySingle') : $t('admin.tagManagement.multiplicityMulti') }}
          | ·
          | {{ entry[1].scope === 'driver' ? $t('admin.tagManagement.scopeDriver') : $t('admin.tagManagement.scopeVehicle') }}
        ElButton(size="small" @click="ClickAdd(entry[0])") {{ $t('admin.tagManagement.addTag') }}

      ElTable(
        :data="tagsByGroup(entry[0])"
        size="small"
        :empty-text="'此群組尚無標籤'"
      )
        ElTableColumn(:label="$t('admin.tagManagement.fieldNameZh')" prop="name.zh_tw" width="160")
        ElTableColumn(label="EN / JA")
          template(#default="{ row }")
            span {{ row.name.en || '—' }} / {{ row.name.ja || '—' }}
        ElTableColumn(:label="$t('admin.tagManagement.fieldSurcharge')" prop="surchargeAmount" width="120")
          template(#default="{ row }")
            span NT$ {{ row.surchargeAmount }}
        ElTableColumn(:label="$t('admin.tagManagement.fieldSortOrder')" prop="sortOrder" width="90")
        ElTableColumn(label="狀態" width="100")
          template(#default="{ row }")
            ElTag(
              :type="row.status === 'active' ? 'success' : 'info'"
              size="small"
            ) {{ row.status === 'active' ? $t('admin.tagManagement.statusActive') : $t('admin.tagManagement.statusArchived') }}
        ElTableColumn(label="操作" width="260")
          template(#default="{ row }")
            ElButton(size="small" @click="ClickEdit(row)") 編輯
            ElButton(size="small" @click="ClickArchive(row)")
              | {{ row.status === 'active' ? $t('admin.tagManagement.btnArchive') : $t('admin.tagManagement.btnRestore') }}
            ElButton(size="small" @click="ClickAuditLogs(row)") {{ $t('admin.tagManagement.btnAuditLogs') }}

  //- Audit log drawer
  ElDrawer(
    v-model="drawerOpen"
    :title="drawerTag ? `${drawerTag.name.zh_tw} 歷史紀錄` : '歷史紀錄'"
    size="520px"
    direction="rtl"
  )
    .AdminSettingsTags__drawerBody
      .AdminSettingsTags__drawerLoading(v-if="drawerLoading") 載入中...
      template(v-else)
        .AdminSettingsTags__drawerEmpty(v-if="drawerLogs.length === 0") 此標籤尚無歷史紀錄
        .AdminSettingsTags__log(v-for="log in drawerLogs" :key="log.id")
          .AdminSettingsTags__logHead
            ElTag(size="small") {{ FormatAction(log.action) }}
            span.AdminSettingsTags__logTime {{ FormatTimestamp(log.performedAt) }}
            span.AdminSettingsTags__logActor {{ log.performedByEmail || ShortUid(log.performedBy) }}
          .AdminSettingsTags__logBody
            details
              summary before
              pre {{ FormatJson(log.beforeSnapshot) }}
            details(open)
              summary after
              pre {{ FormatJson(log.afterSnapshot) }}
</template>

<style lang="scss" scoped>
.AdminSettingsTags {
  padding: 14px 16px;
  color: #fff;
}

.AdminSettingsTags__header {
  margin-bottom: 16px;
}

.AdminSettingsTags__title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 4px;
}

.AdminSettingsTags__desc {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin: 0 0 12px;
}

.AdminSettingsTags__loading {
  padding: 24px;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
}

.AdminSettingsTags__group {
  margin-bottom: 20px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.AdminSettingsTags__group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.AdminSettingsTags__group-name {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
}

.AdminSettingsTags__group-meta {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  margin-right: auto;
}

.AdminSettingsTags__drawerBody {
  padding: 12px 4px;
}

.AdminSettingsTags__drawerLoading,
.AdminSettingsTags__drawerEmpty {
  padding: 24px 12px;
  text-align: center;
  color: rgba(0, 0, 0, 0.45);
}

.AdminSettingsTags__log {
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
}

.AdminSettingsTags__logHead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.AdminSettingsTags__logTime {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.AdminSettingsTags__logActor {
  font-size: 12px;
  font-family: 'Barlow Condensed', sans-serif;
  letter-spacing: 0.05em;
  color: rgba(0, 0, 0, 0.45);
}

.AdminSettingsTags__logBody {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.65);

  :deep(summary) {
    cursor: pointer;
    padding: 2px 0;
    font-weight: 600;
  }

  :deep(pre) {
    background: rgba(0, 0, 0, 0.04);
    border-radius: 6px;
    padding: 8px;
    margin: 4px 0 8px;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: 'Fira Code', monospace;
  }
}
</style>
