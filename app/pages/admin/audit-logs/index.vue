<script setup lang="ts">
// P25-2 Admin Operation Audit Log
// 僅 super admin 可訪問；client 端 middleware role 已擋非 admin，
// 此頁額外用 isSuper 判斷渲染。Backend GET /nuxt-api/admin/audit-logs 也是 super-only。

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const { t } = useI18n();
const authStore = StoreAuth();
const { isSuper } = storeToRefs(authStore);

// ── 篩選條件 ──────────────────────────────────────────────────
const filterActorUid = ref('');
const filterAction = ref('');
const filterTargetType = ref('');
const filterTargetId = ref('');

// 列舉值（與 server util audit-log.ts 的 AuditAction / AuditTargetType 對齊）
const ACTION_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'driver.approve', label: 'driver.approve' },
  { value: 'driver.reject', label: 'driver.reject' },
  { value: 'driver.unblock_cooldown', label: 'driver.unblock_cooldown' },
  { value: 'driver.category_change', label: 'driver.category_change' },
  { value: 'driver.role_add', label: 'driver.role_add' },
  { value: 'driver.role_remove', label: 'driver.role_remove' },
  { value: 'admin.add', label: 'admin.add' },
  { value: 'admin.remove', label: 'admin.remove' },
  { value: 'admin.level_change', label: 'admin.level_change' },
  { value: 'order.assign', label: 'order.assign' },
  { value: 'order.status_change', label: 'order.status_change' },
  { value: 'order.cancel_by_admin', label: 'order.cancel_by_admin' },
  { value: 'order.edit', label: 'order.edit' },
  { value: 'broadcast.send', label: 'broadcast.send' },
  { value: 'broadcast.notify_one', label: 'broadcast.notify_one' },
  { value: 'fleet.create', label: 'fleet.create' },
  { value: 'fleet.update', label: 'fleet.update' },
  { value: 'fleet.delete', label: 'fleet.delete' },
];

const TARGET_TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'driver', label: 'driver' },
  { value: 'admin', label: 'admin' },
  { value: 'order', label: 'order' },
  { value: 'broadcast', label: 'broadcast' },
  { value: 'fleet', label: 'fleet' },
];

// ── 列表狀態 ──────────────────────────────────────────────────
interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorDisplayName: string;
  actorLevel: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  ip: string;
  userAgent: string;
  createdAt: number;
}

const logs = ref<AuditLogEntry[]>([]);
const loading = ref(false);
const error = ref('');
const nextCursor = ref<number | null>(null);
const expandedId = ref<string | null>(null);

// ── API 取資料 ────────────────────────────────────────────────
const _BuildQuery = (cursor: number | null): Record<string, string> => {
  const q: Record<string, string> = { limit: '50' };
  if (filterActorUid.value.trim()) q.actorUid = filterActorUid.value.trim();
  if (filterAction.value) q.action = filterAction.value;
  if (filterTargetType.value) q.targetType = filterTargetType.value;
  if (filterTargetId.value.trim()) q.targetId = filterTargetId.value.trim();
  if (cursor !== null) q.cursor = String(cursor);
  return q;
};

