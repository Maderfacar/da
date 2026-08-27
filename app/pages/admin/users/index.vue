<script setup lang="ts">
/**
 * Admin 乘客管理頁 — A2 醜點系統 Phase 1
 *
 * 功能：
 *   - 列出 role='passenger' 全部乘客
 *   - 顯示 uglyCount（醜點數）/ blacklisted（拉黑）狀態
 *   - 三 tab filter：全部 / 有醜點 / 已拉黑
 *   - 拉黑 / 解黑（呼叫 PostUserBlacklist endpoint）
 */
import type { AdminUser } from '@/protocol/fetch-api/api/admin';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

type Tab = 'all' | 'ugly' | 'blacklist';

const loading = ref(false);
const users = ref<AdminUser[]>([]);
const activeTab = ref<Tab>('all');

const filtered = computed(() => {
  if (activeTab.value === 'ugly') return users.value.filter((u) => (u.uglyCount ?? 0) > 0 && !u.blacklisted);
  if (activeTab.value === 'blacklist') return users.value.filter((u) => u.blacklisted === true);
  return users.value;
});

const counts = computed(() => ({
  all: users.value.length,
  ugly: users.value.filter((u) => (u.uglyCount ?? 0) > 0 && !u.blacklisted).length,
  blacklist: users.value.filter((u) => u.blacklisted === true).length,
}));

const ApiLoadUsers = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAdminUsers({ role: 'passenger' });
    users.value = Array.isArray(res.data) ? (res.data as AdminUser[]) : [];
  } catch (err) {
    console.error('[admin/users] load failed:', err);
    users.value = [];
  } finally {
    loading.value = false;
  }
};

// ── 拉黑 / 解黑 sub-modal ─────────────────────────────
const blacklistDialog = reactive({
  open: false,
  user: null as AdminUser | null,
  action: 'add' as 'add' | 'remove',
  reason: '',
  saving: false,
});

const ClickOpenBlacklist = (u: AdminUser, action: 'add' | 'remove') => {
  blacklistDialog.user = u;
  blacklistDialog.action = action;
  blacklistDialog.reason = '';
  blacklistDialog.open = true;
};

const ClickCloseBlacklist = () => {
  if (blacklistDialog.saving) return;
  blacklistDialog.open = false;
};

const ApiSubmitBlacklist = async () => {
  if (!blacklistDialog.user) return;
  blacklistDialog.saving = true;
  try {
    const res = await $api.PostUserBlacklist(blacklistDialog.user.uid, {
      action: blacklistDialog.action,
      reason: blacklistDialog.reason.trim() || undefined,
    });
    if (res.status.code === 200) {
      ElMessage({
        message: blacklistDialog.action === 'add' ? '已拉黑該乘客' : '已解除拉黑',
        type: 'success',
      });
      blacklistDialog.open = false;
      await ApiLoadUsers();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '操作失敗', type: 'error' });
    }
  } finally {
    blacklistDialog.saving = false;
  }
};

const FormatDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  return $dayjs(iso).format('YYYY/MM/DD HH:mm');
};

onMounted(() => {
  ApiLoadUsers();
});
</script>

