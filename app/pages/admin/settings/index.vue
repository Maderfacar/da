<script setup lang="ts">
import type { AdminEntry, AdminPermission, AdminUser } from '@/protocol/fetch-api/api/admin';
import { DEFAULT_FARE_RULES } from '~shared/pricing';
import type { DistanceTier, FareRules, PeakWindow, PromoWindow, SurchargeWindow, MountainTier, Weekday, OrderType } from '~shared/pricing';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();

// ── 頂層分頁 ───────────────────────────────────────────────────
type MainTab = 'access' | 'fleet' | 'tags' | 'fare' | 'promotions' | 'legal' | 'integrations' | 'system';
const MAIN_TABS: Array<{ key: MainTab; label: string; superOnly?: boolean }> = [
  { key: 'access',       label: '存取控制' },
  { key: 'fleet',        label: '車型 / 行李 / 加值服務' },
  { key: 'tags',         label: '車輛標籤' },
  { key: 'fare',         label: '車資進階規則', superOnly: true },
  { key: 'promotions',   label: '折扣碼' },
  { key: 'legal',        label: '文件管理' },
  { key: 'integrations', label: 'LINE Bot / 地圖' },
  { key: 'system',       label: '系統' },
];
const mainTab = ref<MainTab>('access');
const visibleMainTabs = computed(() =>
  MAIN_TABS.filter((t) => !t.superOnly || authStore.isSuper),
);

// ── 系統設定（只讀展示）────────────────────────────────────────
// integrationGroups：LINE Bot / 地圖（整合服務分頁）；systemGroups：系統分頁
const integrationGroups = [
  {
    title: 'LINE Bot 設定',
    label: 'LINE BOT',
    rows: [
      { key: 'line_channel_id',     label: 'Channel ID',     value: '2007****',       hint: 'LINE Developers Console 取得' },
      { key: 'line_access_token',   label: 'Access Token',   value: '••••••••••••',   hint: '長效存取憑證，每次更新需重新部署' },
      { key: 'line_channel_secret', label: 'Channel Secret', value: '••••••••••••',   hint: '驗證 Webhook 簽章用' },
      { key: 'line_webhook_url',    label: 'Webhook URL',    value: 'https://cc-da.vercel.app/api/line/webhook', hint: '填入 LINE Developers Console' },
    ],
  },
  {
    title: '地圖服務',
    label: 'MAPS',
    rows: [
      { key: 'gmap_browser_key', label: 'Browser Key', value: 'AIza••••••••', hint: '前端地圖顯示與路線規劃' },
      { key: 'gmap_server_key',  label: 'Server Key',  value: 'AIza••••••••', hint: '後端 Routes API 呼叫' },
    ],
  },
];
const systemGroups = [
  {
    title: '系統',
    label: 'SYSTEM',
    rows: [
      { key: 'version',          label: '目前版本',     value: '0.3.0',        hint: '自動從 version.ts 讀取' },
      { key: 'internal_api_key', label: 'Internal Key', value: '••••••••••••', hint: 'Server-to-Server 驗證' },
      { key: 'env',              label: '執行環境',     value: 'production',   hint: '依 Vercel 環境變數自動設定' },
    ],
  },
];

// ── 存取控制 Tab ───────────────────────────────────────────────
type AccessTab = 'admin' | 'driver';
const activeTab = ref<AccessTab>('driver');

// ── Fleet 設定 Tab（P23 Stage 5）─────────────────────────────
type FleetTab = 'vehicles' | 'luggage' | 'extras';
const fleetTab = ref<FleetTab>('vehicles');

// admin/settings 是後台即時編輯入口：每次進頁都強制 Reload，避免 user 開著 stale tab 時
// 點到舊 docId 導致 PUT 404（fleet 資料量小、Reload 成本低）。
const storeConfig = StoreConfig();
onMounted(() => {
  if (storeConfig.isLoading) return;
  void storeConfig.Reload();
});

// 管理員清單（P18：改從 admins collection 讀，含 level）
const admins = ref<AdminEntry[]>([]);
const adminsLoading = ref(false);
const newAdminUid = ref('');
const newAdminName = ref('');
const addingAdmin = ref(false);
const changingLevelUid = ref('');

// 司機清單
const pendingDrivers = ref<AdminUser[]>([]);
const approvedDrivers = ref<AdminUser[]>([]);
const driversLoading = ref(false);
const approvingUid = ref('');

// ── 資料載入 ────────────────────────────────────────────────────
const ApiLoadAdmins = async () => {
  adminsLoading.value = true;
  try {
    // P18：改用 GetAdmins 直接讀 admins collection（含 level）
    const res = await $api.GetAdmins();
    if (res.status?.code !== 200) {
      console.error('[admin/settings] load admins failed:', res.status?.message?.zh_tw);
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入管理員失敗', type: 'error' });
      admins.value = [];
      return;
    }
    admins.value = Array.isArray(res.data) ? res.data : [];
  } finally {
    adminsLoading.value = false;
  }
};

const ApiLoadDrivers = async () => {
  driversLoading.value = true;
  try {
    const [pendingRes, approvedRes] = await Promise.all([
      $api.GetAdminUsers({ role: 'driver', approved: false }),
      $api.GetAdminUsers({ role: 'driver', approved: true }),
    ]);
    if (pendingRes.status?.code !== 200 || approvedRes.status?.code !== 200) {
      const msg = pendingRes.status?.message?.zh_tw ?? approvedRes.status?.message?.zh_tw ?? '載入司機失敗';
      console.error('[admin/settings] load drivers failed:', msg);
      ElMessage({ message: msg, type: 'error' });
      pendingDrivers.value = [];
      approvedDrivers.value = [];
      return;
    }
    pendingDrivers.value = Array.isArray(pendingRes.data) ? pendingRes.data : [];
    approvedDrivers.value = Array.isArray(approvedRes.data) ? approvedRes.data : [];
  } finally {
    driversLoading.value = false;
  }
};

watch(activeTab, (tab) => {
  // P18：非 super 不可載入 admin tab（API 會 403），強制切回 driver
  if (tab === 'admin') {
    if (!authStore.isSuper) {
      activeTab.value = 'driver';
      return;
    }
    ApiLoadAdmins();
  } else {
    ApiLoadDrivers();
  }
}, { immediate: true });

// ── 管理員白名單操作（P10：addRole / removeRole 語意） ─────────
const ClickAddAdmin = async () => {
  const uid = newAdminUid.value.trim();
  if (!uid) return;
  addingAdmin.value = true;
  // Firestore users/admins/drivers 文件 key 為「不帶 line: 前綴」的純 LINE userId；
  // 容錯使用者貼上帶 line: 前綴的字串（先前誤補前綴會寫進錯誤的幽靈文件）
  const lineUid = uid.startsWith('line:') ? uid.slice(5) : uid;
  const res = await $api.PatchAdminUser(lineUid, {
    addRole: 'admin',
    approved: true,
    ...(newAdminName.value.trim() ? { displayName: newAdminName.value.trim() } : {}),
  });
  if (res.status?.code === 200) {
    newAdminUid.value = '';
    newAdminName.value = '';
    await ApiLoadAdmins();
  }
  addingAdmin.value = false;
};

