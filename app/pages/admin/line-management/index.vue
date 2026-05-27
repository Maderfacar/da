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
  RichmenuLang,
  RichmenuStatus,
  SyncOverviewRes,
} from '@/protocol/fetch-api/api/admin/line-richmenu';
import type { NotificationTemplateItem } from '@/protocol/fetch-api/api/admin/notification-template';
import type { BotReplyItem, BotReplyKey } from '@/protocol/fetch-api/api/admin/bot-reply';
import type {
  EventLogDto,
  EventLogType,
  EventLogHandlerResult,
} from '@/protocol/fetch-api/api/admin/line-event-log';
import type { ApiErrorDto } from '@/protocol/fetch-api/api/admin/line-api-error';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

type MainTab = 'richmenu' | 'templates' | 'diagnostics';

const MAIN_TABS: Array<{ key: MainTab; label: string; ready: boolean }> = [
  { key: 'richmenu', label: '圖文選單', ready: true },
  { key: 'templates', label: '訊息模板', ready: true },
  { key: 'diagnostics', label: '診斷', ready: true },
];

// W5：templates tab 下的 category sub-tab（含 bot-reply 為自動回覆，原 bot-replies 主 tab 整合進來）
type CategoryKey = 'all' | 'order' | 'dispatch' | 'driver-notify' | 'softmatch' | 'bot-reply';

const CATEGORY_TABS: Array<{ key: CategoryKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'order', label: '📦 訂單' },
  { key: 'dispatch', label: '🚖 派發/配對' },
  { key: 'driver-notify', label: '👤 司機通知' },
  { key: 'softmatch', label: '🔁 軟配' },
  { key: 'bot-reply', label: '🤖 自動回覆' },
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
  // W5：?tab=bot-replies 舊 URL → 自動 redirect 到 templates（category 由 InitCategory 處理）
  if (q === 'bot-replies') return 'templates';
  return MAIN_TABS.find((t) => t.key === q)?.key ?? 'richmenu';
};

const InitCategory = (): CategoryKey => {
  const tabQ = route.query.tab as string | undefined;
  if (tabQ === 'bot-replies') return 'bot-reply';
  const catQ = route.query.category as string | undefined;
  return CATEGORY_TABS.find((c) => c.key === catQ)?.key ?? 'all';
};

const activeMainTab = ref<MainTab>(InitMainTab());
const activeCategory = ref<CategoryKey>(InitCategory());

watch(activeMainTab, (tab) => {
  const nextQuery: Record<string, string> = { ...route.query, tab };
  if (tab === 'templates') {
    nextQuery.category = activeCategory.value;
  } else {
    delete nextQuery.category;
  }
  void router.replace({ query: nextQuery });
});

watch(activeCategory, (cat) => {
  if (activeMainTab.value !== 'templates') return;
  void router.replace({ query: { ...route.query, tab: 'templates', category: cat } });
});

// ── Richmenu tab：channel × lang 子 tab + 列表 ──────────────
const activeChannel = ref<LineClient>('passenger');
// P42：lang sub-tab（'all' 跨 lang 顯示 / 'zh_tw'/'en'/'ja' 單 lang filter）
const activeLang = ref<RichmenuLang | 'all'>('all');
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

// P42：lang sub-tab 設定
const LANG_TABS: Array<{ key: RichmenuLang | 'all'; label: string }> = [
  { key: 'all', label: '全語系' },
  { key: 'zh_tw', label: '繁中 zh' },
  { key: 'en', label: '英文 en' },
  { key: 'ja', label: '日文 ja' },
];