const ApiFetchLogs = async (cursor: number | null = null) => {
  loading.value = true;
  error.value = '';
  try {
    const idToken = await authStore.GetFreshIdToken();
    if (!idToken) {
      error.value = '未登入';
      loading.value = false;
      return;
    }
    const queryString = new URLSearchParams(_BuildQuery(cursor)).toString();
    const res = await $fetch<{
      data: { items: AuditLogEntry[]; nextCursor: number | null };
      status: { code: number; message: { zh_tw: string; en: string; ja: string } };
    }>(`/nuxt-api/admin/audit-logs?${queryString}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status.code !== 200) {
      error.value = res.status.message.zh_tw || '載入失敗';
      loading.value = false;
      return;
    }
    if (cursor === null) {
      logs.value = res.data.items;
    } else {
      logs.value = [...logs.value, ...res.data.items];
    }
    nextCursor.value = res.data.nextCursor;
  } catch (_err) {
    error.value = '載入失敗';
  } finally {
    loading.value = false;
  }
};

const ClickApplyFilter = () => {
  nextCursor.value = null;
  void ApiFetchLogs(null);
};

const ClickResetFilter = () => {
  filterActorUid.value = '';
  filterAction.value = '';
  filterTargetType.value = '';
  filterTargetId.value = '';
  ClickApplyFilter();
};

const ClickLoadMore = () => {
  if (nextCursor.value !== null) void ApiFetchLogs(nextCursor.value);
};

const ClickToggleExpand = (id: string) => {
  expandedId.value = expandedId.value === id ? null : id;
};

const FormatTime = (millis: number): string => {
  if (!millis) return '—';
  return $dayjs(millis).format('YYYY/MM/DD HH:mm:ss');
};

const FormatPayload = (p: Record<string, unknown>): string => {
  if (!p || Object.keys(p).length === 0) return '(empty)';
  try {
    return JSON.stringify(p, null, 2);
  } catch {
    return '(invalid payload)';
  }
};

onMounted(() => {
  if (isSuper.value) {
    void ApiFetchLogs(null);
  }
});
</script>

<template lang="pug">
.PageAuditLogs
  //- 非 super 顯示拒絕訊息（middleware 已擋非 admin；此處再擋非 super 的 admin）
  .PageAuditLogs__forbidden(v-if="!isSuper")
    h2 403 Forbidden
    p {{ t('audit.forbidden') }}

  template(v-else)
    .PageAuditLogs__header
      h1.PageAuditLogs__title {{ t('audit.title') }}
      p.PageAuditLogs__sub {{ t('audit.subtitle') }}

    //- 篩選列
    .PageAuditLogs__filters
      .PageAuditLogs__filter
        label.PageAuditLogs__label {{ t('audit.filter.actorUid') }}
        ElInput(v-model="filterActorUid" placeholder="Uxxxxxx..." clearable maxlength="40")
      .PageAuditLogs__filter
        label.PageAuditLogs__label {{ t('audit.filter.action') }}
        ElSelect(v-model="filterAction" clearable value-on-clear="" placeholder="—")
          ElOption(v-for="opt in ACTION_OPTIONS" :key="opt.value" :value="opt.value" :label="opt.label")
      .PageAuditLogs__filter
        label.PageAuditLogs__label {{ t('audit.filter.targetType') }}
        ElSelect(v-model="filterTargetType" clearable value-on-clear="" placeholder="—")
          ElOption(v-for="opt in TARGET_TYPE_OPTIONS" :key="opt.value" :value="opt.value" :label="opt.label")
      .PageAuditLogs__filter
        label.PageAuditLogs__label {{ t('audit.filter.targetId') }}
        ElInput(v-model="filterTargetId" placeholder="UUID / lineUid" clearable maxlength="60")
      .PageAuditLogs__filter-buttons
        UiButton(type="primary" @click="ClickApplyFilter" :loading="loading") {{ t('audit.filter.apply') }}
        UiButton(type="secondary" @click="ClickResetFilter") {{ t('audit.filter.reset') }}

    //- 錯誤訊息
    p.PageAuditLogs__error(v-if="error") {{ error }}

    //- 表格
    .PageAuditLogs__table-wrap
      table.PageAuditLogs__table
        thead
          tr
            th(style="width:140px") {{ t('audit.col.time') }}
            th(style="width:140px") {{ t('audit.col.actor') }}
            th(style="width:80px") {{ t('audit.col.level') }}
            th(style="width:180px") {{ t('audit.col.action') }}
            th(style="width:90px") {{ t('audit.col.targetType') }}
            th {{ t('audit.col.targetId') }}
            th(style="width:60px")
        tbody
          template(v-for="log in logs" :key="log.id")
            tr.PageAuditLogs__row(
              :class="{ 'is-expanded': expandedId === log.id }"
              @click="ClickToggleExpand(log.id)"
            )
              td {{ FormatTime(log.createdAt) }}
              td.PageAuditLogs__actor
                .PageAuditLogs__actor-name {{ log.actorDisplayName || '—' }}
                .PageAuditLogs__actor-uid {{ log.actorUid }}
              td
                span.PageAuditLogs__badge(:class="`is-${log.actorLevel}`") {{ log.actorLevel }}
              td.PageAuditLogs__action {{ log.action }}
              td {{ log.targetType }}
              td.PageAuditLogs__target {{ log.targetId }}
              td.PageAuditLogs__expand-cell
                span(:class="{ 'is-rotated': expandedId === log.id }") ›
            tr.PageAuditLogs__detail(v-if="expandedId === log.id")
              td(colspan="7")
                .PageAuditLogs__detail-grid
                  .PageAuditLogs__detail-row
                    span.PageAuditLogs__detail-label IP
                    span.PageAuditLogs__detail-val {{ log.ip || '—' }}
                  .PageAuditLogs__detail-row
                    span.PageAuditLogs__detail-label User-Agent
                    span.PageAuditLogs__detail-val {{ log.userAgent || '—' }}
                  .PageAuditLogs__detail-row
                    span.PageAuditLogs__detail-label Payload
                  pre.PageAuditLogs__payload {{ FormatPayload(log.payload) }}

      .PageAuditLogs__empty(v-if="!loading && logs.length === 0") {{ t('audit.empty') }}

    .PageAuditLogs__footer
      UiButton(
        v-if="nextCursor !== null"
        type="secondary"
        @click="ClickLoadMore"
        :loading="loading"
      ) {{ t('audit.loadMore') }}
      span.PageAuditLogs__count(v-else-if="logs.length > 0") {{ t('audit.totalShown', { n: logs.length }) }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageAuditLogs {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;

  &__forbidden {
    text-align: center;
    padding: 80px 16px;

    h2 { font-family: $font-display; font-size: 48px; color: var(--da-dark); margin-bottom: 12px; }
    p { color: var(--da-gray); font-family: $font-body; }
  }

  &__header { margin-bottom: 24px; }

  &__title {
    font-family: $font-display;
    font-size: 32px;
    color: var(--da-dark);
    letter-spacing: 0.04em;
  }

  &__sub {
    font-family: $font-condensed;
    font-size: 12px;
    letter-spacing: 0.2em;
    color: var(--da-gray);
    text-transform: uppercase;
    margin-top: 4px;
  }

  &__filters {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 12px;
    align-items: end;
    margin-bottom: 16px;
    padding: 16px;
    background: var(--da-glass-bg);
    border: 1px solid var(--da-gray-pale);
    border-radius: 12px;
  }

  &__filter { display: flex; flex-direction: column; gap: 6px; }

  &__label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--da-gray);
  }

  &__filter-buttons {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  &__error {
    color: #e74c3c;
    font-family: $font-body;
    font-size: 14px;
    margin: 8px 0;
  }

  &__table-wrap {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-gray-pale);
    border-radius: 12px;
    overflow: hidden;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;
    font-family: $font-body;
    font-size: 13px;

    thead {
      background: var(--da-dark);
      color: #fff;
    }

    th {
      text-align: left;
      padding: 12px 14px;
      font-family: $font-condensed;
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 700;
    }

    td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--da-gray-pale);
      vertical-align: top;
      color: var(--da-dark);
    }
  }

  &__row {
    cursor: pointer;
    transition: background 0.15s;

    &:hover { background: rgba(212, 134, 10, 0.04); }
    &.is-expanded { background: rgba(212, 134, 10, 0.08); }
  }

  &__actor-name { font-weight: 700; }
  &__actor-uid { font-size: 11px; color: var(--da-gray); font-family: monospace; }

  &__badge {
    font-family: $font-condensed;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 2px 8px;
    border-radius: 100px;
    text-transform: uppercase;

    &.is-super     { background: rgba(231, 76, 60, 0.12);  color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3); }
    &.is-admin     { background: rgba(212, 134, 10, 0.12); color: var(--da-amber); border: 1px solid rgba(212, 134, 10, 0.3); }
    &.is-assistant { background: rgba(127, 140, 141, 0.12); color: #7f8c8d; border: 1px solid rgba(127, 140, 141, 0.3); }
  }

  &__action { font-family: monospace; font-size: 12px; }
  &__target { font-family: monospace; font-size: 11px; color: var(--da-gray); word-break: break-all; }

  &__expand-cell {
    text-align: center;
    color: var(--da-gray);

    span { display: inline-block; transition: transform 0.2s; font-size: 18px; }
    span.is-rotated { transform: rotate(90deg); }
  }

  &__detail {
    background: rgba(212, 134, 10, 0.04);

    td { padding: 16px 20px !important; }
  }

  &__detail-grid { display: flex; flex-direction: column; gap: 8px; }

  &__detail-row { display: flex; gap: 12px; align-items: baseline; }

  &__detail-label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--da-gray);
    width: 90px;
    flex-shrink: 0;
  }

  &__detail-val { font-family: monospace; font-size: 12px; color: var(--da-dark); word-break: break-all; }

  &__payload {
    margin: 0;
    padding: 12px;
    background: var(--da-dark);
    color: #c8e6c9;
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
    border-radius: 8px;
    overflow-x: auto;
    max-height: 320px;
  }

  &__empty {
    padding: 60px 16px;
    text-align: center;
    color: var(--da-gray);
    font-family: $font-body;
  }

  &__footer {
    margin-top: 16px;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 40px;
  }

  &__count {
    font-family: $font-condensed;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--da-gray);
  }
}

@media (max-width: 768px) {
  .PageAuditLogs {
    padding: 16px;

    &__filters { grid-template-columns: 1fr 1fr; }
    &__table { font-size: 11px; }
    &__table th, &__table td { padding: 8px; }
  }
}
</style>