const ClickRemoveAdmin = async (uid: string) => {
  const ok = await UseAsk('確定移除此管理員嗎？移除後該帳號將失去管理員身分（保留乘客 / 司機身分）。');
  if (!ok) return;
  const res = await $api.PatchAdminUser(uid, { removeRole: 'admin' });
  if (res.status?.code !== 200) {
    ElMessage({ message: res.status?.message?.zh_tw ?? '移除失敗', type: 'error' });
    return;
  }
  await ApiLoadAdmins();
};

// P18：變更管理員 level（僅 super 可呼叫；target=super 會被 server 擋住）
const ClickChangeLevel = async (uid: string, newLevel: 'admin' | 'assistant') => {
  const label = newLevel === 'admin' ? '管理員' : '助理';
  const ok = await UseAsk(`確定將此管理員 level 設為「${label}」？`);
  if (!ok) return;
  changingLevelUid.value = uid;
  try {
    const res = await $api.PatchAdmin(uid, { level: newLevel });
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '變更失敗', type: 'error' });
      return;
    }
    await ApiLoadAdmins();
  } finally {
    changingLevelUid.value = '';
  }
};

// ── P34：細粒度權限 override ─────────────────────────────────
const PERMISSION_LIST: { key: AdminPermission; label: string; hint: string }[] = [
  { key: 'canManageAdmins',  label: '管理管理員',   hint: '新增 / 撤銷 / 改 level' },
  { key: 'canManageDrivers', label: '管理司機',     hint: '審核 / 撤銷 / 改 category' },
  { key: 'canManageOrders',  label: '管理訂單',     hint: '指派 / 改狀態 / 取消' },
  { key: 'canBroadcast',     label: 'LINE 廣播',     hint: '發送訊息給乘客 / 司機' },
  { key: 'canViewFinance',   label: '檢視金流',     hint: '帳務 / 司機薪資資訊' },
  { key: 'canManageFleet',   label: '管理車隊設定', hint: '車型 / 行李 / 加值服務' },
];

// level 對應 LEVEL_TABLE（與 server require-permission.ts 對齊）
const LEVEL_DEFAULTS: Record<'super' | 'admin' | 'assistant', ReadonlySet<AdminPermission>> = {
  super: new Set(['canManageAdmins', 'canManageDrivers', 'canManageOrders', 'canBroadcast', 'canViewFinance', 'canManageFleet']),
  admin: new Set(['canManageDrivers', 'canManageOrders', 'canBroadcast', 'canViewFinance', 'canManageFleet']),
  assistant: new Set(['canManageOrders', 'canBroadcast']),
};

const expandedAdminUid = ref<string>('');
const savingPermissionsUid = ref<string>('');

const ToggleExpand = (uid: string) => {
  expandedAdminUid.value = expandedAdminUid.value === uid ? '' : uid;
};

// 取「實際生效權限」：override 優先 > LEVEL_TABLE 預設
const GetEffectivePermission = (admin: AdminEntry, perm: AdminPermission): boolean => {
  const override = admin.permissions?.[perm];
  if (typeof override === 'boolean') return override;
  return LEVEL_DEFAULTS[admin.level].has(perm);
};

// checkbox 切換：把該權限寫進 permissions（保留其他 override），跟 level 預設一致時不傳值
const ClickTogglePermission = async (admin: AdminEntry, perm: AdminPermission) => {
  if (admin.level === 'super') return;
  const current = GetEffectivePermission(admin, perm);
  const next = !current;
  // 與 level 預設一致 → 視同清除該 key 的 override
  const matchesDefault = next === LEVEL_DEFAULTS[admin.level].has(perm);
  // 與 default 一致 → 排除該 key（不送 override）；否則寫入 next
  const sourceEntries = Object.entries(admin.permissions ?? {}) as [AdminPermission, boolean][];
  const filtered = sourceEntries.filter(([k]) => k !== perm);
  const nextPermissions: Partial<Record<AdminPermission, boolean>> = Object.fromEntries(filtered);
  if (!matchesDefault) nextPermissions[perm] = next;
  const finalBody = Object.keys(nextPermissions).length === 0 ? null : nextPermissions;
  savingPermissionsUid.value = admin.uid;
  try {
    const res = await $api.PatchAdmin(admin.uid, { permissions: finalBody });
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '權限更新失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已更新', type: 'success' });
    await ApiLoadAdmins();
  } finally {
    savingPermissionsUid.value = '';
  }
};

// 重置 override（清空 permissions 走 LEVEL_TABLE）
const ClickResetPermissions = async (admin: AdminEntry) => {
  if (!admin.permissions || Object.keys(admin.permissions).length === 0) return;
  const ok = await UseAsk('確定清除此管理員的所有細粒度權限 override？清除後將完全依 level 預設權限運作。');
  if (!ok) return;
  savingPermissionsUid.value = admin.uid;
  try {
    const res = await $api.PatchAdmin(admin.uid, { permissions: null });
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '清除失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '已重置為 level 預設', type: 'success' });
    await ApiLoadAdmins();
  } finally {
    savingPermissionsUid.value = '';
  }
};

// ── 司機審核操作 ─────────────────────────────────────────────────
const ClickApproveDriver = async (uid: string) => {
  approvingUid.value = uid;
  await $api.PatchAdminUser(uid, { approved: true });
  await ApiLoadDrivers();
  approvingUid.value = '';
};

const ClickRejectDriver = async (uid: string) => {
  const ok = await UseAsk('確定拒絕此司機申請？拒絕後該帳號將失去司機身分（保留乘客身分）。');
  if (!ok) return;
  approvingUid.value = uid;
  await $api.PatchAdminUser(uid, { removeRole: 'driver' });
  await ApiLoadDrivers();
  approvingUid.value = '';
};

const ClickRevokeDriver = async (uid: string) => {
  const ok = await UseAsk('確定停用此司機帳號？停用後該帳號將無法進入司機端（保留 driver role 但 approved=false）。');
  if (!ok) return;
  await $api.PatchAdminUser(uid, { approved: false });
  await ApiLoadDrivers();
};

// ── 車資進階規則 v1（Fare V2，僅 super 可見 / 編輯）─────────────
const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: 'MON', label: '一' },
  { value: 'TUE', label: '二' },
  { value: 'WED', label: '三' },
  { value: 'THU', label: '四' },
  { value: 'FRI', label: '五' },
  { value: 'SAT', label: '六' },
  { value: 'SUN', label: '日' },
];

const WEEKEND_MODE_OPTIONS: { value: FareRules['trafficJam']['weekendMode']; label: string }[] = [
  { value: 'OFF', label: 'OFF（週末不收）' },
  { value: 'ALL_DAY', label: '全天' },
  { value: 'EVENING_ONLY', label: '僅 17-21 時' },
];

