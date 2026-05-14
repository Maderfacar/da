<script setup lang="ts">
// P38 Phase 2：admin LINE OA 管理頁
//
// 4 tab：
//   - Richmenu（Phase 2 落地）：passenger / driver 兩 sub-tab，列表 + 編輯彈窗
//   - Flex Templates（Phase 3-4 接）
//   - Bot Replies（P40 留尾）
//   - Diagnostics（Phase 5 可選）
//
// Phase 2 範圍：只開 Richmenu tab，其餘三 tab 顯示「Phase X 準備中」placeholder。
import type {
  LineClient,
  LineRichmenuDto,
  RichmenuStatus,
} from '@/protocol/fetch-api/api/admin/line-richmenu';
import type { NotificationTemplateItem } from '@/protocol/fetch-api/api/admin/notification-template';
import type { BotReplyItem, BotReplyKey } from '@/protocol/fetch-api/api/admin/bot-reply';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

type MainTab = 'richmenu' | 'templates' | 'bot-replies' | 'diagnostics';

const MAIN_TABS: Array<{ key: MainTab; label: string; ready: boolean }> = [
  { key: 'richmenu', label: '圖文選單', ready: true },
  { key: 'templates', label: 'Flex 模板', ready: true },
  { key: 'bot-replies', label: '自動回覆', ready: true },
  { key: 'diagnostics', label: '診斷', ready: false },
];

const BOT_REPLY_TYPE_LABEL: Record<'follow' | 'text', string> = {
  follow: 'Follow 事件',
  text: 'Text 自動回覆',
};

const BOT_REPLY_TYPE_DESC: Record<'follow' | 'text', string> = {
  follow: 'user 新加 OA 為好友時 LINE 推送的歡迎訊息',
  text: 'user 在 OA 內傳純文字訊息時 LINE 推送的自動回覆',
};

const TEXT_MAX = 500;

const route = useRoute();
const router = useRouter();

const InitMainTab = (): MainTab => {
  const q = route.query.tab as string | undefined;
  return MAIN_TABS.find((t) => t.key === q)?.key ?? 'richmenu';
};

const activeMainTab = ref<MainTab>(InitMainTab());

watch(activeMainTab, (tab) => {
  void router.replace({ query: { ...route.query, tab } });
});

// ── Richmenu tab：channel 子 tab + 列表 ──────────────────────
const activeChannel = ref<LineClient>('passenger');
const activeStatus = ref<RichmenuStatus | 'all'>('all');
const items = ref<LineRichmenuDto[]>([]);
const loading = ref(false);
const actingId = ref<string>('');

const STATUS_TABS: Array<{ key: RichmenuStatus | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'active', label: '已發佈' },
  { key: 'archived', label: '已下架' },
];

const STATUS_LABEL: Record<RichmenuStatus, string> = {
  draft: '草稿',
  active: '已發佈',
  archived: '已下架',
};

const SYNC_LABEL: Record<LineRichmenuDto['syncStatus'], string> = {
  not_synced: '尚未同步',
  syncing: '同步中',
  synced: '已同步',
  sync_failed: '同步失敗',
};

