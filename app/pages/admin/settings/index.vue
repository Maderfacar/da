<script setup lang="ts">
import type { AdminUser } from '@/protocol/fetch-api/api/admin';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

// ── 系統設定（只讀展示）────────────────────────────────────────
const groups = [
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

// 管理員清單
const admins = ref<AdminUser[]>([]);
const adminsLoading = ref(false);
const newAdminUid = ref('');
const newAdminName = ref('');
const addingAdmin = ref(false);

// 司機清單
const pendingDrivers = ref<AdminUser[]>([]);
const approvedDrivers = ref<AdminUser[]>([]);
const driversLoading = ref(false);
const approvingUid = ref('');

// ── 資料載入 ────────────────────────────────────────────────────
const ApiLoadAdmins = async () => {
  adminsLoading.value = true;
  const res = await $api.GetAdminUsers({ role: 'admin' });
  if (res.data) admins.value = res.data;
  adminsLoading.value = false;
};

const ApiLoadDrivers = async () => {
  driversLoading.value = true;
  const [pendingRes, approvedRes] = await Promise.all([
    $api.GetAdminUsers({ role: 'driver', approved: false }),
    $api.GetAdminUsers({ role: 'driver', approved: true }),
  ]);
  if (pendingRes.data) pendingDrivers.value = pendingRes.data;
  if (approvedRes.data) approvedDrivers.value = approvedRes.data;
  driversLoading.value = false;
};

watch(activeTab, (tab) => {
  if (tab === 'admin') ApiLoadAdmins();
  else ApiLoadDrivers();
}, { immediate: true });

// ── 管理員白名單操作（P10：addRole / removeRole 語意） ─────────
const ClickAddAdmin = async () => {
  const uid = newAdminUid.value.trim();
  if (!uid) return;
  addingAdmin.value = true;
  const lineUid = uid.startsWith('line:') ? uid : `line:${uid}`;
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
  await $api.PatchAdminUser(uid, { removeRole: 'admin' });
  await ApiLoadAdmins();
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
</script>

<template lang="pug">
.PageAdminSettings
  .PageAdminSettings__header
    .PageAdminSettings__header-label SYSTEM SETTINGS
    h1.PageAdminSettings__header-title 系統設定

  //- 存取控制
  .PageAdminSettings__section
    .PageAdminSettings__section-head
      span.PageAdminSettings__section-label ACCESS
      span.PageAdminSettings__section-title 存取控制

    //- Tab
    .PageAdminSettings__tabs
      button.PageAdminSettings__tab(
        :class="{ 'is-active': activeTab === 'driver' }"
        @click="activeTab = 'driver'"
      ) 司機審核
      button.PageAdminSettings__tab(
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

    //- 管理員白名單
    template(v-if="activeTab === 'admin'")
      .PageAdminSettings__notice.is-info
        span ℹ️
        span 管理員帳號具有完整系統權限。首位管理員須至 Firebase Console 手動於 users/{uid} 加入 roles 陣列含 'admin'。

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
          .PageAdminSettings__user-row(v-for="u in admins" :key="u.uid")
            img.PageAdminSettings__avatar(:src="u.pictureUrl || '/img/avatar-default.png'" :alt="u.displayName")
            .PageAdminSettings__user-info
              .PageAdminSettings__user-name {{ u.displayName || '未知使用者' }}
              .PageAdminSettings__user-uid {{ u.uid }}
            .PageAdminSettings__user-actions
              button.PageAdminSettings__btn.is-reject(@click="ClickRemoveAdmin(u.uid)") 移除

        .PageAdminSettings__empty(v-if="admins.length === 0")
          span 目前無管理員資料（請至 Firebase Console 設定首位管理員）

  //- 系統設定（只讀）
  .PageAdminSettings__notice
    span ⚠️
    span 敏感設定（Token、Key）僅顯示遮罩，如需修改請透過 Vercel 環境變數管理。

  .PageAdminSettings__groups
    .PageAdminSettings__group(v-for="g in groups" :key="g.title")
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
</style>