const ORDER_TYPE_OPTIONS: { value: OrderType; label: string }[] = [
  { value: 'airport-pickup', label: '接機' },
  { value: 'airport-dropoff', label: '送機' },
  { value: 'charter', label: '包車' },
  { value: 'transfer', label: '交通接送' },
];

// 深拷貝預設值作為初始草稿（避免改到 DEFAULT_FARE_RULES 常數）
const _cloneRules = (r: FareRules): FareRules => JSON.parse(JSON.stringify(r));

const fareRules = ref<FareRules>(_cloneRules(DEFAULT_FARE_RULES));
const fareRulesLoading = ref(false);
const fareRulesSaving = ref(false);
const fareRulesError = ref('');
const fareRulesIsDefault = ref(true);
const fareRulesUpdatedBy = ref<string | null>(null);
const fareRulesUpdatedAt = ref<string | null>(null);

const ApiLoadFareRules = async () => {
  if (!authStore.isSuper) return;
  fareRulesLoading.value = true;
  fareRulesError.value = '';
  try {
    const res = await $api.GetAdminFareRules();
    if (res.status?.code !== 200) {
      fareRulesError.value = res.status?.message?.zh_tw ?? '載入車資規則失敗';
      return;
    }
    fareRules.value = _cloneRules(res.data.rules);
    fareRulesIsDefault.value = res.data.isDefault;
    fareRulesUpdatedBy.value = res.data.updatedBy;
    fareRulesUpdatedAt.value = res.data.updatedAt;
  } finally {
    fareRulesLoading.value = false;
  }
};

onMounted(() => {
  void ApiLoadFareRules();
});

// 里程分段累進折扣：新段預設「上一段 fromKm + 10、折扣 +5%」
const ClickAddDistanceTier = () => {
  const tiers = fareRules.value.distanceTier.tiers;
  const last = tiers[tiers.length - 1];
  const nextFromKm = last ? last.fromKm + 10 : 0;
  const nextDiscountPct = last ? Math.min(100, last.discountPct + 5) : 0;
  tiers.push({ fromKm: nextFromKm, discountPct: nextDiscountPct } as DistanceTier);
};
const ClickRemoveDistanceTier = (index: number) => {
  // 第一段不可刪（fromKm 必為 0）
  if (index === 0) return;
  fareRules.value.distanceTier.tiers.splice(index, 1);
};

// 階梯 / 時段陣列操作
const ClickAddMountainTier = () => {
  fareRules.value.mountain.tiers.push({ minScore: 1, multiplier: 1.1 } as MountainTier);
};
const ClickRemoveMountainTier = (index: number) => {
  fareRules.value.mountain.tiers.splice(index, 1);
};

const ClickAddPeakWindow = () => {
  fareRules.value.trafficJam.peakWindows.push({
    days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    start: '07:00',
    end: '09:30',
  } as PeakWindow);
};
const ClickRemovePeakWindow = (index: number) => {
  fareRules.value.trafficJam.peakWindows.splice(index, 1);
};

const TogglePeakWindowDay = (windowIndex: number, day: Weekday) => {
  const w = fareRules.value.trafficJam.peakWindows[windowIndex];
  if (!w) return;
  w.days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
};

const ClickAddPromoWindow = () => {
  fareRules.value.promo.windows.push({
    days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    start: '13:00',
    end: '16:00',
  } as PromoWindow);
};
const ClickRemovePromoWindow = (index: number) => {
  fareRules.value.promo.windows.splice(index, 1);
};

const TogglePromoWindowDay = (windowIndex: number, day: Weekday) => {
  const w = fareRules.value.promo.windows[windowIndex];
  if (!w) return;
  w.days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
};

const ClickAddSurchargeWindow = () => {
  fareRules.value.surcharge.windows.push({
    days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    start: '23:00',
    end: '23:59',
  } as SurchargeWindow);
};
const ClickRemoveSurchargeWindow = (index: number) => {
  fareRules.value.surcharge.windows.splice(index, 1);
};

const ToggleSurchargeWindowDay = (windowIndex: number, day: Weekday) => {
  const w = fareRules.value.surcharge.windows[windowIndex];
  if (!w) return;
  w.days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
};

// 時段的行程過濾切換（三個規則共用；不選任何行程 = 套用全部行程）
const _toggleWindowOrderType = (
  w: PeakWindow | PromoWindow | SurchargeWindow | undefined,
  ot: OrderType,
) => {
  if (!w) return;
  const cur = w.orderTypes ?? [];
  w.orderTypes = cur.includes(ot) ? cur.filter((o) => o !== ot) : [...cur, ot];
};
const TogglePeakWindowOrderType = (i: number, ot: OrderType) =>
  _toggleWindowOrderType(fareRules.value.trafficJam.peakWindows[i], ot);
const TogglePromoWindowOrderType = (i: number, ot: OrderType) =>
  _toggleWindowOrderType(fareRules.value.promo.windows[i], ot);
const ToggleSurchargeWindowOrderType = (i: number, ot: OrderType) =>
  _toggleWindowOrderType(fareRules.value.surcharge.windows[i], ot);

// 儲存前基本前端檢查（嚴格驗證交給伺服器 validateFareRules）
const _validateFareRules = (): string => {
  const r = fareRules.value;
  const nums: number[] = [
    r.rounding,
    r.mountain.thresholdElevationDiffM,
    r.mountain.thresholdSinuosity,
    r.mountain.thresholdFreeFlowKmh,
    ...r.mountain.tiers.flatMap((t) => [t.minScore, t.multiplier]),
    ...r.crossCounty.tieredNtd,
    r.trafficJam.defaultNtdPerMinute,
    r.freeway.freeKm,
    r.freeway.ntdPerKm,
    r.freeway.dailyCapKm,
    r.freeway.dailyCapDiscountPct,
    r.promo.defaultDiscountNtd,
    r.surcharge.defaultSurchargeNtd,
  ];
  if (nums.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
    return '所有數字欄位皆必填且需為有效數字';
  }
  if (r.rounding <= 0) return '進位基數必須大於 0';
  if (r.crossCounty.tieredNtd.length !== 3) return '跨縣市需設定三級費率';
  // 里程分段折扣：tiers 非空、首段 fromKm=0、嚴格遞增、pct 0–100
  const dt = r.distanceTier;
  if (dt.tiers.length === 0) return '里程分段需至少 1 段';
  for (const t of dt.tiers) {
    if (typeof t.fromKm !== 'number' || Number.isNaN(t.fromKm) || t.fromKm < 0) {
      return '里程分段的 fromKm 必須 ≥ 0';
    }
    if (typeof t.discountPct !== 'number' || Number.isNaN(t.discountPct) || t.discountPct < 0 || t.discountPct > 100) {
      return '里程分段的折扣 % 必須在 0–100 之間';
    }
  }
  const sortedDt = [...dt.tiers].sort((a, b) => a.fromKm - b.fromKm);
  if (sortedDt[0]!.fromKm !== 0) return '里程分段第一段的起始里程必須為 0';
  for (let i = 1; i < sortedDt.length; i++) {
    if (sortedDt[i]!.fromKm <= sortedDt[i - 1]!.fromKm) {
      return '里程分段的起始里程必須由小到大且不重覆';
    }
  }
  for (const w of r.trafficJam.peakWindows) {
    if (!w.start || !w.end) return '顛峰時段的起訖時間皆必填';
    if (w.days.length === 0) return '每個顛峰時段至少需選一天';
  }
  for (const w of r.promo.windows) {
    if (!w.start || !w.end) return '優惠時段的起訖時間皆必填';
    if (w.days.length === 0) return '每個優惠時段至少需選一天';
  }
  for (const w of r.surcharge.windows) {
    if (!w.start || !w.end) return '加價時段的起訖時間皆必填';
    if (w.days.length === 0) return '每個加價時段至少需選一天';
  }
  return '';
};