const ApiLoadList = async () => {
  loading.value = true;
  try {
    const res = await $api.GetLineRichmenus({
      channel: activeChannel.value,
      status: activeStatus.value,
      limit: 50,
    });
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

watch([activeChannel, activeStatus], () => {
  void ApiLoadList();
});

// ── 動作 ─────────────────────────────────────────────────────
const ClickCreate = async () => {
  const result = await $open.DialogLineRichmenuEdit({
    mode: 'create',
    channel: activeChannel.value,
  });
  if (result !== 'cancelled') {
    await ApiLoadList();
  }
};

const ClickEdit = async (m: LineRichmenuDto) => {
  const result = await $open.DialogLineRichmenuEdit({
    mode: 'edit',
    channel: m.channel,
    id: m.id,
  });
  if (result !== 'cancelled') {
    await ApiLoadList();
  }
};

const ClickPublish = async (m: LineRichmenuDto) => {
  const ok = await UseAsk(`確定要將「${m.name}」發佈為 ${m.channel === 'passenger' ? '乘客 OA' : '司機 OA'} 預設選單？\n發佈後 LINE 端會立即生效，原有 active 自動下架。`);
  if (!ok) return;
  actingId.value = m.id;
  try {
    const res = await $api.PublishLineRichmenu(m.id);
    if (res.status.code === 200) {
      ElMessage({ message: '已發佈', type: 'success' });
    } else if (res.status.code === 502) {
      ElMessage({
        message: res.status.message?.zh_tw || 'Firestore 已切 active，但 LINE 同步失敗，請至卡片查看詳情',
        type: 'warning',
        duration: 6000,
      });
    } else if (res.status.code === 429) {
      ElMessage({ message: res.status.message?.zh_tw || '發佈過於頻繁，請稍候', type: 'warning' });
    } else {
      ElMessage({ message: res.status.message?.zh_tw || '發佈失敗', type: 'error' });
    }
    await ApiLoadList();
  } finally {
    actingId.value = '';
  }
};

const ClickUnpublish = async (m: LineRichmenuDto) => {
  const ok = await UseAsk(`確定要將「${m.name}」取消預設？\n取消後該 OA 將沒有圖文選單顯示，直到下次發佈。`);
  if (!ok) return;
  actingId.value = m.id;
  try {
    const res = await $api.UnpublishLineRichmenu(m.id);
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '取消失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已取消預設', type: 'success' });
    await ApiLoadList();
  } finally {
    actingId.value = '';
  }
};

const ClickDelete = async (m: LineRichmenuDto) => {
  const ok = await UseAsk(`確定要刪除「${m.name}」？此動作無法復原（同時刪除 LINE 端 richmenu 與本地圖片）。`);
  if (!ok) return;
  actingId.value = m.id;
  try {
    const res = await $api.DeleteLineRichmenu(m.id);
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

const ClickSyncCheck = async (m: LineRichmenuDto) => {
  actingId.value = m.id;
  try {
    const res = await $api.SyncLineRichmenuStatus(m.id);
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '同步檢查失敗', type: 'error' });
      return;
    }
    const d = res.data;
    if (d?.queryError) {
      ElMessage({ message: `LINE 查詢失敗：${d.queryError}`, type: 'error', duration: 6000 });
    } else if (d?.match) {
      ElMessage({ message: 'LINE 端與本地一致', type: 'success' });
    } else {
      ElMessage({
        message: `LINE 預設 id: ${d?.line.defaultRichMenuId ?? '無'} / 本地 active lineRichMenuId: ${d?.local.lineRichMenuId ?? '無'}`,
        type: 'warning',
        duration: 6000,
      });
    }
    await ApiLoadList();
  } finally {
    actingId.value = '';
  }
};

const ClickTestBind = async (m: LineRichmenuDto) => {
  const target = window.prompt('要綁定到哪個 LINE userId？（不含 line: prefix）');
  if (!target || !target.trim()) return;
  actingId.value = m.id;
  try {
    const res = await $api.TestBindLineRichmenu(m.id, target.trim());
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '綁定失敗', type: 'error' });
      return;
    }
    ElMessage({ message: `已綁定到 ${target.trim()}（請至該 user 的 LINE 確認）`, type: 'success', duration: 6000 });
  } finally {
    actingId.value = '';
  }
};

// ── helpers ─────────────────────────────────────────────────
const FormatTime = (iso: string | null): string => (iso ? $dayjs(iso).format('YYYY/MM/DD HH:mm') : '—');

// ── Templates tab ────────────────────────────────────────────
const templates = ref<NotificationTemplateItem[]>([]);
const templatesLoading = ref(false);
const selectedTemplateKey = ref<string>('');

const ApiLoadTemplates = async () => {
  templatesLoading.value = true;
  try {
    const res = await $api.GetNotificationTemplates();
    if (res.status.code !== 200) {
      ElMessage({ message: res.status.message?.zh_tw || '載入模板失敗', type: 'error' });
      templates.value = [];
      return;
    }
    templates.value = res.data?.items ?? [];
    if (!selectedTemplateKey.value && templates.value.length > 0) {
      selectedTemplateKey.value = templates.value[0]!.meta.templateKey;
    }
  } finally {
    templatesLoading.value = false;
  }
};

const TemplatesByCategory = computed(() => {
  const groups = new Map<string, NotificationTemplateItem[]>();
  for (const t of templates.value) {
    const cat = t.meta.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(t);
  }
  return groups;
});