<template lang="pug">
.PageAdminUsers(data-surface='dark')
  .PageAdminUsers__header
    .PageAdminUsers__header-label PASSENGER MANAGEMENT
    h1.PageAdminUsers__header-title 乘客管理

  //- Tab 切換
  .PageAdminUsers__tabs
    button.PageAdminUsers__tab(
      :class="{ 'is-active': activeTab === 'all' }"
      @click="activeTab = 'all'"
    )
      | 全部
      span.PageAdminUsers__tab-count {{ counts.all }}
    button.PageAdminUsers__tab(
      :class="{ 'is-active': activeTab === 'ugly' }"
      @click="activeTab = 'ugly'"
    )
      | 有醜點
      span.PageAdminUsers__tab-count {{ counts.ugly }}
    button.PageAdminUsers__tab(
      :class="{ 'is-active': activeTab === 'blacklist' }"
      @click="activeTab = 'blacklist'"
    )
      | 已拉黑
      span.PageAdminUsers__tab-count {{ counts.blacklist }}

  //- 列表
  .PageAdminUsers__list(v-if="!loading")
    .PageAdminUsers__empty(v-if="filtered.length === 0") 無資料
    .PageAdminUsers__row(v-for="u in filtered" :key="u.uid")
      .PageAdminUsers__row-main
        .PageAdminUsers__row-name {{ u.displayName || '(無名)' }}
        .PageAdminUsers__row-meta
          span.PageAdminUsers__row-uid {{ u.uid.slice(0, 10) }}…
          span.PageAdminUsers__row-date 註冊 {{ FormatDate(u.createdAt) }}
      .PageAdminUsers__row-badges
        span.PageAdminUsers__badge.is-ugly(v-if="(u.uglyCount ?? 0) > 0 && !u.blacklisted") ⚠ {{ u.uglyCount }} 醜
        span.PageAdminUsers__badge.is-blacklist(v-if="u.blacklisted") 🚫 已拉黑
        span.PageAdminUsers__badge.is-clean(v-if="(u.uglyCount ?? 0) === 0 && !u.blacklisted") ✓ 清白
      .PageAdminUsers__row-actions
        button.PageAdminUsers__action.is-danger(
          v-if="!u.blacklisted"
          @click="ClickOpenBlacklist(u, 'add')"
        ) 拉黑
        button.PageAdminUsers__action.is-primary(
          v-else
          @click="ClickOpenBlacklist(u, 'remove')"
        ) 解黑

  .PageAdminUsers__loading(v-else) 載入中…

  //- Sub-modal：拉黑 / 解黑確認
  .PageAdminUsers__sub-mask(v-if="blacklistDialog.open" @click.self="ClickCloseBlacklist")
    .PageAdminUsers__sub-modal
      .PageAdminUsers__sub-title
        | {{ blacklistDialog.action === 'add' ? '拉黑乘客' : '解除拉黑' }}
      .PageAdminUsers__sub-body
        .PageAdminUsers__sub-user
          | 對象：{{ blacklistDialog.user?.displayName || '(無名)' }}
          span.PageAdminUsers__sub-user-uid  · {{ blacklistDialog.user?.uid?.slice(0, 12) }}…
        template(v-if="blacklistDialog.action === 'add'")
          label.PageAdminUsers__sub-label 原因（選填，會記錄在 audit log）
          textarea.PageAdminUsers__sub-textarea(
            v-model="blacklistDialog.reason"
            rows="3"
            maxlength="200"
            placeholder="例：3 次以上未到場 / 嚴重違規..."
          )
          p.PageAdminUsers__sub-hint.is-warn ⚠️ 拉黑後該乘客將無法下訂新訂單，並自動推送「服務暫停通知」LINE 訊息。
        template(v-else)
          p.PageAdminUsers__sub-hint 確認解除拉黑？該乘客將恢復下訂能力。
      .PageAdminUsers__sub-actions
        button.PageAdminUsers__action.is-secondary(
          @click="ClickCloseBlacklist"
          :disabled="blacklistDialog.saving"
        ) 返回
        button.PageAdminUsers__action(
          :class="blacklistDialog.action === 'add' ? 'is-danger' : 'is-primary'"
          :disabled="blacklistDialog.saving"
          @click="ApiSubmitBlacklist"
        )
          template(v-if="blacklistDialog.saving") 處理中…
          template(v-else-if="blacklistDialog.action === 'add'") 確認拉黑
          template(v-else) 確認解黑
</template>

<style lang="scss" scoped>

.PageAdminUsers {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: var(--ink);
  color: var(--surface-raised);
  font-family: var(--ff-ui);
}

.PageAdminUsers__header {
  margin-bottom: 24px;
}

.PageAdminUsers__header-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-kicker);
  color: var(--accent-lit);
  text-transform: uppercase;
}