const ClickSaveFareRules = async () => {
  const err = _validateFareRules();
  if (err) {
    fareRulesError.value = err;
    return;
  }
  fareRulesError.value = '';
  fareRulesSaving.value = true;
  try {
    const res = await $api.PatchAdminFareRules(fareRules.value);
    if (res.status?.code !== 200) {
      fareRulesError.value = res.status?.message?.zh_tw ?? '儲存車資規則失敗';
      ElMessage({ message: fareRulesError.value, type: 'error' });
      return;
    }
    fareRules.value = _cloneRules(res.data.rules);
    fareRulesIsDefault.value = res.data.isDefault;
    fareRulesUpdatedBy.value = res.data.updatedBy;
    fareRulesUpdatedAt.value = res.data.updatedAt;
    ElMessage({ message: '車資進階規則已儲存', type: 'success' });
  } finally {
    fareRulesSaving.value = false;
  }
};
</script>

<template lang="pug">
.PageAdminSettings
  .PageAdminSettings__header
    .PageAdminSettings__header-label SYSTEM SETTINGS
    h1.PageAdminSettings__header-title 系統設定

  //- 頂層分頁
  .PageAdminSettings__main-tabs
    button.PageAdminSettings__main-tab(
      v-for="t in visibleMainTabs"
      :key="t.key"
      :class="{ 'is-active': mainTab === t.key }"
      @click="mainTab = t.key"
    ) {{ t.label }}

  //- 存取控制
  .PageAdminSettings__section(v-show="mainTab === 'access'")
    .PageAdminSettings__section-head
      span.PageAdminSettings__section-label ACCESS
      span.PageAdminSettings__section-title 存取控制

    //- Tab
    .PageAdminSettings__tabs
      button.PageAdminSettings__tab(
        :class="{ 'is-active': activeTab === 'driver' }"
        @click="activeTab = 'driver'"
      ) 司機審核
      //- P18：管理員白名單 tab 僅 super 可見
      button.PageAdminSettings__tab(
        v-if="authStore.isSuper"
        :class="{ 'is-active': activeTab === 'admin' }"
        @click="activeTab = 'admin'"
      ) 管理員白名單

    //- 司機審核
    template(v-if="activeTab === 'driver'")
      .PageAdminSettings__loading(v-if="driversLoading") 載入中...

      template(v-else)
        //- 待審核
        .PageAdminSettings__sub-title(v-if="pendingDrivers.length > 0") 待審核（{{ pendingDrivers.length }}）
        .PageAdminSettings__user-list(v-if="pendingDrivers.length > 0")
          .PageAdminSettings__user-row(v-for="u in pendingDrivers" :key="u.uid")
            img.PageAdminSettings__avatar(:src="u.pictureUrl || '/img/avatar-default.png'" :alt="u.displayName")
            .PageAdminSettings__user-info
              .PageAdminSettings__user-name {{ u.displayName || '未知使用者' }}
              .PageAdminSettings__user-uid {{ u.uid }}
            .PageAdminSettings__user-actions
              button.PageAdminSettings__btn.is-approve(
                :disabled="approvingUid === u.uid"
                @click="ClickApproveDriver(u.uid)"
              ) 核准
              button.PageAdminSettings__btn.is-reject(
                :disabled="approvingUid === u.uid"
                @click="ClickRejectDriver(u.uid)"
              ) 拒絕

        .PageAdminSettings__empty(v-if="pendingDrivers.length === 0")
          span 目前無待審核司機

        //- 已核准
        .PageAdminSettings__sub-title(v-if="approvedDrivers.length > 0" style="margin-top:20px") 已核准司機（{{ approvedDrivers.length }}）
        .PageAdminSettings__user-list(v-if="approvedDrivers.length > 0")
          .PageAdminSettings__user-row(v-for="u in approvedDrivers" :key="u.uid")
            img.PageAdminSettings__avatar(:src="u.pictureUrl || '/img/avatar-default.png'" :alt="u.displayName")
            .PageAdminSettings__user-info
              .PageAdminSettings__user-name {{ u.displayName || '未知使用者' }}
              .PageAdminSettings__user-uid {{ u.uid }}
            .PageAdminSettings__user-actions
              button.PageAdminSettings__btn.is-reject(
                :disabled="approvingUid === u.uid"
                @click="ClickRevokeDriver(u.uid)"
              ) 停用

    //- 管理員白名單（P18：僅 super 可見）
    template(v-if="activeTab === 'admin' && authStore.isSuper")
      .PageAdminSettings__notice.is-info
        span ℹ️
        span 管理員分三層：SUPER（最高管理員，僅可由 Firebase Console 設定）、ADMIN（管理員）、ASSISTANT（助理）。新增者預設為 ADMIN。

      //- 新增管理員
      .PageAdminSettings__add-row
        input.PageAdminSettings__add-input(
          v-model="newAdminUid"
          placeholder="LINE User ID（Uxxxxxxxx）"
          maxlength="100"
        )
        input.PageAdminSettings__add-input(
          v-model="newAdminName"
          placeholder="顯示名稱（選填）"
          maxlength="40"
        )
        button.PageAdminSettings__btn.is-approve(
          :disabled="!newAdminUid.trim() || addingAdmin"
          @click="ClickAddAdmin"
        ) {{ addingAdmin ? '新增中...' : '新增管理員' }}

      .PageAdminSettings__loading(v-if="adminsLoading") 載入中...

      template(v-else)
        .PageAdminSettings__user-list(v-if="admins.length > 0")
          template(v-for="u in admins" :key="u.uid")
            .PageAdminSettings__user-row
              img.PageAdminSettings__avatar(:src="u.pictureUrl || '/img/avatar-default.png'" :alt="u.displayName")
              .PageAdminSettings__user-info
                .PageAdminSettings__user-name
                  | {{ u.displayName || '未知使用者' }}
                  span.PageAdminSettings__level-badge(:class="`is-${u.level}`") {{ u.level.toUpperCase() }}
                  //- P34：有 override 顯示徽章
                  span.PageAdminSettings__perm-badge(
                    v-if="u.permissions && Object.keys(u.permissions).length > 0"
                    title="已設定細粒度權限 override"
                  ) +{{ Object.keys(u.permissions).length }}
                .PageAdminSettings__user-uid {{ u.uid }}
              .PageAdminSettings__user-actions
                //- super 不可被改 level / permissions 也不可被撤銷
                template(v-if="u.level !== 'super'")
                  button.PageAdminSettings__btn.is-toggle(
                    v-if="u.level !== 'admin'"
                    :disabled="changingLevelUid === u.uid"
                    @click="ClickChangeLevel(u.uid, 'admin')"
                  ) 設為管理員
                  button.PageAdminSettings__btn.is-toggle(
                    v-if="u.level !== 'assistant'"
                    :disabled="changingLevelUid === u.uid"
                    @click="ClickChangeLevel(u.uid, 'assistant')"
                  ) 設為助理
                  button.PageAdminSettings__btn.is-toggle(
                    :class="{ 'is-expanded': expandedAdminUid === u.uid }"
                    @click="ToggleExpand(u.uid)"
                  ) {{ expandedAdminUid === u.uid ? '收起權限' : '進階權限' }}
                  button.PageAdminSettings__btn.is-reject(@click="ClickRemoveAdmin(u.uid)") 撤銷

            //- P34：細粒度權限展開區（每 admin row 單獨展開）
            .PageAdminSettings__perm-panel(v-if="expandedAdminUid === u.uid && u.level !== 'super'")
              .PageAdminSettings__perm-head
                span.PageAdminSettings__perm-head-label 細粒度權限 OVERRIDE
                span.PageAdminSettings__perm-head-hint 與 LEVEL 預設不同時自動寫入 override；勾選後立即儲存
                button.PageAdminSettings__btn.is-toggle.is-mini(
                  v-if="u.permissions && Object.keys(u.permissions).length > 0"
                  :disabled="savingPermissionsUid === u.uid"
                  @click="ClickResetPermissions(u)"
                ) 重置為 LEVEL 預設

              .PageAdminSettings__perm-grid
                .PageAdminSettings__perm-item(
                  v-for="p in PERMISSION_LIST"
                  :key="p.key"
                  :class="{ 'is-override': u.permissions && p.key in u.permissions }"
                )
                  label.PageAdminSettings__perm-label
                    input(
                      type="checkbox"
                      :checked="GetEffectivePermission(u, p.key)"
                      :disabled="savingPermissionsUid === u.uid"
                      @change="ClickTogglePermission(u, p.key)"
                    )
                    span.PageAdminSettings__perm-name {{ p.label }}
                    span.PageAdminSettings__perm-hint {{ p.hint }}

        .PageAdminSettings__empty(v-if="admins.length === 0")
          span 目前無管理員資料（請至 Firebase Console 設定首位管理員）

  //- Fleet 設定（P23 Stage 5）
  .PageAdminSettings__section(v-show="mainTab === 'fleet'")
    .PageAdminSettings__section-head
      span.PageAdminSettings__section-label FLEET
      span.PageAdminSettings__section-title 車型 / 行李 / 加值服務

    //- Fleet sub-tab
    .PageAdminSettings__tabs
      button.PageAdminSettings__tab(
        :class="{ 'is-active': fleetTab === 'vehicles' }"
        @click="fleetTab = 'vehicles'"
      ) 車型
      button.PageAdminSettings__tab(
        :class="{ 'is-active': fleetTab === 'luggage' }"
        @click="fleetTab = 'luggage'"
      ) 行李類型
      button.PageAdminSettings__tab(
        :class="{ 'is-active': fleetTab === 'extras' }"
        @click="fleetTab = 'extras'"
      ) 加值服務

    .PageAdminSettings__loading(v-if="storeConfig.isLoading && !storeConfig.isLoaded") 載入中...

    template(v-else)
      AdminSettingsFleetVehicles(v-if="fleetTab === 'vehicles'")
      AdminSettingsFleetLuggageTypes(v-if="fleetTab === 'luggage'")
      AdminSettingsFleetExtras(v-if="fleetTab === 'extras'")

  //- 車輛 / 司機標籤管理（Phase 1A）
  .PageAdminSettings__section(v-show="mainTab === 'tags'")
    .PageAdminSettings__section-head
      span.PageAdminSettings__section-label TAGS
      span.PageAdminSettings__section-title 車輛標籤
    AdminSettingsTags

  //- 車資進階規則 v1（Fare V2，僅 super 可見）
  .PageAdminSettings__section(v-show="authStore.isSuper && mainTab === 'fare'")
    .PageAdminSettings__section-head
      span.PageAdminSettings__section-label FARE RULES
      span.PageAdminSettings__section-title 車資進階規則
      span.PageAdminSettings__fare-flex
      button.PageAdminSettings__btn.is-approve.PageAdminSettings__fare-save(
        :disabled="fareRulesLoading || fareRulesSaving"
        @click="ClickSaveFareRules"
      ) {{ fareRulesSaving ? '儲存中...' : '💾 儲存' }}

    .PageAdminSettings__loading(v-if="fareRulesLoading") 載入中...

    template(v-else)
      .PageAdminSettings__fare-meta
        span(v-if="fareRulesIsDefault") 目前顯示為系統預設值（尚未儲存過）
        span(v-else) 最後更新：{{ fareRulesUpdatedBy || '未知' }}
          template(v-if="fareRulesUpdatedAt")  · {{ fareRulesUpdatedAt }}

      //- 基本
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 基本
        .PageAdminSettings__fare-grid
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 進位至（元）
            ElInput(
              v-model.number="fareRules.rounding"
              type="number"
              inputmode="numeric"
            )

      //- 里程分段累進折扣（全車型一致；折扣套在 distanceFee 上）
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 里程分段折扣
          label.PageAdminSettings__fare-switch-label
            input(type="checkbox" v-model="fareRules.distanceTier.enabled")
            span 啟用
        .PageAdminSettings__fare-subhead
          | 距離切段、每段套各自費率（perKmRate × (1 − 折扣%/100)）。第一段起始里程必為 0；折扣 0 = 原價、10 = 9 折。
        .PageAdminSettings__fare-tier(
          v-for="(tier, i) in fareRules.distanceTier.tiers"
          :key="i"
        )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 起始里程 (km)
            ElInput(
              v-model.number="tier.fromKm"
              type="number"
              inputmode="numeric"
              :disabled="i === 0"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 折扣 (%)
            ElInput(
              v-model.number="tier.discountPct"
              type="number"
              inputmode="numeric"
            )
          button.PageAdminSettings__btn.is-reject.PageAdminSettings__fare-row-del(
            :disabled="i === 0"
            @click="ClickRemoveDistanceTier(i)"
          ) 刪除
        button.PageAdminSettings__btn.is-toggle.PageAdminSettings__fare-add(
          @click="ClickAddDistanceTier"
        ) + 新增分段

      //- 山區加成
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 山區加成
          label.PageAdminSettings__fare-switch-label
            input(type="checkbox" v-model="fareRules.mountain.enabled")
            span 啟用
        .PageAdminSettings__fare-grid
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 海拔起伏門檻 (m)
            ElInput(
              v-model.number="fareRules.mountain.thresholdElevationDiffM"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 曲折度門檻
            ElInput(
              v-model.number="fareRules.mountain.thresholdSinuosity"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 無塞車時速門檻 (km/h)
            ElInput(
              v-model.number="fareRules.mountain.thresholdFreeFlowKmh"
              type="number"
              inputmode="numeric"
            )
        .PageAdminSettings__fare-subhead 加成階梯（達分數即套用係數）
        .PageAdminSettings__fare-tier(
          v-for="(tier, i) in fareRules.mountain.tiers"
          :key="i"
        )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 達分數
            ElInput(
              v-model.number="tier.minScore"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 係數
            ElInput(
              v-model.number="tier.multiplier"
              type="number"
              inputmode="numeric"
            )
          button.PageAdminSettings__btn.is-reject.PageAdminSettings__fare-row-del(
            @click="ClickRemoveMountainTier(i)"
          ) 刪除
        button.PageAdminSettings__btn.is-toggle.PageAdminSettings__fare-add(
          @click="ClickAddMountainTier"
        ) + 新增階梯

      //- 跨縣市補貼
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 跨縣市補貼
          label.PageAdminSettings__fare-switch-label
            input(type="checkbox" v-model="fareRules.crossCounty.enabled")
            span 啟用
        .PageAdminSettings__fare-grid
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 第 1 跨（元）
            ElInput(
              v-model.number="fareRules.crossCounty.tieredNtd[0]"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 第 2 跨（元）
            ElInput(
              v-model.number="fareRules.crossCounty.tieredNtd[1]"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 第 3+ 跨（元）
            ElInput(
              v-model.number="fareRules.crossCounty.tieredNtd[2]"
              type="number"
              inputmode="numeric"
            )
        label.PageAdminSettings__fare-switch-label.PageAdminSettings__fare-inline-check
          input(type="checkbox" v-model="fareRules.crossCounty.excludeTpeNtpeTyn")
          span 北北桃跨界不收

      //- 顛峰塞車費
      //- 時段加價
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 時段加價
          label.PageAdminSettings__fare-switch-label
            input(type="checkbox" v-model="fareRules.surcharge.enabled")
            span 啟用
        .PageAdminSettings__fare-subhead 加價時段
        .PageAdminSettings__fare-window(
          v-for="(win, i) in fareRules.surcharge.windows"
          :key="i"
        )
          .PageAdminSettings__fare-window-days
            button.PageAdminSettings__fare-day(
              v-for="d in WEEKDAY_OPTIONS"
              :key="d.value"
              type="button"
              :class="{ 'is-on': win.days.includes(d.value) }"
              @click="ToggleSurchargeWindowDay(i, d.value)"
            ) {{ d.label }}
          .PageAdminSettings__fare-window-hint 行程過濾（不選＝套用全部行程）
          .PageAdminSettings__fare-window-orders
            button.PageAdminSettings__fare-order(
              v-for="ot in ORDER_TYPE_OPTIONS"
              :key="ot.value"
              type="button"
              :class="{ 'is-on': (win.orderTypes ?? []).includes(ot.value) }"
              @click="ToggleSurchargeWindowOrderType(i, ot.value)"
            ) {{ ot.label }}
          .PageAdminSettings__fare-window-times
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 起
              ElInput(v-model="win.start" type="time")
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 訖
              ElInput(v-model="win.end" type="time")
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 加價 (元，留空用 default)
              ElInput(
                v-model.number="win.surchargeNtd"
                type="number"
                inputmode="numeric"
              )
            button.PageAdminSettings__btn.is-reject.PageAdminSettings__fare-row-del(
              @click="ClickRemoveSurchargeWindow(i)"
            ) 刪除
        button.PageAdminSettings__btn.is-toggle.PageAdminSettings__fare-add(
          @click="ClickAddSurchargeWindow"
        ) + 新增時段
        .PageAdminSettings__fare-grid
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 週末模式
            ElSelect(v-model="fareRules.surcharge.weekendMode")
              ElOption(
                v-for="m in WEEKEND_MODE_OPTIONS"
                :key="m.value"
                :label="m.label"
                :value="m.value"
              )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label default 加價 (元)
            ElInput(
              v-model.number="fareRules.surcharge.defaultSurchargeNtd"
              type="number"
              inputmode="numeric"
            )

      //- 優惠時段
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 優惠時段
          label.PageAdminSettings__fare-switch-label
            input(type="checkbox" v-model="fareRules.promo.enabled")
            span 啟用
        .PageAdminSettings__fare-subhead 優惠時段
        .PageAdminSettings__fare-window(
          v-for="(win, i) in fareRules.promo.windows"
          :key="i"
        )
          .PageAdminSettings__fare-window-days
            button.PageAdminSettings__fare-day(
              v-for="d in WEEKDAY_OPTIONS"
              :key="d.value"
              type="button"
              :class="{ 'is-on': win.days.includes(d.value) }"
              @click="TogglePromoWindowDay(i, d.value)"
            ) {{ d.label }}
          .PageAdminSettings__fare-window-hint 行程過濾（不選＝套用全部行程）
          .PageAdminSettings__fare-window-orders
            button.PageAdminSettings__fare-order(
              v-for="ot in ORDER_TYPE_OPTIONS"
              :key="ot.value"
              type="button"
              :class="{ 'is-on': (win.orderTypes ?? []).includes(ot.value) }"
              @click="TogglePromoWindowOrderType(i, ot.value)"
            ) {{ ot.label }}
          .PageAdminSettings__fare-window-times
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 起
              ElInput(v-model="win.start" type="time")
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 訖
              ElInput(v-model="win.end" type="time")
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 折扣 (元，留空用 default)
              ElInput(
                v-model.number="win.discountNtd"
                type="number"
                inputmode="numeric"
              )
            button.PageAdminSettings__btn.is-reject.PageAdminSettings__fare-row-del(
              @click="ClickRemovePromoWindow(i)"
            ) 刪除
        button.PageAdminSettings__btn.is-toggle.PageAdminSettings__fare-add(
          @click="ClickAddPromoWindow"
        ) + 新增時段
        .PageAdminSettings__fare-grid
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 週末模式
            ElSelect(v-model="fareRules.promo.weekendMode")
              ElOption(
                v-for="m in WEEKEND_MODE_OPTIONS"
                :key="m.value"
                :label="m.label"
                :value="m.value"
              )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label default 折扣 (元)
            ElInput(
              v-model.number="fareRules.promo.defaultDiscountNtd"
              type="number"
              inputmode="numeric"
            )

      //- 顛峰塞車費
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 顛峰塞車費
          label.PageAdminSettings__fare-switch-label
            input(type="checkbox" v-model="fareRules.trafficJam.enabled")
            span 啟用
        .PageAdminSettings__fare-subhead 顛峰時段
        .PageAdminSettings__fare-window(
          v-for="(win, i) in fareRules.trafficJam.peakWindows"
          :key="i"
        )
          .PageAdminSettings__fare-window-days
            button.PageAdminSettings__fare-day(
              v-for="d in WEEKDAY_OPTIONS"
              :key="d.value"
              type="button"
              :class="{ 'is-on': win.days.includes(d.value) }"
              @click="TogglePeakWindowDay(i, d.value)"
            ) {{ d.label }}
          .PageAdminSettings__fare-window-hint 行程過濾（不選＝套用全部行程）
          .PageAdminSettings__fare-window-orders
            button.PageAdminSettings__fare-order(
              v-for="ot in ORDER_TYPE_OPTIONS"
              :key="ot.value"
              type="button"
              :class="{ 'is-on': (win.orderTypes ?? []).includes(ot.value) }"
              @click="TogglePeakWindowOrderType(i, ot.value)"
            ) {{ ot.label }}
          .PageAdminSettings__fare-window-times
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 起
              ElInput(v-model="win.start" type="time")
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 訖
              ElInput(v-model="win.end" type="time")
            .PageAdminSettings__fare-field
              label.PageAdminSettings__fare-label 費率 (元/min，留空用 default)
              ElInput(
                v-model.number="win.ntdPerMinute"
                type="number"
                inputmode="numeric"
              )
            button.PageAdminSettings__btn.is-reject.PageAdminSettings__fare-row-del(
              @click="ClickRemovePeakWindow(i)"
            ) 刪除
        button.PageAdminSettings__btn.is-toggle.PageAdminSettings__fare-add(
          @click="ClickAddPeakWindow"
        ) + 新增時段
        .PageAdminSettings__fare-grid
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 週末模式
            ElSelect(v-model="fareRules.trafficJam.weekendMode")
              ElOption(
                v-for="m in WEEKEND_MODE_OPTIONS"
                :key="m.value"
                :label="m.label"
                :value="m.value"
              )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label default 費率 (元/min)
            ElInput(
              v-model.number="fareRules.trafficJam.defaultNtdPerMinute"
              type="number"
              inputmode="numeric"
            )

      //- 國道通行費
      .PageAdminSettings__fare-block
        .PageAdminSettings__fare-block-head
          span.PageAdminSettings__fare-block-title 國道通行費
          label.PageAdminSettings__fare-switch-label
            input(type="checkbox" v-model="fareRules.freeway.enabled")
            span 啟用
        .PageAdminSettings__fare-grid
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 首段免費里程 (km)
            ElInput(
              v-model.number="fareRules.freeway.freeKm"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 每公里費率 (元/km)
            ElInput(
              v-model.number="fareRules.freeway.ntdPerKm"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 日上限里程 (km)
            ElInput(
              v-model.number="fareRules.freeway.dailyCapKm"
              type="number"
              inputmode="numeric"
            )
          .PageAdminSettings__fare-field
            label.PageAdminSettings__fare-label 上限後折扣 (%)
            ElInput(
              v-model.number="fareRules.freeway.dailyCapDiscountPct"
              type="number"
              inputmode="numeric"
            )

      .PageAdminSettings__fare-error(v-if="fareRulesError") ⚠️ {{ fareRulesError }}

      //- 試算機
      AdminFareCalculatorPreview(:rules="fareRules")

  //- 折扣碼管理
  .PageAdminSettings__section(v-show="mainTab === 'promotions'")
    .PageAdminSettings__section-head
      span.PageAdminSettings__section-label PROMOTIONS
      span.PageAdminSettings__section-title 折扣碼
    .PageAdminSettings__promotions
      AdminSettingsDiscountCodes

  //- 法律文件管理（會員條款 / 隱私政策）
  .PageAdminSettings__section(v-show="mainTab === 'legal'")
    .PageAdminSettings__section-head
      span.PageAdminSettings__section-label LEGAL DOCUMENTS
      span.PageAdminSettings__section-title 文件管理（會員條款 / 隱私政策）
    AdminSettingsLegalDocuments

  //- 整合服務（LINE Bot / 地圖，只讀）
  template(v-if="mainTab === 'integrations'")
    .PageAdminSettings__groups
      .PageAdminSettings__group(v-for="g in integrationGroups" :key="g.title")
        .PageAdminSettings__group-head
          span.PageAdminSettings__group-label {{ g.label }}
          span.PageAdminSettings__group-title {{ g.title }}

        .PageAdminSettings__rows
          .PageAdminSettings__row(v-for="r in g.rows" :key="r.key")
            .PageAdminSettings__row-info
              .PageAdminSettings__row-key {{ r.label }}
              .PageAdminSettings__row-hint {{ r.hint }}
            .PageAdminSettings__row-val {{ r.value }}

  //- 系統設定（只讀）
  template(v-if="mainTab === 'system'")
    .PageAdminSettings__notice
      span ⚠️
      span 敏感設定（Token、Key）僅顯示遮罩，如需修改請透過 Vercel 環境變數管理。

    .PageAdminSettings__groups
      .PageAdminSettings__group(v-for="g in systemGroups" :key="g.title")
        .PageAdminSettings__group-head
          span.PageAdminSettings__group-label {{ g.label }}
          span.PageAdminSettings__group-title {{ g.title }}

        .PageAdminSettings__rows
          .PageAdminSettings__row(v-for="r in g.rows" :key="r.key")
            .PageAdminSettings__row-info
              .PageAdminSettings__row-key {{ r.label }}
              .PageAdminSettings__row-hint {{ r.hint }}
            .PageAdminSettings__row-val {{ r.value }}
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.35);

.PageAdminSettings {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageAdminSettings__header {
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

// ── 頂層分頁 ────────────────────────────────────────────────────
.PageAdminSettings__main-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}

.PageAdminSettings__main-tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 16px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: $muted;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { color: rgba(255, 255, 255, 0.7); }

  &.is-active {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.12);
    color: $amber;
  }
}

// ── 存取控制區塊 ────────────────────────────────────────────────
.PageAdminSettings__section {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 24px;

  &-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid $border;
    background: rgba(255, 255, 255, 0.02);
  }

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: $amber;
    background: rgba($amber, 0.1);
    border: 1px solid rgba($amber, 0.25);
    border-radius: 100px;
    padding: 2px 8px;
  }

  &-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
  }
}

// ── Tab ─────────────────────────────────────────────────────────
.PageAdminSettings__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  padding: 12px 16px 0;
  border-bottom: 1px solid $border;
}

.PageAdminSettings__tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 8px 20px;
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

@media (max-width: 479.98px) {
  .PageAdminSettings__tab { padding: 8px 12px; }
}

// ── 使用者清單 ────────────────────────────────────────────────────
.PageAdminSettings__sub-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: $muted;
  padding: 12px 16px 4px;
}

.PageAdminSettings__user-list {
  display: flex;
  flex-direction: column;
}

.PageAdminSettings__user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  &:last-child { border-bottom: none; }
}

