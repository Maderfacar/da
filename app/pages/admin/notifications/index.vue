<script setup lang="ts">
// P37 Phase 3.1：admin 公告管理頁（取代 Phase 2 前的 in-memory broadcast UI）
//
// 三個 tab：草稿 / 已發佈 / 已下架（URL query `?status=draft|published|archived` 同步）
// 每張卡片依 status 動態顯示動作：
//   - draft     → 編輯 / 發佈 / 刪除
//   - published → 編輯 / 下架 / 刪除（編輯不重推 LINE）
//   - archived  → 編輯 / 重新發佈（會再推 LINE）/ 刪除
//
// Phase 2 留的 stub：published 卡片的 pushStats.sentCount 目前為 0，等 Phase 4 LINE push wire 起來才會有實值。
import type {
  Announcement,
  AnnouncementStatus,
  AnnouncementTargetType,
} from '@/protocol/fetch-api/api/admin/announcement';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const route = useRoute();
const router = useRouter();

const TARGET_LABEL: Record<AnnouncementTargetType, string> = {
  all: '全體',
  passenger: '乘客',
  driver: '司機',
  order: '指定訂單',
};

const STATUS_TABS: Array<{ key: AnnouncementStatus; label: string }> = [
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '已發佈' },
  { key: 'archived', label: '已下架' },
];

const VALID_STATUSES: AnnouncementStatus[] = ['draft', 'published', 'archived'];

const InitTabFromUrl = (): AnnouncementStatus => {
  const q = (route.query.status as string | undefined) ?? 'draft';
  return (VALID_STATUSES as string[]).includes(q) ? (q as AnnouncementStatus) : 'draft';
};

const activeTab = ref<AnnouncementStatus>(InitTabFromUrl());
const items = ref<Announcement[]>([]);
const loading = ref(false);
const actingId = ref<string>(''); // 正在執行動作的 announcement id

// ── 載入清單 ─────────────────────────────────────────────────
const ApiLoadList = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAdminAnnouncements({ status: activeTab.value, limit: 50 });
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '載入失敗', type: 'error' });
      items.value = [];
      return;
    }
    items.value = res.data?.items ?? [];
  } finally {
    loading.value = false;
  }
};

// ── Tab 切換 ─────────────────────────────────────────────────
const ClickSwitchTab = (tab: AnnouncementStatus) => {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  // 同步到 URL（不重新整理頁面）
  router.replace({ query: { ...route.query, status: tab } });
};

watch(activeTab, () => {
  void ApiLoadList();
});

// ── 動作：新增 ───────────────────────────────────────────────
const ClickCreate = async () => {
  const result = await $open.DialogAnnouncementEdit({ mode: 'create' });
  if (result === 'saved' || result === 'published') {
    // 新建後依結果切到對應 tab
    const nextTab: AnnouncementStatus = result === 'published' ? 'published' : 'draft';
    if (activeTab.value !== nextTab) {
      ClickSwitchTab(nextTab);
    } else {
      await ApiLoadList();
    }
  }
};

// ── 動作：編輯 ───────────────────────────────────────────────
const ClickEdit = async (a: Announcement) => {
  const result = await $open.DialogAnnouncementEdit({ mode: 'edit', id: a.id });
  if (result !== 'cancelled') {
    await ApiLoadList();
  }
};

// ── 動作：重新發佈（archived → published） ────────────────────
const ClickRepublish = async (a: Announcement) => {
  const result = await $open.DialogAnnouncementEdit({ mode: 'republish', id: a.id });
  if (result === 'published') {
    // 重發後切到 published tab
    ClickSwitchTab('published');
  } else if (result === 'saved') {
    await ApiLoadList();
  }
};

// ── 動作：再發佈（複製 — published 公告 → 新建獨立 doc 並發佈） ──
//   舊那筆 published 不動；新那筆獨立成一條 published（list 重撈後出現在最上）。
const ClickDuplicate = async (a: Announcement) => {
  const result = await $open.DialogAnnouncementEdit({ mode: 'duplicate', id: a.id });
  if (result === 'published' || result === 'saved') {
    await ApiLoadList();
  }
};

// ── 動作：發佈（draft → published 直接發） ────────────────────
const ClickPublishNow = async (a: Announcement) => {
  const ok = await UseAsk(`確定要立即發佈「${a.title}」？\n若已啟用 LINE 渠道將推送給目標對象。`);
  if (!ok) return;
  actingId.value = a.id;
  try {
    const res = await $api.PatchAdminAnnouncement(a.id, { status: 'published' });
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '發佈失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已發佈', type: 'success' });
    ClickSwitchTab('published');
  } finally {
    actingId.value = '';
  }
};