const LANG_LABEL: Record<RichmenuLang, string> = {
  zh_tw: '繁中',
  en: 'EN',
  ja: 'JA',
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
      lang: activeLang.value,
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

watch([activeChannel, activeLang, activeStatus], () => {
  void ApiLoadList();
});

// ── 動作 ─────────────────────────────────────────────────────
const ClickCreate = async () => {
  // P42：若 activeLang 是 'all'（未鎖定單一 lang），預設帶 zh_tw 給 dialog（user 仍可在彈窗內改）
  const defaultLang: RichmenuLang = activeLang.value === 'all' ? 'zh_tw' : activeLang.value;
  const result = await $open.DialogLineRichmenuEdit({
    mode: 'create',
    channel: activeChannel.value,
    lang: defaultLang,
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
    EnsureSelectedTemplateInCategory();
  } finally {
    templatesLoading.value = false;
  }
};

// W5：依 activeCategory 過濾 registry templates；bot-reply 走獨立 BotReplies UI 不在這
const FilteredTemplates = computed<NotificationTemplateItem[]>(() => {
  if (activeCategory.value === 'all') return templates.value;
  if (activeCategory.value === 'bot-reply') return [];
  return templates.value.filter((t) => t.meta.category === activeCategory.value);
});

const TemplatesByCategory = computed(() => {
  const groups = new Map<string, NotificationTemplateItem[]>();
  for (const t of FilteredTemplates.value) {
    const cat = t.meta.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(t);
  }
  return groups;
});

const CATEGORY_LABEL: Record<string, string> = {
  order: '訂單事件',
  dispatch: '派發/配對',
  softmatch: '軟性配對',
  'driver-notify': '司機通知',
  announcement: '公告',
  bot: 'Bot 自動回覆',
  broadcast: '廣播',
};

// W7：列表 badge label + super 鎖
// 注意：必須用 StoreAuth（admin level 在這），StoreSelf 沒有 isSuper → 會永遠鎖死所有 super 模板
const storeAuth = StoreAuth();

const TRIGGER_TYPE_BADGE: Record<string, { icon: string; label: string }> = {
  auto: { icon: '📅', label: '自動' },
  manual: { icon: '✋', label: '手動' },
};
const OUTPUT_TYPE_BADGE: Record<string, { icon: string; label: string }> = {
  flex: { icon: '🎴', label: 'Flex' },
  text: { icon: '💬', label: '文字' },
};
const I18N_MODE_BADGE: Record<string, { icon: string; label: string }> = {
  multi: { icon: '🌏', label: '三語' },
  single: { icon: '🇹🇼', label: '繁中' },
};
const AUDIENCE_BADGE: Record<string, { icon: string; label: string }> = {
  passenger: { icon: '🧑‍✈️', label: '乘客' },
  driver: { icon: '🚗', label: '司機' },
  admin: { icon: '👤', label: '管理員' },
  both: { icon: '🌐', label: '全體' },
};

const IsTemplateLocked = (t: NotificationTemplateItem): boolean =>
  t.meta.requiresSuperLevel && !storeAuth.isSuper;

const ClickSelectTemplate = (t: NotificationTemplateItem): void => {
  if (IsTemplateLocked(t)) {
    ElMessage({ message: '此模板需 super 級別才能編輯', type: 'warning' });
    return;
  }
  selectedTemplateKey.value = t.meta.templateKey;
};

// 切 category 時：保留當前 selection 若仍在過濾列表中，否則 reset 到第一筆（優先非鎖定）
const EnsureSelectedTemplateInCategory = (): void => {
  if (activeCategory.value === 'bot-reply') {
    selectedTemplateKey.value = '';
    return;
  }
  const list = FilteredTemplates.value;
  if (list.length === 0) {
    selectedTemplateKey.value = '';
    return;
  }
  const stillValid = list.some((t) => t.meta.templateKey === selectedTemplateKey.value);
  if (!stillValid) {
    const firstUnlocked = list.find((t) => !IsTemplateLocked(t));
    selectedTemplateKey.value = (firstUnlocked ?? list[0]!).meta.templateKey;
  }
};

watch(activeCategory, (cat) => {
  if (cat === 'bot-reply') {
    selectedTemplateKey.value = '';
    if (botReplies.value.length === 0) void ApiLoadBotReplies();
    return;
  }
  EnsureSelectedTemplateInCategory();
});

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

// ── Diagnostics tab（P40 Phase 3 + P43 Phase 3 sub-tab） ──
type DiagSubTab = 'overview' | 'event-log' | 'error-log';

const DIAG_SUB_TABS: Array<{ key: DiagSubTab; label: string }> = [
  { key: 'overview', label: 'Sync Overview' },
  { key: 'event-log', label: 'Event Log' },
  { key: 'error-log', label: 'Error Log' },
];

const activeDiagSubTab = ref<DiagSubTab>('overview');

const diagnostics = reactive<{
  passenger: SyncOverviewRes | null;
  driver: SyncOverviewRes | null;
}>({ passenger: null, driver: null });
const diagnosticsLoading = reactive<Record<LineClient, boolean>>({ passenger: false, driver: false });
const cleaningOrphanId = ref<string>('');

// ── Event Log sub-tab ──────────────────────────────────────
const EVENT_TYPE_OPTIONS: Array<{ value: EventLogType | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'follow', label: 'Follow' },
  { value: 'unfollow', label: 'Unfollow' },
  { value: 'message', label: 'Message' },
  { value: 'postback', label: 'Postback' },
  { value: 'beacon', label: 'Beacon' },
  { value: 'memberJoined', label: 'MemberJoined' },
  { value: 'memberLeft', label: 'MemberLeft' },
  { value: 'unknown', label: '其他' },
];

const HANDLER_RESULT_OPTIONS: Array<{ value: EventLogHandlerResult | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'replied', label: 'Replied' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'handler_failed', label: 'Handler Failed' },
  { value: 'no_handler', label: 'No Handler' },
];

const eventLogChannel = ref<LineClient>('passenger');
const eventLogTypeFilter = ref<EventLogType | ''>('');
const eventLogResultFilter = ref<EventLogHandlerResult | ''>('');
const eventLogs = ref<EventLogDto[]>([]);
const eventLogsLoading = ref(false);
const expandedEventLogId = ref<string>('');

const ApiLoadEventLogs = async () => {
  eventLogsLoading.value = true;
  try {
    const res = await $api.GetLineEventLogs({
      channel: eventLogChannel.value,
      ...(eventLogTypeFilter.value ? { eventType: eventLogTypeFilter.value } : {}),
      ...(eventLogResultFilter.value ? { handlerResult: eventLogResultFilter.value } : {}),
      limit: 50,
    });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '載入 Event Log 失敗', type: 'error' });
      eventLogs.value = [];
      return;
    }
    eventLogs.value = res.data?.items ?? [];
  } finally {
    eventLogsLoading.value = false;
  }
};