const CATEGORY_LABEL: Record<string, string> = {
  order: '訂單事件',
  announcement: '公告',
  bot: 'Bot 自動回覆',
  broadcast: '廣播',
};

const OnTemplateSaved = () => {
  void ApiLoadTemplates();
};

// ── Bot Replies tab（P40 Phase 2） ─────────────────────────
const botReplies = ref<BotReplyItem[]>([]);
const botRepliesLoading = ref(false);
const savingBotReplyKey = ref<BotReplyKey | ''>('');

const ApiLoadBotReplies = async () => {
  botRepliesLoading.value = true;
  try {
    const res = await $api.GetBotReplies();
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '載入自動回覆失敗', type: 'error' });
      botReplies.value = [];
      return;
    }
    botReplies.value = res.data?.items ?? [];
  } finally {
    botRepliesLoading.value = false;
  }
};

const ClickResetBotReply = (item: BotReplyItem) => {
  item.text = item.defaultText;
};

const ClickSaveBotReply = async (item: BotReplyItem) => {
  const text = item.text.trim();
  if (text.length === 0 || text.length > TEXT_MAX) {
    ElMessage({ message: `文案必須為 1-${TEXT_MAX} 字`, type: 'warning' });
    return;
  }
  savingBotReplyKey.value = item.replyKey;
  try {
    const res = await $api.PutBotReply(item.replyKey, {
      text,
      enabled: item.enabled,
    });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已儲存', type: 'success' });
    await ApiLoadBotReplies();
  } finally {
    savingBotReplyKey.value = '';
  }
};

watch(activeMainTab, (tab) => {
  if (tab === 'templates' && templates.value.length === 0) {
    void ApiLoadTemplates();
  }
  if (tab === 'bot-replies' && botReplies.value.length === 0) {
    void ApiLoadBotReplies();
  }
}, { immediate: false });
const FormatBytes = (bytes: number | null): string => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};
const FormatSize = (s: LineRichmenuDto['imageSize']): string => (s ? `${s.width}×${s.height}` : '—');

onMounted(() => {
  void ApiLoadList();
  if (activeMainTab.value === 'templates') {
    void ApiLoadTemplates();
  }
  if (activeMainTab.value === 'bot-replies') {
    void ApiLoadBotReplies();
  }
});
</script>