.PageAdminSettings__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
}

.PageAdminSettings__user-info {
  flex: 1;
  min-width: 0;
}

.PageAdminSettings__user-name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

// P18：admin level 徽章
.PageAdminSettings__level-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  border-radius: 100px;
  padding: 1px 6px;
  border: 1px solid;
  line-height: 1.4;

  &.is-super {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.12);
    border-color: rgba(251, 191, 36, 0.4);
  }
  &.is-admin {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
    border-color: rgba(74, 222, 128, 0.35);
  }
  &.is-assistant {
    color: #94a3b8;
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.3);
  }
}

.PageAdminSettings__user-uid {
  font-size: 10px;
  color: $muted;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.PageAdminSettings__user-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

// ── 按鈕 ────────────────────────────────────────────────────────
.PageAdminSettings__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-approve {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.4);
    color: #4ade80;

    &:hover:not(:disabled) {
      background: rgba(34, 197, 94, 0.22);
    }
  }

  &.is-reject {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.35);
    color: #f87171;

    &:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.2);
    }
  }

  &.is-toggle {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.7);

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    &.is-expanded {
      background: rgba(212, 134, 10, 0.12);
      border-color: rgba(212, 134, 10, 0.5);
      color: #f5c842;
    }

    &.is-mini {
      padding: 3px 10px;
      font-size: 10px;
    }
  }
}