// ── 動作：下架 ───────────────────────────────────────────────
const ClickArchive = async (a: Announcement) => {
  const ok = await UseAsk(`確定要下架「${a.title}」？\n下架後乘客 App 將不再顯示，可隨時重新發佈。`);
  if (!ok) return;
  actingId.value = a.id;
  try {
    const res = await $api.PatchAdminAnnouncement(a.id, { status: 'archived' });
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '下架失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已下架', type: 'success' });
    ClickSwitchTab('archived');
  } finally {
    actingId.value = '';
  }
};

// ── 動作：刪除 ───────────────────────────────────────────────
const ClickDelete = async (a: Announcement) => {
  const ok = await UseAsk(`確定要刪除「${a.title}」？此動作無法復原。`);
  if (!ok) return;
  actingId.value = a.id;
  try {
    const res = await $api.DeleteAdminAnnouncement(a.id);
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '刪除失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已刪除', type: 'success' });
    await ApiLoadList();
  } finally {
    actingId.value = '';
  }
};

// ── helpers ─────────────────────────────────────────────────
const FormatTime = (iso: string | null): string => {
  if (!iso) return '—';
  return $dayjs(iso).format('YYYY/MM/DD HH:mm');
};

const ChannelLabel = (a: Announcement): string => {
  const parts: string[] = [];
  if (a.channels.line) parts.push('LINE');
  if (a.channels.inApp) parts.push('App');
  return parts.join(' + ') || '—';
};

const PushStatsLabel = (a: Announcement): string => {
  if (!a.pushStats) return '—';
  return `${a.pushStats.sentCount} / ${a.pushStats.targetCount}`;
};

const BodyExcerpt = (html: string): string => {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
};

// ── 初始化 ───────────────────────────────────────────────────
onMounted(() => {
  void ApiLoadList();
});
</script>

<template lang="pug">
.PageAdminAnnouncements(data-surface='dark')
  //- ── Header ─────────────────────────────────────────
  header.PageAdminAnnouncements__header
    .PageAdminAnnouncements__headerInner
      .PageAdminAnnouncements__headerText
        .PageAdminAnnouncements__label ANNOUNCEMENT CENTER
        h1.PageAdminAnnouncements__title 公告管理
      button.PageAdminAnnouncements__createBtn(type="button" @click="ClickCreate")
        | + 新增公告

  //- ── Tabs ───────────────────────────────────────────
  nav.PageAdminAnnouncements__tabs
    button.PageAdminAnnouncements__tab(
      v-for="tab in STATUS_TABS"
      :key="tab.key"
      type="button"
      :class="{ 'is-active': activeTab === tab.key }"
      @click="ClickSwitchTab(tab.key)"
    )
      | {{ tab.label }}

  //- ── List ──────────────────────────────────────────
  .PageAdminAnnouncements__list
    template(v-if="loading")
      .PageAdminAnnouncements__placeholder 載入中...
    template(v-else-if="items.length === 0")
      .PageAdminAnnouncements__placeholder
        template(v-if="activeTab === 'draft'") 尚無草稿，點擊右上「新增公告」開始。
        template(v-else-if="activeTab === 'published'") 沒有已發佈的公告。
        template(v-else) 沒有已下架的公告。
    template(v-else)
      article.PageAdminAnnouncements__card(v-for="a in items" :key="a.id")
        .PageAdminAnnouncements__cardHead
          .PageAdminAnnouncements__cardTitle {{ a.title }}
          .PageAdminAnnouncements__cardMeta
            span.PageAdminAnnouncements__chip {{ TARGET_LABEL[a.targetType] }}
            span.PageAdminAnnouncements__chip {{ ChannelLabel(a) }}

        .PageAdminAnnouncements__cardBody(v-if="BodyExcerpt(a.body)") {{ BodyExcerpt(a.body) }}...

        .PageAdminAnnouncements__cardFoot
          .PageAdminAnnouncements__cardStats
            template(v-if="a.status === 'draft'")
              span.PageAdminAnnouncements__stat 建立於 {{ FormatTime(a.createdAt) }}
            template(v-else-if="a.status === 'published'")
              span.PageAdminAnnouncements__stat 發佈於 {{ FormatTime(a.publishedAt) }}
              span.PageAdminAnnouncements__stat
                | 推送 {{ PushStatsLabel(a) }}
            template(v-else)
              span.PageAdminAnnouncements__stat 下架於 {{ FormatTime(a.archivedAt) }}

          .PageAdminAnnouncements__cardActions
            //- draft：編輯 / 發佈 / 刪除
            template(v-if="a.status === 'draft'")
              button.PageAdminAnnouncements__actionBtn(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickEdit(a)"
              ) 編輯
              button.PageAdminAnnouncements__actionBtn.PageAdminAnnouncements__actionBtn--primary(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickPublishNow(a)"
              ) 發佈
              button.PageAdminAnnouncements__actionBtn.PageAdminAnnouncements__actionBtn--danger(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickDelete(a)"
              ) 刪除
            //- published：編輯 / 再發佈（複製成新公告）/ 下架 / 刪除
            template(v-else-if="a.status === 'published'")
              button.PageAdminAnnouncements__actionBtn(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickEdit(a)"
              ) 編輯
              button.PageAdminAnnouncements__actionBtn.PageAdminAnnouncements__actionBtn--primary(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickDuplicate(a)"
              ) 再發佈
              button.PageAdminAnnouncements__actionBtn(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickArchive(a)"
              ) 下架
              button.PageAdminAnnouncements__actionBtn.PageAdminAnnouncements__actionBtn--danger(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickDelete(a)"
              ) 刪除
            //- archived：編輯 / 重新發佈 / 刪除
            template(v-else)
              button.PageAdminAnnouncements__actionBtn(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickEdit(a)"
              ) 編輯
              button.PageAdminAnnouncements__actionBtn.PageAdminAnnouncements__actionBtn--primary(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickRepublish(a)"
              ) 重新發佈
              button.PageAdminAnnouncements__actionBtn.PageAdminAnnouncements__actionBtn--danger(
                type="button"
                :disabled="actingId === a.id"
                @click="ClickDelete(a)"
              ) 刪除