watch([eventLogChannel, eventLogTypeFilter, eventLogResultFilter], () => {
  if (activeDiagSubTab.value === 'event-log') void ApiLoadEventLogs();
});

const ToggleExpandEventLog = (id: string) => {
  expandedEventLogId.value = expandedEventLogId.value === id ? '' : id;
};

// ── Error Log sub-tab ──────────────────────────────────────
const ERROR_CHANNEL_OPTIONS: Array<{ value: 'passenger' | 'driver' | 'unknown'; label: string }> = [
  { value: 'passenger', label: '乘客 OA' },
  { value: 'driver', label: '司機 OA' },
  { value: 'unknown', label: 'Unknown' },
];

const errorLogChannel = ref<'passenger' | 'driver' | 'unknown'>('passenger');
const errorLogApiFilter = ref<string>('');
const errorLogs = ref<ApiErrorDto[]>([]);
const errorLogsLoading = ref(false);
const expandedErrorLogId = ref<string>('');

const ApiLoadErrorLogs = async () => {
  errorLogsLoading.value = true;
  try {
    const res = await $api.GetLineApiErrors({
      channel: errorLogChannel.value,
      ...(errorLogApiFilter.value ? { api: errorLogApiFilter.value } : {}),
      limit: 50,
    });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '載入 Error Log 失敗', type: 'error' });
      errorLogs.value = [];
      return;
    }
    errorLogs.value = res.data?.items ?? [];
  } finally {
    errorLogsLoading.value = false;
  }
};

watch([errorLogChannel, errorLogApiFilter], () => {
  if (activeDiagSubTab.value === 'error-log') void ApiLoadErrorLogs();
});

const ToggleExpandErrorLog = (id: string) => {
  expandedErrorLogId.value = expandedErrorLogId.value === id ? '' : id;
};

// 切 sub-tab 時 lazy load 對應 API
watch(activeDiagSubTab, (sub) => {
  if (sub === 'event-log' && eventLogs.value.length === 0) void ApiLoadEventLogs();
  if (sub === 'error-log' && errorLogs.value.length === 0) void ApiLoadErrorLogs();
});

const ApiLoadDiagnostics = async (channel: LineClient) => {
  diagnosticsLoading[channel] = true;
  try {
    const res = await $api.GetRichmenuSyncOverview(channel);
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '載入診斷失敗', type: 'error' });
      diagnostics[channel] = null;
      return;
    }
    diagnostics[channel] = res.data ?? null;
  } finally {
    diagnosticsLoading[channel] = false;
  }
};

const ClickCleanupOrphan = async (channel: LineClient, orphan: { richMenuId: string; name: string }) => {
  const ok = await UseAsk(`確定要刪除 LINE 端孤兒選單「${orphan.name || orphan.richMenuId.slice(0, 16)}」？\n此動作無法復原（直接 call LINE DELETE /v2/bot/richmenu/{id}）。`);
  if (!ok) return;
  cleaningOrphanId.value = orphan.richMenuId;
  try {
    const res = await $api.CleanupOrphanRichmenu({ channel, lineRichMenuId: orphan.richMenuId });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({
        message: res.status.message?.zh_tw || '清理失敗',
        type: 'error',
        duration: 6000,
      });
      return;
    }
    ElMessage({ message: '已清理', type: 'success' });
    await ApiLoadDiagnostics(channel);
  } finally {
    cleaningOrphanId.value = '';
  }
};

