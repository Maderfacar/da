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

.PageAuditLogs {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;

  &__forbidden {
    text-align: center;
    padding: 80px 16px;

    h2 { font-family: var(--ff-display); font-size: var(--fs-display); color: var(--da-dark); margin-bottom: 12px; }
    p { color: var(--da-gray); font-family: var(--ff-ui); }
  }

  &__header { margin-bottom: 24px; }

  &__title {
    font-family: var(--ff-display);
    font-size: var(--fs-h1);
    color: var(--da-dark);
    letter-spacing: var(--ls-label);
  }

  &__sub {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    letter-spacing: var(--ls-kicker);
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
    background: var(--surface-raised);
    border: 1px solid var(--da-gray-pale);
    border-radius: var(--r-md);
  }

  &__filter { display: flex; flex-direction: column; gap: 6px; }

  &__label {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--ls-wide);
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
    color: var(--stop);
    font-family: var(--ff-ui);
    font-size: var(--fs-body);
    margin: 8px 0;
  }

  &__table-wrap {
    background: var(--surface-raised);
    border: 1px solid var(--da-gray-pale);
    border-radius: var(--r-md);
    overflow: hidden;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--ff-ui);
    font-size: var(--fs-body-sm);

    thead {
      background: var(--da-dark);
      color: var(--surface-raised);
    }

    th {
      text-align: left;
      padding: 12px 14px;
      font-family: var(--ff-label);
      font-size: var(--fs-label);
      letter-spacing: var(--ls-wide);
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
    transition: background var(--dur-fast) var(--ease-out);

    &:hover { background: var(--accent-a06); }
    &.is-expanded { background: var(--accent-a06); }
  }

  &__actor-name { font-weight: 700; }
  &__actor-uid { font-size: var(--fs-label); color: var(--da-gray); font-family: var(--ff-mono); }

  &__badge {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--ls-wide);
    padding: 2px 8px;
    border-radius: var(--r-pill);
    text-transform: uppercase;

    &.is-super     { background: var(--stop-a15);  color: var(--stop); border: 1px solid var(--stop-a30); }
    &.is-admin     { background: var(--accent-a12); color: var(--accent-text); border: 1px solid var(--accent-a30); }
    &.is-assistant { background: color-mix(in srgb, var(--ink-mute) 12%, transparent); color: var(--ink-mute); border: 1px solid color-mix(in srgb, var(--ink-mute) 30%, transparent); }
  }

  &__action { font-family: var(--ff-mono); font-size: var(--fs-label); }
  &__target { font-family: var(--ff-mono); font-size: var(--fs-label); color: var(--da-gray); word-break: break-all; }

  &__expand-cell {
    text-align: center;
    color: var(--da-gray);

    span { display: inline-block; transition: transform var(--dur-base) var(--ease-out); font-size: var(--fs-h4); }
    span.is-rotated { transform: rotate(90deg); }
  }

  &__detail {
    background: var(--accent-a06);

    td { padding: 16px 20px !important; }
  }

  &__detail-grid { display: flex; flex-direction: column; gap: 8px; }

  &__detail-row { display: flex; gap: 12px; align-items: baseline; }

  &__detail-label {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--ls-wide);
    text-transform: uppercase;
    color: var(--da-gray);
    width: 90px;
    flex-shrink: 0;
  }

  &__detail-val { font-family: var(--ff-mono); font-size: var(--fs-label); color: var(--da-dark); word-break: break-all; }

  &__payload {
    margin: 0;
    padding: 12px;
    background: var(--da-dark);
    color: var(--good);
    font-family: var(--ff-mono);
    font-size: var(--fs-label);
    line-height: var(--lh-normal);
    border-radius: var(--r-sm);
    overflow-x: auto;
    max-height: 320px;
  }

  &__empty {
    padding: 60px 16px;
    text-align: center;
    color: var(--da-gray);
    font-family: var(--ff-ui);
  }

  &__footer {
    margin-top: 16px;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 40px;
  }

  &__count {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    letter-spacing: var(--ls-wide);
    text-transform: uppercase;
    color: var(--da-gray);
  }
}

@media (max-width: 768px) {
  .PageAuditLogs {
    padding: 16px;

    &__filters { grid-template-columns: 1fr 1fr; }
    &__table { font-size: var(--fs-label); }
    &__table th, &__table td { padding: 8px; }
  }
}
</style>