</template>

<style lang="scss" scoped>




.PageAdminAnnouncements {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: var(--ink);
  color: var(--surface-raised);
}

// ── Header ─────────────────────────────────────────────────
.PageAdminAnnouncements__header { margin-bottom: 18px; }

.PageAdminAnnouncements__headerInner {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.PageAdminAnnouncements__headerText { flex: 1 1 auto; }

.PageAdminAnnouncements__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--accent);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before { content: ''; width: 20px; height: 1.5px; background: var(--accent); }
}

.PageAdminAnnouncements__title {
  font-family: var(--ff-display);
  font-size: var(--fs-h1);
  letter-spacing: var(--ls-label);
  margin: 0;
}

.PageAdminAnnouncements__createBtn {
  padding: 10px 18px;
  border-radius: var(--r-pill);
  border: 1px solid var(--accent-a50);
  background: var(--accent-a12);
  color: var(--accent);
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover { background: var(--accent-a20); }
}

// ── Tabs ───────────────────────────────────────────────────
.PageAdminAnnouncements__tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--surface-a06);
  padding-bottom: 0;
  overflow-x: auto;
}

.PageAdminAnnouncements__tab {
  padding: 10px 18px;
  border: none;
  background: transparent;
  color: var(--surface-a40);
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all var(--dur-fast) var(--ease-out);
  white-space: nowrap;

  &:hover { color: var(--surface-raised); }
  &.is-active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
}

// ── List ───────────────────────────────────────────────────
.PageAdminAnnouncements__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageAdminAnnouncements__placeholder {
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-lg);
  padding: 40px 20px;
  text-align: center;
  color: var(--surface-a40);
  font-size: var(--fs-body-sm);
}

.PageAdminAnnouncements__card {
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-lg);
  padding: 16px 18px;
  transition: border-color var(--dur-fast) var(--ease-out);

  &:hover { border-color: var(--surface-a12); }
}

.PageAdminAnnouncements__cardHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.PageAdminAnnouncements__cardTitle {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-lg);
  font-weight: 700;
  color: var(--surface-raised);
  line-height: var(--lh-normal);
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-word;
}

.PageAdminAnnouncements__cardMeta {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.PageAdminAnnouncements__chip {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent);
}

.PageAdminAnnouncements__cardBody {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--surface-a72);
  line-height: var(--lh-normal);
  margin-bottom: 12px;
}

.PageAdminAnnouncements__cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.PageAdminAnnouncements__cardStats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.PageAdminAnnouncements__stat {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--surface-a40);
}

.PageAdminAnnouncements__cardActions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.PageAdminAnnouncements__actionBtn {
  padding: 6px 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--surface-a06);
  background: var(--surface-a06);
  color: var(--surface-a82);
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) {
    background: var(--surface-a12);
    color: var(--surface-raised);
  }

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &--primary {
    background: var(--accent-a12);
    border-color: var(--accent-a40);
    color: var(--accent);
    &:hover:not(:disabled) { background: var(--accent-a20); }
  }

  &--danger {
    background: var(--stop-a08);
    border-color: var(--stop-a45);
    color: var(--stop);
    &:hover:not(:disabled) { background: var(--stop-a15); color: var(--stop); }
  }
}
</style>