// P34：細粒度權限 override 徽章 + 展開區
.PageAdminSettings__perm-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #d4860a;
  background: rgba(212, 134, 10, 0.12);
  border: 1px solid rgba(212, 134, 10, 0.4);
  border-radius: 100px;
  padding: 1px 6px;
  line-height: 1.4;
  margin-left: 4px;
}

.PageAdminSettings__perm-panel {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 10px;
  padding: 14px 16px;
  margin: -4px 0 10px;
}

.PageAdminSettings__perm-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.PageAdminSettings__perm-head-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #d4860a;
}

.PageAdminSettings__perm-head-hint {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  flex: 1;
}

.PageAdminSettings__perm-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

@media (max-width: 600px) {
  .PageAdminSettings__perm-grid {
    grid-template-columns: 1fr;
  }
}

.PageAdminSettings__perm-item {
  padding: 9px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  transition: border-color 0.15s, background 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.05); }

  // 與 LEVEL 預設不同時用 amber 框
  &.is-override {
    background: rgba(212, 134, 10, 0.06);
    border-color: rgba(212, 134, 10, 0.35);
  }
}

.PageAdminSettings__perm-label {
  display: grid;
  grid-template-columns: 18px 1fr;
  grid-template-rows: auto auto;
  column-gap: 10px;
  align-items: center;
  cursor: pointer;
  user-select: none;

  input[type="checkbox"] {
    grid-column: 1;
    grid-row: 1 / 3;
    align-self: start;
    margin-top: 4px;
    accent-color: #d4860a;
    cursor: pointer;
  }
}