watch(activeMainTab, (tab) => {
  if (tab === 'templates') {
    if (templates.value.length === 0) void ApiLoadTemplates();
    if (activeCategory.value === 'bot-reply' && botReplies.value.length === 0) {
      void ApiLoadBotReplies();
    }
  }
  if (tab === 'diagnostics') {
    if (diagnostics.passenger === null) void ApiLoadDiagnostics('passenger');
    if (diagnostics.driver === null) void ApiLoadDiagnostics('driver');
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
  // W5：若初始 URL 為舊版 ?tab=bot-replies，cleanup query 為 ?tab=templates&category=bot-reply
  if (route.query.tab === 'bot-replies') {
    void router.replace({ query: { ...route.query, tab: 'templates', category: 'bot-reply' } });
  }
  void ApiLoadList();
  if (activeMainTab.value === 'templates') {
    void ApiLoadTemplates();
    if (activeCategory.value === 'bot-reply') {
      void ApiLoadBotReplies();
    }
  }
  if (activeMainTab.value === 'diagnostics') {
    void ApiLoadDiagnostics('passenger');
    void ApiLoadDiagnostics('driver');
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

    //- P42：lang sub-tab（all / zh_tw / en / ja）
    .PageAdminLineManagement__lang-tabs
      button.PageAdminLineManagement__lang-tab(
        v-for="lt in LANG_TABS"
        :key="lt.key"
        :class="[`is-${lt.key}`, { 'is-active': activeLang === lt.key }]"
        @click="activeLang = lt.key"
      ) {{ lt.label }}

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
            span.PageAdminLineManagement__lang-badge(:class="`is-${m.lang}`") {{ LANG_LABEL[m.lang] }}
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

  //- ── Templates Tab（W5：含 category sub-tab + bot-reply 整合）─────
  .PageAdminLineManagement__panel(v-else-if="activeMainTab === 'templates'")
    //- W5：category sub-tab
    .PageAdminLineManagement__category-tabs
      button.PageAdminLineManagement__category-tab(
        v-for="c in CATEGORY_TABS"
        :key="c.key"
        :class="[`is-${c.key}`, { 'is-active': activeCategory === c.key }]"
        @click="activeCategory = c.key"
      ) {{ c.label }}

    //- bot-reply category → BotReplies UI
    template(v-if="activeCategory === 'bot-reply'")
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

    //- 其他 category → registry templates UI
    template(v-else)
      .PageAdminLineManagement__loading(v-if="templatesLoading") 載入中...
      template(v-else)
        .PageAdminLineManagement__templates
          //- 左側 list（依 category 分組；單一 category 時不顯 group label）
          aside.PageAdminLineManagement__template-list
            .PageAdminLineManagement__template-empty(v-if="FilteredTemplates.length === 0")
              span 此分類下沒有模板
            template(v-else-if="activeCategory === 'all'")
              template(v-for="[cat, items] in TemplatesByCategory" :key="cat")
                .PageAdminLineManagement__template-cat-label {{ CATEGORY_LABEL[cat] || cat }}
                button.PageAdminLineManagement__template-entry(
                  v-for="t in items"
                  :key="t.meta.templateKey"
                  :class="{ 'is-active': selectedTemplateKey === t.meta.templateKey, 'is-customized': t.content !== null, 'is-disabled': !t.enabled, 'is-locked': IsTemplateLocked(t) }"
                  :title="IsTemplateLocked(t) ? '需 super 權限' : ''"
                  @click="ClickSelectTemplate(t)"
                )
                  span.PageAdminLineManagement__template-name {{ t.meta.displayName }}
                  span.PageAdminLineManagement__template-badges
                    span.PageAdminLineManagement__template-badge(:title="TRIGGER_TYPE_BADGE[t.meta.triggerType].label") {{ TRIGGER_TYPE_BADGE[t.meta.triggerType].icon }}
                    span.PageAdminLineManagement__template-badge(:title="OUTPUT_TYPE_BADGE[t.meta.outputType].label") {{ OUTPUT_TYPE_BADGE[t.meta.outputType].icon }}
                    span.PageAdminLineManagement__template-badge(:title="I18N_MODE_BADGE[t.meta.i18nMode].label") {{ I18N_MODE_BADGE[t.meta.i18nMode].icon }}
                    span.PageAdminLineManagement__template-badge(:title="AUDIENCE_BADGE[t.meta.audience].label") {{ AUDIENCE_BADGE[t.meta.audience].icon }}
                    span.PageAdminLineManagement__template-badge.is-lock(v-if="IsTemplateLocked(t)" title="需 super 權限") 🔒
                  span.PageAdminLineManagement__template-dot(
                    :title="t.content ? (t.enabled ? '已自訂' : '已自訂但停用') : '使用預設'"
                  )
            template(v-else)
              button.PageAdminLineManagement__template-entry(
                v-for="t in FilteredTemplates"
                :key="t.meta.templateKey"
                :class="{ 'is-active': selectedTemplateKey === t.meta.templateKey, 'is-customized': t.content !== null, 'is-disabled': !t.enabled, 'is-locked': IsTemplateLocked(t) }"
                :title="IsTemplateLocked(t) ? '需 super 權限' : ''"
                @click="ClickSelectTemplate(t)"
              )
                span.PageAdminLineManagement__template-name {{ t.meta.displayName }}
                span.PageAdminLineManagement__template-badges
                  span.PageAdminLineManagement__template-badge(:title="TRIGGER_TYPE_BADGE[t.meta.triggerType].label") {{ TRIGGER_TYPE_BADGE[t.meta.triggerType].icon }}
                  span.PageAdminLineManagement__template-badge(:title="OUTPUT_TYPE_BADGE[t.meta.outputType].label") {{ OUTPUT_TYPE_BADGE[t.meta.outputType].icon }}
                  span.PageAdminLineManagement__template-badge(:title="I18N_MODE_BADGE[t.meta.i18nMode].label") {{ I18N_MODE_BADGE[t.meta.i18nMode].icon }}
                  span.PageAdminLineManagement__template-badge(:title="AUDIENCE_BADGE[t.meta.audience].label") {{ AUDIENCE_BADGE[t.meta.audience].icon }}
                  span.PageAdminLineManagement__template-badge.is-lock(v-if="IsTemplateLocked(t)" title="需 super 權限") 🔒
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

  //- ── Diagnostics Tab（P40 MVP + P43 sub-tab 完整版）────
  .PageAdminLineManagement__panel(v-else-if="activeMainTab === 'diagnostics'")
    //- sub-tab switcher（P43 Phase 3）
    .PageAdminLineManagement__diag-sub-tabs
      button.PageAdminLineManagement__diag-sub-tab(
        v-for="t in DIAG_SUB_TABS"
        :key="t.key"
        :class="{ 'is-active': activeDiagSubTab === t.key }"
        @click="activeDiagSubTab = t.key"
      ) {{ t.label }}

    //- ── Overview sub-panel（P40 既有） ────────────────
    template(v-if="activeDiagSubTab === 'overview'")
      .PageAdminLineManagement__diag-intro
        | 對比本地 line_richmenus collection 與 LINE 端 listRichmenus / default 設定。發現孤兒選單可一鍵清理。
      .PageAdminLineManagement__diag-grid
        template(v-for="ch in (['passenger', 'driver'] as LineClient[])" :key="ch")
          section.PageAdminLineManagement__diag-card(:class="`is-${ch}`")
            header.PageAdminLineManagement__diag-head
              span.PageAdminLineManagement__diag-channel(:class="`is-${ch}`")
                | {{ ch === 'passenger' ? '乘客 OA' : '司機 OA' }}
              span.PageAdminLineManagement__diag-flex
              button.PageAdminLineManagement__btn.is-toggle(
                :disabled="diagnosticsLoading[ch]"
                @click="ApiLoadDiagnostics(ch)"
              ) {{ diagnosticsLoading[ch] ? '查詢中...' : '重新檢查' }}

            .PageAdminLineManagement__diag-loading(v-if="diagnosticsLoading[ch] && !diagnostics[ch]") 載入中...
            .PageAdminLineManagement__diag-empty(v-else-if="!diagnostics[ch]") 尚未查詢

            template(v-else-if="diagnostics[ch]")
              //- 一致性 banner
              .PageAdminLineManagement__diag-banner(v-if="diagnostics[ch]!.match")
                span.PageAdminLineManagement__diag-banner-icon ✓
                | LINE 端與本地一致
              .PageAdminLineManagement__diag-banner.is-warning(v-else)
                span.PageAdminLineManagement__diag-banner-icon ⚠
                | 偵測到不一致
              ul.PageAdminLineManagement__diag-inc(v-if="diagnostics[ch]!.inconsistencies.length > 0")
                li(v-for="msg in diagnostics[ch]!.inconsistencies" :key="msg") {{ msg }}

              //- LINE 端 listRichmenus
              .PageAdminLineManagement__diag-section
                .PageAdminLineManagement__diag-section-label LINE 端選單（{{ diagnostics[ch]!.line.allMenus.length }} 個）
                .PageAdminLineManagement__diag-meta-row
                  span.k Default ID
                  span.v.mono {{ diagnostics[ch]!.line.defaultRichMenuId ?? '無' }}
                ul.PageAdminLineManagement__diag-menus(v-if="diagnostics[ch]!.line.allMenus.length > 0")
                  li.PageAdminLineManagement__diag-menu-item(
                    v-for="m in diagnostics[ch]!.line.allMenus"
                    :key="m.richMenuId"
                    :class="{ 'is-default': m.isDefault, 'is-orphan': !m.hasLocalDoc }"
                  )
                    span.PageAdminLineManagement__diag-menu-name {{ m.name || '(no name)' }}
                    span.PageAdminLineManagement__diag-menu-id {{ m.richMenuId.slice(0, 18) }}…
                    span.PageAdminLineManagement__diag-menu-badge.is-default(v-if="m.isDefault") DEFAULT
                    span.PageAdminLineManagement__diag-menu-badge.is-orphan(v-if="!m.hasLocalDoc") ORPHAN
                    span.PageAdminLineManagement__diag-menu-flex
                    button.PageAdminLineManagement__btn.is-reject(
                      v-if="!m.hasLocalDoc"
                      :disabled="cleaningOrphanId === m.richMenuId"
                      @click="ClickCleanupOrphan(ch, { richMenuId: m.richMenuId, name: m.name })"
                    ) {{ cleaningOrphanId === m.richMenuId ? '清理中...' : '清理' }}
                .PageAdminLineManagement__diag-empty(v-else) 無

              //- 本地 docs
              .PageAdminLineManagement__diag-section
                .PageAdminLineManagement__diag-section-label 本地 line_richmenus（{{ diagnostics[ch]!.local.docs.length }} 筆）
                .PageAdminLineManagement__diag-meta-row(v-if="diagnostics[ch]!.local.activeDoc")
                  span.k Active doc
                  span.v {{ diagnostics[ch]!.local.activeDoc!.name }} / {{ diagnostics[ch]!.local.activeDoc!.lineRichMenuId ?? '無' }}
                .PageAdminLineManagement__diag-meta-row(v-else)
                  span.k Active doc
                  span.v.muted 無
                ul.PageAdminLineManagement__diag-stale(v-if="diagnostics[ch]!.stale.length > 0")
                  li(v-for="s in diagnostics[ch]!.stale" :key="s.docId")
                    | 🔗 doc 「{{ s.name }}」記錄 lineRichMenuId {{ s.lineRichMenuId.slice(0, 18) }}… 但 LINE 端不存在 → 重新發佈或請開發者清理

    //- ── Event Log sub-panel（P43 Phase 3） ────────────
    template(v-if="activeDiagSubTab === 'event-log'")
      .PageAdminLineManagement__diag-intro
        | 列最近 50 筆 webhook event（依 createdAt desc）。要查更舊紀錄請至 Firestore Console。
      .PageAdminLineManagement__diag-filters
        label.PageAdminLineManagement__diag-filter
          span.k Channel
          select(v-model="eventLogChannel")
            option(value="passenger") 乘客 OA
            option(value="driver") 司機 OA
        label.PageAdminLineManagement__diag-filter
          span.k Event Type
          select(v-model="eventLogTypeFilter")
            option(v-for="o in EVENT_TYPE_OPTIONS" :key="o.value" :value="o.value") {{ o.label }}
        label.PageAdminLineManagement__diag-filter
          span.k Handler Result
          select(v-model="eventLogResultFilter")
            option(v-for="o in HANDLER_RESULT_OPTIONS" :key="o.value" :value="o.value") {{ o.label }}
        button.PageAdminLineManagement__btn.is-toggle(
          :disabled="eventLogsLoading"
          @click="ApiLoadEventLogs"
        ) {{ eventLogsLoading ? '查詢中...' : '重新整理' }}

      .PageAdminLineManagement__diag-loading(v-if="eventLogsLoading && eventLogs.length === 0") 載入中...
      .PageAdminLineManagement__diag-empty(v-else-if="eventLogs.length === 0") 無 event log
      .PageAdminLineManagement__diag-table(v-else)
        .PageAdminLineManagement__diag-row.is-head
          .col.time 時間
          .col.channel Channel
          .col.type Type
          .col.uid UID
          .col.detail Detail
          .col.result Result
        template(v-for="ev in eventLogs" :key="ev.id")
          .PageAdminLineManagement__diag-row(
            :class="{ 'is-expanded': expandedEventLogId === ev.id, 'is-failed': ev.handlerResult === 'handler_failed' }"
            @click="ToggleExpandEventLog(ev.id)"
          )
            .col.time {{ ev.createdAt ? $dayjs(ev.createdAt).format('MM/DD HH:mm:ss') : '—' }}
            .col.channel {{ ev.channel === 'passenger' ? '乘客' : '司機' }}
            .col.type {{ ev.eventType }}
            .col.uid.mono {{ ev.lineUid ? ev.lineUid.slice(0, 12) + '…' : '—' }}
            .col.detail {{ ev.postbackData ?? ev.messageText ?? '—' }}
            .col.result(:class="`is-${ev.handlerResult}`") {{ ev.handlerResult }}
          .PageAdminLineManagement__diag-expand(v-if="expandedEventLogId === ev.id")
            .row
              span.k Full UID
              span.v.mono {{ ev.lineUid ?? '—' }}
            .row(v-if="ev.postbackData !== null")
              span.k Postback Data
              span.v.mono {{ ev.postbackData }}
            .row(v-if="ev.messageText !== null")
              span.k Message Text
              span.v {{ ev.messageText }}
            .row
              span.k Created
              span.v {{ ev.createdAt ? $dayjs(ev.createdAt).format('YYYY/MM/DD HH:mm:ss') : '—' }}

    //- ── Error Log sub-panel（P43 Phase 3） ────────────
    template(v-if="activeDiagSubTab === 'error-log'")
      .PageAdminLineManagement__diag-intro
        | 列最近 50 筆 LINE API error log（依 createdAt desc）。要查更舊紀錄請至 Firestore Console。
      .PageAdminLineManagement__diag-filters
        label.PageAdminLineManagement__diag-filter
          span.k Channel
          select(v-model="errorLogChannel")
            option(v-for="o in ERROR_CHANNEL_OPTIONS" :key="o.value" :value="o.value") {{ o.label }}
        label.PageAdminLineManagement__diag-filter
          span.k API（含字串過濾）
          input(
            v-model="errorLogApiFilter"
            type="text"
            maxlength="50"
            placeholder="例：message / richmenu"
          )
        button.PageAdminLineManagement__btn.is-toggle(
          :disabled="errorLogsLoading"
          @click="ApiLoadErrorLogs"
        ) {{ errorLogsLoading ? '查詢中...' : '重新整理' }}

      .PageAdminLineManagement__diag-loading(v-if="errorLogsLoading && errorLogs.length === 0") 載入中...
      .PageAdminLineManagement__diag-empty(v-else-if="errorLogs.length === 0") 無 error log
      .PageAdminLineManagement__diag-table(v-else)
        .PageAdminLineManagement__diag-row.is-head
          .col.time 時間
          .col.channel Channel
          .col.api API
          .col.method Method
          .col.status Status
          .col.message Message
        template(v-for="er in errorLogs" :key="er.id")
          .PageAdminLineManagement__diag-row.is-error(
            :class="{ 'is-expanded': expandedErrorLogId === er.id }"
            @click="ToggleExpandErrorLog(er.id)"
          )
            .col.time {{ er.createdAt ? $dayjs(er.createdAt).format('MM/DD HH:mm:ss') : '—' }}
            .col.channel {{ er.channel === 'passenger' ? '乘客' : er.channel === 'driver' ? '司機' : '—' }}
            .col.api.mono {{ er.api }}
            .col.method {{ er.method }}
            .col.status(:class="er.statusCode >= 500 ? 'is-5xx' : er.statusCode >= 400 ? 'is-4xx' : ''") {{ er.statusCode }}
            .col.message {{ er.errorMessage.slice(0, 60) }}{{ er.errorMessage.length > 60 ? '…' : '' }}
          .PageAdminLineManagement__diag-expand(v-if="expandedErrorLogId === er.id")
            .row
              span.k Full Message
              span.v {{ er.errorMessage }}
            .row(v-if="er.errorDetails")
              span.k Details
              span.v.mono {{ er.errorDetails }}
            .row(v-if="er.context?.targetUid")
              span.k Target UID
              span.v.mono {{ er.context.targetUid }}
            .row(v-if="er.context?.richMenuId")
              span.k RichMenu ID
              span.v.mono {{ er.context.richMenuId }}
            .row
              span.k Created
              span.v {{ er.createdAt ? $dayjs(er.createdAt).format('YYYY/MM/DD HH:mm:ss') : '—' }}

  //- ── Other fallback（不會走到）────────────────────────
  .PageAdminLineManagement__panel(v-else)
    .PageAdminLineManagement__placeholder
      span.PageAdminLineManagement__placeholder-text 未知 tab
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

// P42：lang badge（卡片內 lang 標示）
.PageAdminLineManagement__lang-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  border-radius: 100px;
  padding: 2px 8px;

  &.is-zh_tw {
    background: rgba(220, 38, 38, 0.10);
    color: #b91c1c;
  }
  &.is-en {
    background: rgba(79, 70, 229, 0.10);
    color: #4338ca;
  }
  &.is-ja {
    background: rgba(244, 114, 182, 0.12);
    color: #be185d;
  }
}

// P42：lang sub-tab（channel sub-tab 下方的小一級 tab）
.PageAdminLineManagement__lang-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 16px 0;
  flex-wrap: wrap;
}

.PageAdminLineManagement__lang-tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 100px;
  padding: 4px 14px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: rgba(0, 0, 0, 0.25);
    color: #1f2937;
  }

  &.is-active {
    background: #1f2937;
    border-color: #1f2937;
    color: #fff;
  }

  &.is-all.is-active {
    background: #1f2937;
  }
  &.is-zh_tw.is-active {
    background: #b91c1c;
    border-color: #b91c1c;
  }
  &.is-en.is-active {
    background: #4338ca;
    border-color: #4338ca;
  }
  &.is-ja.is-active {
    background: #be185d;
    border-color: #be185d;
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

// ── Templates Tab category sub-tab（W5）─────────────────
.PageAdminLineManagement__category-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
  border-bottom: 1px solid $border;
  flex-wrap: wrap;
}

.PageAdminLineManagement__category-tab {
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 100px;
  padding: 5px 14px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: rgba(0, 0, 0, 0.25);
    color: #1f2937;
  }

  &.is-active {
    background: $amber;
    border-color: $amber;
    color: #fff;
  }

  &.is-bot-reply.is-active {
    background: #4338ca;
    border-color: #4338ca;
  }
  &.is-dispatch.is-active {
    background: #2563eb;
    border-color: #2563eb;
  }
  &.is-softmatch.is-active {
    background: #be185d;
    border-color: #be185d;
  }
  &.is-driver-notify.is-active {
    background: #059669;
    border-color: #059669;
  }
  &.is-order.is-active {
    background: #b91c1c;
    border-color: #b91c1c;
  }
}