<template lang="pug">
.PageAdminLineManagement
  .PageAdminLineManagement__header
    .PageAdminLineManagement__header-label LINE OA MANAGEMENT
    h1.PageAdminLineManagement__header-title LINE 官方帳號管理

  //- ── 主 Tab ────────────────────────────────────────────
  .PageAdminLineManagement__main-tabs
    button.PageAdminLineManagement__main-tab(
      v-for="t in MAIN_TABS"
      :key="t.key"
      :class="{ 'is-active': activeMainTab === t.key, 'is-disabled': !t.ready }"
      @click="t.ready ? activeMainTab = t.key : null"
    )
      | {{ t.label }}
      span.PageAdminLineManagement__phase-badge(v-if="!t.ready") 準備中

  //- ── Richmenu Tab ─────────────────────────────────────
  .PageAdminLineManagement__panel(v-if="activeMainTab === 'richmenu'")
    //- channel sub-tab
    .PageAdminLineManagement__sub-tabs
      button.PageAdminLineManagement__sub-tab(
        :class="{ 'is-active': activeChannel === 'passenger', 'is-passenger': true }"
        @click="activeChannel = 'passenger'"
      )
        span.dot
        | 乘客 OA
      button.PageAdminLineManagement__sub-tab(
        :class="{ 'is-active': activeChannel === 'driver', 'is-driver': true }"
        @click="activeChannel = 'driver'"
      )
        span.dot
        | 司機 OA

    //- status filter
    .PageAdminLineManagement__filter
      button.PageAdminLineManagement__filter-tab(
        v-for="s in STATUS_TABS"
        :key="s.key"
        :class="{ 'is-active': activeStatus === s.key }"
        @click="activeStatus = s.key"
      ) {{ s.label }}
      .PageAdminLineManagement__filter-spacer
      button.PageAdminLineManagement__new(@click="ClickCreate")
        | + 新增 richmenu

    //- 列表
    .PageAdminLineManagement__loading(v-if="loading") 載入中...
    template(v-else)
      .PageAdminLineManagement__empty(v-if="items.length === 0")
        span 目前沒有 richmenu — 點擊右上「+ 新增 richmenu」開始

      .PageAdminLineManagement__list
        .PageAdminLineManagement__card(
          v-for="m in items"
          :key="m.id"
          :class="`is-${m.status}`"
        )
          .PageAdminLineManagement__card-head
            .PageAdminLineManagement__card-name {{ m.name }}
            span.PageAdminLineManagement__status-badge(:class="`is-${m.status}`") {{ STATUS_LABEL[m.status] }}
            span.PageAdminLineManagement__sync-badge(:class="`is-${m.syncStatus}`") {{ SYNC_LABEL[m.syncStatus] }}

          .PageAdminLineManagement__card-body
            //- 預覽圖縮圖（沒圖則 placeholder）
            .PageAdminLineManagement__thumb(v-if="m.imageUrl")
              img(:src="m.imageUrl" :alt="m.name")
            .PageAdminLineManagement__thumb.is-empty(v-else)
              span 尚未上傳圖片

            .PageAdminLineManagement__meta
              .row
                span.k chatBar
                span.v {{ m.chatBarText || '—' }}
              .row
                span.k 尺寸
                span.v {{ FormatSize(m.imageSize) }}
              .row
                span.k 檔案
                span.v {{ FormatBytes(m.imageBytes) }}
              .row
                span.k Areas
                span.v {{ m.areas.length }} 區
              .row
                span.k 最後更新
                span.v {{ FormatTime(m.updatedAt) }}
              .row(v-if="m.lineRichMenuId")
                span.k LINE ID
                span.v.mono {{ m.lineRichMenuId.slice(0, 16) }}…
              .row.err(v-if="m.syncError")
                span.k 同步錯誤
                span.v {{ m.syncError }}

          .PageAdminLineManagement__card-actions
            button.PageAdminLineManagement__btn.is-toggle(
              :disabled="actingId === m.id"
              @click="ClickEdit(m)"
            ) 編輯
            button.PageAdminLineManagement__btn.is-approve(
              v-if="m.status !== 'active'"
              :disabled="actingId === m.id"
              @click="ClickPublish(m)"
            ) 發佈為預設
            button.PageAdminLineManagement__btn.is-warning(
              v-if="m.status === 'active'"
              :disabled="actingId === m.id"
              @click="ClickUnpublish(m)"
            ) 取消預設
            button.PageAdminLineManagement__btn.is-toggle(
              :disabled="actingId === m.id"
              @click="ClickSyncCheck(m)"
            ) 同步檢查
            button.PageAdminLineManagement__btn.is-toggle(
              v-if="m.lineRichMenuId"
              :disabled="actingId === m.id"
              @click="ClickTestBind(m)"
            ) 測試綁定
            button.PageAdminLineManagement__btn.is-reject(
              v-if="m.status !== 'active'"
              :disabled="actingId === m.id"
              @click="ClickDelete(m)"
            ) 刪除

  //- ── Templates Tab ────────────────────────────────────
  .PageAdminLineManagement__panel(v-else-if="activeMainTab === 'templates'")
    .PageAdminLineManagement__loading(v-if="templatesLoading") 載入中...
    template(v-else)
      .PageAdminLineManagement__templates
        //- 左側 list（依 category 分組）
        aside.PageAdminLineManagement__template-list
          template(v-for="[cat, items] in TemplatesByCategory" :key="cat")
            .PageAdminLineManagement__template-cat-label {{ CATEGORY_LABEL[cat] || cat }}
            button.PageAdminLineManagement__template-entry(
              v-for="t in items"
              :key="t.meta.templateKey"
              :class="{ 'is-active': selectedTemplateKey === t.meta.templateKey, 'is-customized': t.content !== null, 'is-disabled': !t.enabled }"
              @click="selectedTemplateKey = t.meta.templateKey"
            )
              span.PageAdminLineManagement__template-name {{ t.meta.displayName }}
              span.PageAdminLineManagement__template-dot(
                :title="t.content ? (t.enabled ? '已自訂' : '已自訂但停用') : '使用預設'"
              )

        //- 右側 editor
        main.PageAdminLineManagement__template-editor
          AdminLineManagementTemplateEditor(
            v-if="selectedTemplateKey"
            :template-key="selectedTemplateKey"
            @saved="OnTemplateSaved"
          )
          .PageAdminLineManagement__placeholder(v-else)
            span.PageAdminLineManagement__placeholder-text 選擇左側模板開始編輯

  //- ── Bot Replies Tab（P40 Phase 2） ───────────────────
  .PageAdminLineManagement__panel(v-else-if="activeMainTab === 'bot-replies'")
    .PageAdminLineManagement__loading(v-if="botRepliesLoading") 載入中...
    template(v-else)
      .PageAdminLineManagement__bot-intro
        | 編輯後 LINE 端會優先用 admin 設定的文案；停用或留空則 fallback 系統預設。
      .PageAdminLineManagement__bot-rows
        .PageAdminLineManagement__bot-row(
          v-for="item in botReplies"
          :key="item.replyKey"
          :class="`is-${item.client}`"
        )
          .PageAdminLineManagement__bot-head
            span.PageAdminLineManagement__bot-channel(:class="`is-${item.client}`")
              | {{ item.client === 'passenger' ? '乘客 OA' : '司機 OA' }}
            span.PageAdminLineManagement__bot-type-label {{ BOT_REPLY_TYPE_LABEL[item.type] }}
            span.PageAdminLineManagement__bot-customized(v-if="item.isCustomized") 已自訂
            span.PageAdminLineManagement__bot-flex
            label.PageAdminLineManagement__bot-enabled
              input(type="checkbox" v-model="item.enabled")
              | &nbsp;啟用
          .PageAdminLineManagement__bot-desc {{ BOT_REPLY_TYPE_DESC[item.type] }}
          textarea.PageAdminLineManagement__bot-text(
            v-model="item.text"
            rows="4"
            :maxlength="TEXT_MAX"
            placeholder="輸入要推送的文案（純文字，可含換行 / emoji）"
          )
          .PageAdminLineManagement__bot-foot
            span.PageAdminLineManagement__bot-meta
              | {{ item.text.length }} / {{ TEXT_MAX }}
              template(v-if="item.updatedAt")
                | &nbsp; · &nbsp;最後編輯 {{ $dayjs(item.updatedAt).format('YYYY/MM/DD HH:mm') }}
            span.PageAdminLineManagement__bot-actions
              button.PageAdminLineManagement__btn.is-toggle(
                :disabled="savingBotReplyKey === item.replyKey"
                @click="ClickResetBotReply(item)"
              ) 還原預設
              button.PageAdminLineManagement__btn.is-approve(
                :disabled="savingBotReplyKey === item.replyKey"
                @click="ClickSaveBotReply(item)"
              ) {{ savingBotReplyKey === item.replyKey ? '儲存中...' : '儲存' }}

  //- ── Diagnostics Tab 占位（Phase 3）───────────────────
  .PageAdminLineManagement__panel(v-else)
    .PageAdminLineManagement__placeholder
      span.PageAdminLineManagement__placeholder-icon 🛠
      span.PageAdminLineManagement__placeholder-text P40 Phase 3 準備中
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$muted: rgba(0, 0, 0, 0.45);
$surface: rgba(255, 255, 255, 0.7);
$border: rgba(212, 134, 10, 0.18);

