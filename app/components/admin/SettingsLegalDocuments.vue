<script setup lang="ts">
// 會員條款 / 隱私政策編輯器（admin/settings 內 LEGAL DOCUMENTS section）
//
// 兩 tab 切換：terms / privacy；每 tab 內 TinyEditor + title input + 儲存按鈕。
// 載入時若 doc 不存在 → 顯示空表單，admin 第一次儲存即建立。
// 切 tab 時若 dirty → UseAsk 提示「未儲存的變更會遺失」。
import type { LegalPageDto, LegalPageKey } from '@/protocol/fetch-api/api/admin/legal-page';

const TITLE_MAX = 200;
const BODY_HTML_MAX = 100_000;

const TAB_LABEL: Record<LegalPageKey, string> = {
  terms: '會員服務條款',
  privacy: '隱私權政策',
};

const activeKey = ref<LegalPageKey>('terms');
const loading = ref(false);
const saving = ref(false);
const docs = ref<Record<LegalPageKey, LegalPageDto | null>>({ terms: null, privacy: null });

const form = reactive({
  title: '',
  bodyHtml: '',
});

const initial = reactive({
  title: '',
  bodyHtml: '',
});

const isDirty = computed(() => form.title !== initial.title || form.bodyHtml !== initial.bodyHtml);

const _ApplyDocToForm = (d: LegalPageDto | null, key: LegalPageKey) => {
  // 預設標題：若 doc 不存在則填入 fallback；admin 可改
  const fallback = TAB_LABEL[key];
  form.title = d?.title?.trim() || fallback;
  form.bodyHtml = d?.bodyHtml ?? '';
  initial.title = form.title;
  initial.bodyHtml = form.bodyHtml;
};

const ApiLoadAll = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAdminLegalPages();
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入失敗', type: 'error' });
      return;
    }
    const map: Record<LegalPageKey, LegalPageDto | null> = { terms: null, privacy: null };
    for (const item of res.data.items) {
      if (item.key === 'terms' || item.key === 'privacy') {
        map[item.key] = item;
      }
    }
    docs.value = map;
    _ApplyDocToForm(map[activeKey.value], activeKey.value);
  } finally {
    loading.value = false;
  }
};

const ClickTab = async (key: LegalPageKey) => {
  if (key === activeKey.value) return;
  if (isDirty.value) {
    const ok = await UseAsk('目前 tab 有未儲存變更，切換將遺失。是否繼續？');
    if (!ok) return;
  }
  activeKey.value = key;
  _ApplyDocToForm(docs.value[key], key);
};

const ClickSave = async () => {
  if (saving.value) return;
  const title = form.title.trim();
  if (!title || title.length > TITLE_MAX) {
    ElMessage({ message: `標題必須為 1-${TITLE_MAX} 字`, type: 'error' });
    return;
  }
  if (form.bodyHtml.length > BODY_HTML_MAX) {
    ElMessage({ message: `內文不可超過 ${(BODY_HTML_MAX / 1024).toFixed(0)} KB`, type: 'error' });
    return;
  }
  saving.value = true;
  try {
    const res = await $api.PutAdminLegalPage(activeKey.value, {
      title,
      bodyHtml: form.bodyHtml,
    });
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '儲存失敗', type: 'error' });
      return;
    }
    ElMessage({ message: `已儲存（version v${res.data.version}）`, type: 'success' });
    // 重抓最新 doc（取得 updatedAt 顯示用）
    await ApiLoadAll();
  } finally {
    saving.value = false;
  }
};

const FormatTime = (iso: string | null) => (iso ? $dayjs(iso).format('YYYY-MM-DD HH:mm') : '尚未建立');

onMounted(() => { void ApiLoadAll(); });

const currentDoc = computed(() => docs.value[activeKey.value]);
</script>