.PageAdminLineManagement__template-empty {
  padding: 28px 16px;
  text-align: center;
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: $muted;
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
  gap: 6px;
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
  flex-wrap: nowrap;

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
  &.is-locked {
    cursor: not-allowed;
    opacity: 0.7;
    .PageAdminLineManagement__template-name {
      color: rgba(0, 0, 0, 0.4);
    }
    &:hover { background: rgba(239, 68, 68, 0.04); }
  }
}

.PageAdminLineManagement__template-name {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

// W7：列表 entry badge（4 icon + optional lock）
.PageAdminLineManagement__template-badges {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.PageAdminLineManagement__template-badge {
  font-size: 11px;
  line-height: 1;
  padding: 2px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);

  &.is-lock {
    background: rgba(239, 68, 68, 0.12);
  }
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

// ── Diagnostics Tab（P40 Phase 3）─────────────────────────
.PageAdminLineManagement__diag-intro {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  padding: 14px 18px;
  border-bottom: 1px solid $border;
  letter-spacing: 0.05em;
}

.PageAdminLineManagement__diag-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
}

.PageAdminLineManagement__diag-card {
  padding: 18px;
  border-right: 1px solid $border;
  display: flex;
  flex-direction: column;
  gap: 14px;

  &:last-child { border-right: none; }

  @media (max-width: 900px) {
    border-right: none;
    border-bottom: 1px solid $border;
  }
}

.PageAdminLineManagement__diag-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PageAdminLineManagement__diag-channel {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.15em;
  border-radius: 100px;
  padding: 4px 12px;

  &.is-passenger {
    background: rgba(37, 99, 235, 0.12);
    color: #2563eb;
  }
  &.is-driver {
    background: rgba(5, 150, 105, 0.12);
    color: #059669;
  }
}

.PageAdminLineManagement__diag-flex { flex: 1; }

.PageAdminLineManagement__diag-loading,
.PageAdminLineManagement__diag-empty {
  padding: 24px;
  text-align: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
}

.PageAdminLineManagement__diag-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(5, 150, 105, 0.08);
  color: #059669;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;

  &.is-warning {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
  }
}