.PageAdminSettings__perm-name {
  grid-column: 2;
  grid-row: 1;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.PageAdminSettings__perm-hint {
  grid-column: 2;
  grid-row: 2;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 1px;
}

// ── 新增管理員輸入列 ────────────────────────────────────────────
.PageAdminSettings__add-row {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid $border;
}

.PageAdminSettings__add-input {
  flex: 1;
  min-width: 160px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 7px 12px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: #fff;

  &::placeholder { color: $muted; }
  &:focus { outline: none; border-color: rgba($amber, 0.5); }
}

// ── 其他狀態 ─────────────────────────────────────────────────────
.PageAdminSettings__loading {
  padding: 20px 16px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
}

.PageAdminSettings__empty {
  padding: 20px 16px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  text-align: center;
}

// ── 提示橫幅 ─────────────────────────────────────────────────────
.PageAdminSettings__notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: rgba($amber, 0.06);
  border: 1px solid rgba($amber, 0.2);
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 24px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.6;

  &.is-info {
    margin: 0 16px 12px;
    background: rgba(56, 189, 248, 0.06);
    border-color: rgba(56, 189, 248, 0.2);
  }
}

// ── 系統設定只讀 ─────────────────────────────────────────────────
.PageAdminSettings__groups {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.PageAdminSettings__group {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  overflow: hidden;

  &-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid $border;
    background: rgba(255, 255, 255, 0.02);
  }

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: $amber;
    background: rgba($amber, 0.1);
    border: 1px solid rgba($amber, 0.25);
    border-radius: 100px;
    padding: 2px 8px;
  }

  &-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
  }
}