.PageAdminLineManagement {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: var(--da-cream, #f6efe1);
  color: var(--da-dark, #1a1814);
}

.PageAdminLineManagement__header {
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
  }
}

// ── 主 Tab ──────────────────────────────────────────────────
.PageAdminLineManagement__main-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid $border;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.PageAdminLineManagement__main-tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 10px 20px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: $muted;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 8px;

  &.is-active {
    color: $amber;
    border-bottom-color: $amber;
  }
  &.is-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.PageAdminLineManagement__phase-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: $muted;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 100px;
  padding: 1px 6px;
}

// ── Panel ───────────────────────────────────────────────────
.PageAdminLineManagement__panel {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  overflow: hidden;
}

// ── Channel sub-tab ─────────────────────────────────────────
.PageAdminLineManagement__sub-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid $border;
}

.PageAdminLineManagement__sub-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 14px 20px;
  border: none;
  border-bottom: 3px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.4;
  }

  &.is-passenger.is-active {
    color: #2563eb;
    border-bottom-color: #2563eb;
    background: rgba(37, 99, 235, 0.05);
    .dot { opacity: 1; }
  }
  &.is-driver.is-active {
    color: #059669;
    border-bottom-color: #059669;
    background: rgba(5, 150, 105, 0.05);
    .dot { opacity: 1; }
  }
  &:not(.is-active) {
    color: $muted;
  }
}