.PageAdminLineManagement__diag-banner-icon {
  font-size: 16px;
}

.PageAdminLineManagement__diag-inc {
  margin: 0;
  padding: 8px 14px 8px 28px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: rgba(239, 68, 68, 0.9);
  line-height: 1.6;
  list-style: disc;
}

.PageAdminLineManagement__diag-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageAdminLineManagement__diag-section-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: $amber;
}

.PageAdminLineManagement__diag-meta-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;

  .k {
    font-weight: 700;
    letter-spacing: 0.08em;
    color: $muted;
    min-width: 90px;
  }
  .v {
    flex: 1;
    min-width: 0;
    word-break: break-all;
    &.mono { font-family: monospace; font-size: 11px; }
    &.muted { color: $muted; }
  }
}

.PageAdminLineManagement__diag-menus {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.PageAdminLineManagement__diag-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.03);
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;

  &.is-default { background: rgba(5, 150, 105, 0.08); }
  &.is-orphan { background: rgba(239, 68, 68, 0.08); }
}

.PageAdminLineManagement__diag-menu-name {
  font-weight: 700;
  letter-spacing: 0.04em;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.PageAdminLineManagement__diag-menu-id {
  font-family: monospace;
  font-size: 11px;
  color: $muted;
}

.PageAdminLineManagement__diag-menu-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  border-radius: 100px;
  padding: 2px 8px;

  &.is-default {
    color: #059669;
    background: rgba(5, 150, 105, 0.16);
  }
  &.is-orphan {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.14);
  }
}