.PageAdminSettings__rows {
  display: flex;
  flex-direction: column;
}

.PageAdminSettings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  &:last-child { border-bottom: none; }

  &-info { flex: 1; min-width: 0; }

  &-key {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.75);
    margin-bottom: 2px;
  }

  &-hint {
    font-family: 'Barlow', 'Noto Sans TC', sans-serif;
    font-size: 11px;
    color: $muted;
  }

  &-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }
}

// ── 車資進階規則 v1（Fare V2）────────────────────────────────────
.PageAdminSettings__fare-flex {
  flex: 1;
}

.PageAdminSettings__fare-save {
  flex-shrink: 0;
}

.PageAdminSettings__fare-meta {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
  padding: 10px 16px 0;
}

.PageAdminSettings__fare-block {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding: 14px 16px;

  &:last-of-type { border-bottom: none; }
}

.PageAdminSettings__fare-block-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.PageAdminSettings__fare-block-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: $amber;
}

.PageAdminSettings__fare-switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  user-select: none;
  margin-left: auto;

  input[type="checkbox"] {
    accent-color: $amber;
    cursor: pointer;
  }
}

.PageAdminSettings__fare-inline-check {
  margin-left: 0;
  margin-top: 10px;
}

.PageAdminSettings__fare-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 767.98px) {
  .PageAdminSettings__fare-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 479.98px) {
  .PageAdminSettings__fare-grid { grid-template-columns: 1fr; }
}

.PageAdminSettings__fare-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.PageAdminSettings__fare-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: $muted;
}

.PageAdminSettings__fare-subhead {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  margin: 14px 0 8px;
}

.PageAdminSettings__fare-tier {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 8px;

  .PageAdminSettings__fare-field { flex: 1; }
}

.PageAdminSettings__fare-row-del {
  flex-shrink: 0;
}

.PageAdminSettings__fare-add {
  margin-top: 4px;
}

.PageAdminSettings__fare-window {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.PageAdminSettings__fare-window-days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.PageAdminSettings__fare-day {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;

  &.is-on {
    background: rgba($amber, 0.18);
    border-color: rgba($amber, 0.6);
    color: $amber;
  }
}

.PageAdminSettings__fare-window-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 5px;
}

.PageAdminSettings__fare-window-orders {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.PageAdminSettings__fare-order {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;

  &.is-on {
    background: rgba($amber, 0.18);
    border-color: rgba($amber, 0.6);
    color: $amber;
  }
}

.PageAdminSettings__fare-window-times {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;

  .PageAdminSettings__fare-field {
    flex: 1;
    min-width: 110px;
  }
}

.PageAdminSettings__fare-error {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 200, 0, 0.85);
  background: rgba(255, 200, 0, 0.08);
  border: 1px solid rgba(255, 200, 0, 0.25);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 0 16px 4px;
}

.PageAdminSettings__promotions {
  padding: 14px 16px;
}
</style>