.PageAdminUsers__header-title {
  margin-top: 4px;
  font-size: var(--fs-h1);
  font-weight: 700;
}

.PageAdminUsers__tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--surface-a06);
}

.PageAdminUsers__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: transparent;
  border: 0;
  color: var(--surface-a40);
  font-size: var(--fs-body);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--dur-base) var(--ease-out);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;

  &:hover {
    color: var(--surface-a82);
  }

  &.is-active {
    color: var(--surface-raised);
    border-bottom-color: var(--accent);
  }
}

.PageAdminUsers__tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 2px 6px;
  border-radius: var(--r-pill);
  background: var(--surface-a06);
  font-size: var(--fs-label);
  font-weight: 600;
}

.PageAdminUsers__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageAdminUsers__row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-md);
  background: var(--surface-a06);
  transition: background var(--dur-base) var(--ease-out);

  &:hover {
    background: var(--surface-a06);
  }
}

.PageAdminUsers__row-main {
  min-width: 0;
}

.PageAdminUsers__row-name {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--surface-raised);
}

.PageAdminUsers__row-meta {
  margin-top: 4px;
  display: flex;
  gap: 12px;
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.PageAdminUsers__row-uid {
  font-family: var(--ff-mono);
}

.PageAdminUsers__row-date {
  &::before {
    content: '· ';
    color: var(--surface-a40);
  }
}

.PageAdminUsers__row-badges {
  display: flex;
  gap: 6px;
}

.PageAdminUsers__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--ls-snug);

  &.is-ugly {
    color: var(--accent-lit);
    background: var(--accent-a12);
    border: 1px solid var(--accent-a30);
  }

  &.is-blacklist {
    color: var(--stop);
    background: var(--stop-a15);
    border: 1px solid var(--stop-a45);
  }

  &.is-clean {
    color: var(--good);
    background: var(--good-a08);
    border: 1px solid var(--good-a30);
  }
}

.PageAdminUsers__row-actions {
  display: flex;
  gap: 8px;
}

.PageAdminUsers__action {
  padding: 8px 16px;
  border: 0;
  border-radius: var(--r-sm);
  font-size: var(--fs-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--dur-base) var(--ease-out);

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.is-danger {
    color: var(--surface-raised);
    background: var(--stop);
  }

  &.is-primary {
    color: var(--ink);
    background: var(--accent);
  }

  &.is-secondary {
    color: var(--surface-a82);
    background: transparent;
    border: 1px solid var(--surface-a06);
  }
}

.PageAdminUsers__empty,
.PageAdminUsers__loading {
  padding: 60px 20px;
  text-align: center;
  color: var(--surface-a40);
  font-size: var(--fs-body);
}

.PageAdminUsers__sub-mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--ink-a70);
  z-index: var(--z-modal);
}

.PageAdminUsers__sub-modal {
  width: 100%;
  max-width: 460px;
  padding: 24px;
  background: var(--surface-deep-2);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-md);
}

.PageAdminUsers__sub-title {
  font-size: var(--fs-h4);
  font-weight: 700;
  margin-bottom: 16px;
}

.PageAdminUsers__sub-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PageAdminUsers__sub-user {
  font-size: var(--fs-body);
  color: var(--surface-a82);
}

.PageAdminUsers__sub-user-uid {
  color: var(--surface-a40);
  font-family: var(--ff-mono);
  font-size: var(--fs-label);
}

.PageAdminUsers__sub-label {
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.PageAdminUsers__sub-textarea {
  width: 100%;
  padding: 10px 12px;
  background: var(--surface-a06);
  color: var(--surface-raised);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-sm);
  font-size: var(--fs-body-sm);
  font-family: inherit;
  resize: vertical;
}

.PageAdminUsers__sub-hint {
  font-size: var(--fs-label);
  color: var(--surface-a40);
  line-height: var(--lh-relaxed);

  &.is-warn {
    color: var(--wait-a70);
  }
}

.PageAdminUsers__sub-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 20px;
}
</style>