// ── Status filter ──────────────────────────────────────────
.PageAdminLineManagement__filter {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  border-bottom: 1px solid $border;
  flex-wrap: wrap;
}

.PageAdminLineManagement__filter-tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: 100px;
  background: transparent;
  color: $muted;
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    color: $amber;
    background: rgba(212, 134, 10, 0.1);
    border-color: rgba(212, 134, 10, 0.3);
  }
}

.PageAdminLineManagement__filter-spacer { flex: 1; }

.PageAdminLineManagement__new {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 16px;
  border-radius: 100px;
  background: $amber;
  color: white;
  border: none;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: #b8730a; }
}

// ── 列表 ─────────────────────────────────────────────────────
.PageAdminLineManagement__loading {
  padding: 40px;
  text-align: center;
  font-family: 'Barlow Condensed', sans-serif;
  color: $muted;
}

.PageAdminLineManagement__empty {
  padding: 40px;
  text-align: center;
  font-family: 'Barlow Condensed', sans-serif;
  color: $muted;
}

.PageAdminLineManagement__list {
  display: flex;
  flex-direction: column;
}

.PageAdminLineManagement__card {
  border-bottom: 1px solid $border;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: background 0.15s;

  &:last-child { border-bottom: none; }
  &:hover { background: rgba(212, 134, 10, 0.03); }
  &.is-active { background: rgba(5, 150, 105, 0.04); }
}

.PageAdminLineManagement__card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.PageAdminLineManagement__card-name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 16px;
  font-weight: 700;
  flex: 1;
  min-width: 0;
}

.PageAdminLineManagement__status-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  border-radius: 100px;
  padding: 2px 8px;
  border: 1px solid;

  &.is-draft {
    color: #6b7280;
    background: rgba(107, 114, 128, 0.1);
    border-color: rgba(107, 114, 128, 0.3);
  }
  &.is-active {
    color: #059669;
    background: rgba(5, 150, 105, 0.1);
    border-color: rgba(5, 150, 105, 0.4);
  }
  &.is-archived {
    color: #9ca3af;
    background: rgba(156, 163, 175, 0.1);
    border-color: rgba(156, 163, 175, 0.3);
  }
}

.PageAdminLineManagement__sync-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  border-radius: 100px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.05);
  color: $muted;

  &.is-synced { color: #059669; background: rgba(5, 150, 105, 0.08); }
  &.is-syncing { color: #d4860a; background: rgba(212, 134, 10, 0.1); }
  &.is-sync_failed { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
}

.PageAdminLineManagement__card-body {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
}

.PageAdminLineManagement__thumb {
  width: 140px;
  height: 95px;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid $border;

  img { width: 100%; height: 100%; object-fit: cover; }

  &.is-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    color: $muted;
    text-align: center;
    padding: 8px;
  }
}

.PageAdminLineManagement__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;

    .k {
      font-weight: 700;
      letter-spacing: 0.08em;
      color: $muted;
      min-width: 80px;
    }
    .v {
      flex: 1;
      min-width: 0;
      word-break: break-word;
      &.mono { font-family: monospace; font-size: 11px; }
    }

    &.err .v { color: #ef4444; }
  }
}

.PageAdminLineManagement__card-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.PageAdminLineManagement__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-approve {
    background: rgba(5, 150, 105, 0.1);
    border-color: rgba(5, 150, 105, 0.4);
    color: #059669;
    &:hover:not(:disabled) { background: rgba(5, 150, 105, 0.18); }
  }
  &.is-warning {
    background: rgba(212, 134, 10, 0.1);
    border-color: rgba(212, 134, 10, 0.4);
    color: #d4860a;
    &:hover:not(:disabled) { background: rgba(212, 134, 10, 0.18); }
  }
  &.is-reject {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.35);
    color: #ef4444;
    &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.16); }
  }
  &.is-toggle {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.7);
    &:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.06);
    }
  }
}