.PageAdminLineManagement__diag-menu-flex { flex: 1; }

.PageAdminLineManagement__diag-stale {
  margin: 6px 0 0;
  padding: 0 0 0 18px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: #d4860a;
  list-style: disc;
  line-height: 1.6;
}

// ── Diagnostics sub-tab + Event/Error Log（P43 Phase 3）──
.PageAdminLineManagement__diag-sub-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid $border;
  padding: 0 12px;
}

.PageAdminLineManagement__diag-sub-tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 10px 18px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: $muted;
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    color: $amber;
    border-bottom-color: $amber;
  }
}

.PageAdminLineManagement__diag-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  padding: 14px 18px;
  border-bottom: 1px solid $border;
}

.PageAdminLineManagement__diag-filter {
  display: flex;
  flex-direction: column;
  gap: 2px;

  .k {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: $muted;
  }

  select,
  input[type='text'] {
    padding: 5px 10px;
    border: 1px solid $border;
    border-radius: 6px;
    font-family: 'Barlow', sans-serif;
    font-size: 12px;
    background: white;
    min-width: 120px;

    &:focus {
      outline: none;
      border-color: $amber;
    }
  }
}

.PageAdminLineManagement__diag-table {
  display: flex;
  flex-direction: column;
  padding: 0;
}