<template lang="pug">
.SettingsLegalDocuments
  //- ── Tabs ─────────────────────────────────────────────
  .SettingsLegalDocuments__tabs
    button.SettingsLegalDocuments__tab(
      v-for="k in (['terms', 'privacy'] as LegalPageKey[])"
      :key="k"
      :class="{ 'is-active': activeKey === k }"
      @click="ClickTab(k)"
    ) {{ TAB_LABEL[k] }}

  //- ── Loading ──────────────────────────────────────────
  .SettingsLegalDocuments__loading(v-if="loading") 載入中…

  template(v-else)
    .SettingsLegalDocuments__meta
      span.SettingsLegalDocuments__meta-version
        | Version v{{ currentDoc?.version ?? 0 }}
      span.SettingsLegalDocuments__meta-time
        | 最後更新：{{ FormatTime(currentDoc?.updatedAt ?? null) }}
      span.SettingsLegalDocuments__meta-dirty(v-if="isDirty") · 有未儲存的變更

    //- ── Title ────────────────────────────────────────────
    .SettingsLegalDocuments__field
      label.SettingsLegalDocuments__label 標題
      input.SettingsLegalDocuments__input(
        v-model="form.title"
        type="text"
        :maxlength="TITLE_MAX"
        placeholder="例：會員服務條款"
      )
      .SettingsLegalDocuments__hint {{ form.title.length }} / {{ TITLE_MAX }}

    //- ── Body ─────────────────────────────────────────────
    .SettingsLegalDocuments__field
      label.SettingsLegalDocuments__label 內文（富文本，admin 改完儲存後乘客端立即可見）
      .SettingsLegalDocuments__editor
        TinyEditor(v-model="form.bodyHtml")
      .SettingsLegalDocuments__hint(v-if="form.bodyHtml.length > 0")
        | {{ form.bodyHtml.length.toLocaleString() }} / {{ BODY_HTML_MAX.toLocaleString() }} 字元

    //- ── Save ─────────────────────────────────────────────
    .SettingsLegalDocuments__actions
      button.SettingsLegalDocuments__btn.is-approve(
        :disabled="saving || !isDirty"
        @click="ClickSave"
      ) {{ saving ? '儲存中…' : '儲存' }}
      span.SettingsLegalDocuments__public-hint
        | 公開於：
        a.SettingsLegalDocuments__public-link(:href="`/legal/${activeKey}`" target="_blank") /legal/{{ activeKey }}
</template>

<style lang="scss" scoped>

.SettingsLegalDocuments {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.SettingsLegalDocuments__tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--surface-a06);
}

.SettingsLegalDocuments__tab {
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 600;
  letter-spacing: var(--ls-label);
  padding: 10px 18px;
  border: none;
  background: transparent;
  color: var(--surface-a50);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);

  &:hover { color: var(--surface-raised); }
  &.is-active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
}

.SettingsLegalDocuments__loading {
  padding: 40px;
  text-align: center;
  color: var(--surface-a50);
}

.SettingsLegalDocuments__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a50);
}

.SettingsLegalDocuments__meta-version {
  color: var(--accent);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
}

.SettingsLegalDocuments__meta-dirty {
  color: var(--accent-lit);
  font-weight: 600;
}

.SettingsLegalDocuments__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.SettingsLegalDocuments__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  color: var(--surface-a72);
}

.SettingsLegalDocuments__input {
  padding: 9px 14px;
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-sm);
  background: var(--surface-a06);
  color: var(--surface-raised);
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  outline: none;
  &:focus { border-color: var(--accent-a60); }
  &::placeholder { color: var(--surface-a30); }
}

.SettingsLegalDocuments__editor {
  background: var(--surface-raised);
  border-radius: var(--r-sm);
  overflow: hidden;
  // TinyEditor 內部 iframe 不繼承 dark theme，這層只控制圓角邊框
}

.SettingsLegalDocuments__hint {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a50);
  letter-spacing: var(--ls-label);
}

.SettingsLegalDocuments__actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding-top: 4px;
}

.SettingsLegalDocuments__btn {
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 9px 22px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);

  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &.is-approve {
    background: var(--accent);
    color: var(--surface-raised);
    &:hover:not(:disabled) { background: var(--accent-deep); }
  }
}

.SettingsLegalDocuments__public-hint {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a50);
}

.SettingsLegalDocuments__public-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
  &:hover { text-decoration: underline; }
}
</style>