// ── Templates Tab ─────────────────────────────────────────
.PageAdminLineManagement__templates {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 600px;
}

.PageAdminLineManagement__template-list {
  border-right: 1px solid $border;
  padding: 12px 0;
  overflow-y: auto;
}

.PageAdminLineManagement__template-cat-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: $muted;
  padding: 8px 16px 4px;
}

.PageAdminLineManagement__template-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.7);
  text-align: left;
  border-left: 3px solid transparent;
  transition: background 0.15s;

  &:hover { background: rgba(0, 0, 0, 0.03); }
  &.is-active {
    background: rgba(212, 134, 10, 0.08);
    color: rgba(0, 0, 0, 0.9);
    border-left-color: $amber;
    font-weight: 700;
  }
  &.is-disabled .PageAdminLineManagement__template-name {
    text-decoration: line-through;
    opacity: 0.5;
  }
}

.PageAdminLineManagement__template-name {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.PageAdminLineManagement__template-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}
.PageAdminLineManagement__template-entry.is-customized .PageAdminLineManagement__template-dot {
  background: #059669;
}
.PageAdminLineManagement__template-entry.is-customized.is-disabled .PageAdminLineManagement__template-dot {
  background: #ef4444;
}

.PageAdminLineManagement__template-editor {
  background: rgba(255, 255, 255, 0.5);
}

// ── Bot Replies Tab（P40 Phase 2）─────────────────────────
.PageAdminLineManagement__bot-intro {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  padding: 14px 18px;
  border-bottom: 1px solid $border;
  letter-spacing: 0.05em;
}

.PageAdminLineManagement__bot-rows {
  display: flex;
  flex-direction: column;
}

.PageAdminLineManagement__bot-row {
  padding: 18px;
  border-bottom: 1px solid $border;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &:last-child { border-bottom: none; }
  &.is-passenger { border-left: 3px solid rgba(37, 99, 235, 0.4); }
  &.is-driver { border-left: 3px solid rgba(5, 150, 105, 0.4); }
}

.PageAdminLineManagement__bot-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.PageAdminLineManagement__bot-channel {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  border-radius: 100px;
  padding: 3px 10px;

  &.is-passenger {
    background: rgba(37, 99, 235, 0.12);
    color: #2563eb;
  }
  &.is-driver {
    background: rgba(5, 150, 105, 0.12);
    color: #059669;
  }
}

.PageAdminLineManagement__bot-type-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.PageAdminLineManagement__bot-customized {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: $amber;
  background: rgba(212, 134, 10, 0.1);
  border-radius: 100px;
  padding: 2px 8px;
}

.PageAdminLineManagement__bot-flex { flex: 1; }

.PageAdminLineManagement__bot-enabled {
  display: inline-flex;
  align-items: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  cursor: pointer;
}

.PageAdminLineManagement__bot-desc {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  letter-spacing: 0.05em;
}

.PageAdminLineManagement__bot-text {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid $border;
  border-radius: 8px;
  font-family: 'Noto Sans TC', 'Barlow', sans-serif;
  font-size: 13px;
  line-height: 1.6;
  background: white;
  resize: vertical;
  min-height: 96px;

  &:focus {
    outline: none;
    border-color: $amber;
  }
}

.PageAdminLineManagement__bot-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.PageAdminLineManagement__bot-meta {
  flex: 1;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
  letter-spacing: 0.05em;
}

.PageAdminLineManagement__bot-actions {
  display: flex;
  gap: 6px;
}

// ── 其他 tab placeholder ────────────────────────────────────
.PageAdminLineManagement__placeholder {
  padding: 60px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;

  &-icon { font-size: 36px; }
  &-text {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 14px;
    letter-spacing: 0.08em;
    color: $muted;
  }
}

// ── RWD ─────────────────────────────────────────────────────
@media (max-width: 600px) {
  .PageAdminLineManagement__card-body {
    grid-template-columns: 1fr;
  }
  .PageAdminLineManagement__thumb {
    width: 100%;
    height: 160px;
  }
  .PageAdminLineManagement__templates {
    grid-template-columns: 1fr;
  }
  .PageAdminLineManagement__template-list {
    border-right: none;
    border-bottom: 1px solid $border;
    max-height: 240px;
  }
}
</style>