.PageAdminLineManagement__diag-row {
  display: grid;
  grid-template-columns: 90px 60px 90px 110px 1fr 90px;
  gap: 8px;
  align-items: center;
  padding: 8px 18px;
  border-bottom: 1px solid $border;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba(212, 134, 10, 0.04); }
  &.is-head {
    background: rgba(0, 0, 0, 0.03);
    font-weight: 700;
    letter-spacing: 0.1em;
    color: $muted;
    cursor: default;
    &:hover { background: rgba(0, 0, 0, 0.03); }
  }
  &.is-expanded { background: rgba(212, 134, 10, 0.06); }
  &.is-failed { background: rgba(239, 68, 68, 0.05); }
  &.is-error { color: #b91c1c; }

  .col {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &.mono { font-family: monospace; font-size: 11px; }
    &.result {
      font-weight: 700;
      &.is-replied { color: #059669; }
      &.is-handler_failed { color: #ef4444; }
      &.is-no_handler { color: #d97706; }
      &.is-ignored { color: $muted; }
    }
    &.status {
      font-family: monospace;
      &.is-4xx { color: #d97706; }
      &.is-5xx { color: #ef4444; font-weight: 700; }
    }
  }

  @media (max-width: 900px) {
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    .col.detail, .col.message { grid-column: 1 / 3; }
  }
}

// error log 版面（列 = time/ch/api/method/status/msg）
.PageAdminLineManagement__diag-row.is-error,
.PageAdminLineManagement__diag-row.is-head + .PageAdminLineManagement__diag-row {
  // 沿用同一 grid；error 表頭結構稍異但用 6 col 對齊
}

.PageAdminLineManagement__diag-expand {
  padding: 10px 18px 14px;
  background: rgba(0, 0, 0, 0.02);
  border-bottom: 1px solid $border;
  display: flex;
  flex-direction: column;
  gap: 4px;

  .row {
    display: flex;
    gap: 12px;
    align-items: baseline;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;

    .k {
      min-width: 100px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: $muted;
    }
    .v {
      flex: 1;
      min-width: 0;
      word-break: break-all;
      color: rgba(0, 0, 0, 0.85);
      &.mono { font-family: monospace; font-size: 11px; }
    }
  }
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
