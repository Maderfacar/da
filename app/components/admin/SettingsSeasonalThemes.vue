<script setup lang="ts">
// 乘客端季節主題管理（W2）
// - 列出全部主題包（含 disabled）+ 目前生效指標
// - 切換生效主題（PutActiveTheme；目標須 enabled）
// - 啟用 / 停用主題（PatchThemeEnabled；default 不可停用）
// - Hero 主圖上傳 / 更換 / 移除（UploadThemeHeroImage → PatchThemeHero）
//
// 首發僅切換 / 啟用停用 / 換 Hero 圖，不開放自由改色（色票由 seed 定、Brain 審）。
// 換色只影響乘客端（front-desk / marketing layout 的 [data-da-theme]）；admin / driver 不受影響。

const themes = ref<AdminSiteThemeDto[]>([]);
const activeThemeId = ref('');
const loading = ref(true);
const applyingId = ref('');
const togglingId = ref('');
const uploadingId = ref('');

// 卡片色票預覽用的代表性 token（缺項則不顯示該格）
const SWATCH_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'da-amber', label: '主色' },
  { key: 'da-amber-light', label: '亮色' },
  { key: 'da-cream', label: '底色' },
  { key: 'da-dark', label: '文字' },
  { key: 'da-stripe-yellow', label: '斜紋亮' },
  { key: 'da-stripe-dark', label: '斜紋暗' },
];

// 每卡一個隱藏 file input（依 themeId 存 ref）
const fileInputs: Record<string, HTMLInputElement | null> = {};
const SetFileInput = (id: string) => (el: unknown) => {
  fileInputs[id] = el as HTMLInputElement | null;
};

const ApiLoadThemes = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAdminThemes();
    if (res.status?.code !== 200 || !res.data) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入主題失敗', type: 'error' });
      return;
    }
    themes.value = res.data.themes;
    activeThemeId.value = res.data.activeThemeId;
  } finally {
    loading.value = false;
  }
};

const ClickApply = async (t: AdminSiteThemeDto) => {
  if (t.id === activeThemeId.value || applyingId.value) return;
  if (!t.enabled) {
    ElMessage({ message: '已停用的主題無法設為生效，請先啟用', type: 'warning' });
    return;
  }
  const ok = await UseAsk(`確定將乘客端主題切換為「${t.name.zh}」？切換後乘客端首頁配色與 Hero 會跟著更新（最多 30 秒生效）。`);
  if (!ok) return;
  applyingId.value = t.id;
  try {
    const res = await $api.PutActiveTheme(t.id);
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '切換失敗', type: 'error' });
      return;
    }
    activeThemeId.value = t.id;
    ElMessage({ message: `已切換為「${t.name.zh}」`, type: 'success' });
  } finally {
    applyingId.value = '';
  }
};

const ClickToggleEnabled = async (t: AdminSiteThemeDto) => {
  if (togglingId.value) return;
  if (t.isDefault) {
    ElMessage({ message: '預設主題不可停用', type: 'warning' });
    return;
  }
  togglingId.value = t.id;
  try {
    const res = await $api.PatchThemeEnabled(t.id, !t.enabled);
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '切換失敗', type: 'error' });
      return;
    }
    await ApiLoadThemes();
  } finally {
    togglingId.value = '';
  }
};

const ClickPickHero = (id: string) => {
  fileInputs[id]?.click();
};

const OnHeroChange = async (e: Event, t: AdminSiteThemeDto) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (target) target.value = '';
  if (!file) return;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  if (!ALLOWED.includes(file.type)) {
    ElMessage({ message: '僅接受 jpg / png / webp', type: 'warning' });
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage({ message: '檔案超過 5MB 限制', type: 'warning' });
    return;
  }

  uploadingId.value = t.id;
  try {
    const up = await $api.UploadThemeHeroImage(file, t.id);
    if (up.status?.code !== 200 || !up.data?.url) {
      ElMessage({ message: up.status?.message?.zh_tw ?? '上傳失敗', type: 'error' });
      return;
    }
    const patch = await $api.PatchThemeHero(t.id, up.data.url);
    if (patch.status?.code !== 200) {
      ElMessage({ message: patch.status?.message?.zh_tw ?? 'Hero 主圖套用失敗', type: 'error' });
      return;
    }
    await ApiLoadThemes();
    ElMessage({ message: `「${t.name.zh}」Hero 主圖已更新`, type: 'success' });
  } finally {
    uploadingId.value = '';
  }
};

const ClickRemoveHero = async (t: AdminSiteThemeDto) => {
  if (uploadingId.value) return;
  const ok = await UseAsk(`確定移除「${t.name.zh}」的 Hero 主圖？移除後該主題首頁回到純色背景。`);
  if (!ok) return;
  uploadingId.value = t.id;
  try {
    const res = await $api.PatchThemeHero(t.id, null);
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '移除失敗', type: 'error' });
      return;
    }
    await ApiLoadThemes();
    ElMessage({ message: 'Hero 主圖已移除', type: 'success' });
  } finally {
    uploadingId.value = '';
  }
};

onMounted(() => {
  void ApiLoadThemes();
});

// ── 色票編輯（階段 2）────────────────────────────────────────────────────────
// 在此之前換色只能改 scripts/migrate-site-themes.mjs 重跑或手動改 Firestore。
// 12 個 key 對齊 shared/site-theme.ts 的 DA_THEME_TOKEN_KEYS 白名單（端點也會再驗一次）。
const TOKEN_FIELDS: ReadonlyArray<{ key: string; label: string; hint: string }> = [
  { key: 'da-cream',         label: '骨白 · 頁面底',   hint: '整站背景' },
  { key: 'da-off-white',     label: '瓷白 · 卡片面',   hint: '卡片、面板' },
  { key: 'da-amber',         label: '主色',            hint: '按鈕、連結、強調' },
  { key: 'da-amber-light',   label: '主色（深底用）',  hint: '深色面上的主色' },
  { key: 'da-amber-pale',    label: '主色極淡底',      hint: '選中態底色' },
  { key: 'da-dark',          label: '主文字',          hint: '標題與內文' },
  { key: 'da-dark-mid',      label: '深色面第二層',    hint: '深底上的抬升面' },
  { key: 'da-gray',          label: '次要文字',        hint: '說明、註記' },
  { key: 'da-gray-light',    label: '三級文字',        hint: '佔位、停用' },
  { key: 'da-gray-pale',     label: '髮絲線',          hint: '分隔線、邊框' },
  { key: 'da-stripe-yellow', label: '斜紋亮',          hint: '首頁跑道斜紋' },
  { key: 'da-stripe-dark',   label: '斜紋暗',          hint: '首頁跑道斜紋' },
];

/** 要即時檢查的對比配對 —— [前景 key, 背景 key, 標籤, 門檻] */
const CONTRAST_CHECKS: ReadonlyArray<[string, string, string, number]> = [
  ['da-amber', 'da-cream', '主色 / 頁面底', 4.5],
  ['da-amber', 'da-off-white', '主色 / 卡片面', 4.5],
  ['da-dark', 'da-cream', '主文字 / 頁面底', 4.5],
  ['da-gray', 'da-off-white', '次要文字 / 卡片面', 4.5],
  ['da-gray-light', 'da-off-white', '三級文字 / 卡片面', 3],
  ['da-amber-light', 'da-dark', '深底主色 / 主文字色', 4.5],
];

const editingId = ref('');
const savingTokens = ref(false);
const draft = ref<Record<string, string>>({});
/** 深色模式的那一組。深色不是從淺色推導的 —— `da-dark` 在兩個模式下語意都是
 *  「主文字色」，值卻要反過來（深 ↔ 淺），所以只能各編一組。 */
const draftDark = ref<Record<string, string>>({});
const editMode = ref<'light' | 'dark'>('light');
const activeDraft = computed(() => (editMode.value === 'dark' ? draftDark : draft).value);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** WCAG 相對亮度 */
const Luminance = (hex: string): number => {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

/** 兩色對比。任一方不是合法 hex 就回 0（UI 顯示為「—」） */
const Contrast = (a?: string, b?: string): number => {
  if (!a || !b || !HEX_RE.test(a) || !HEX_RE.test(b)) return 0;
  const [hi, lo] = [Luminance(a), Luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** 草稿目前的對比檢查結果（未填的 key 回退到主題現值，再回退 default 底層） */
const contrastRows = computed(() => {
  const theme = themes.value.find((t) => t.id === editingId.value);
  const base = themes.value.find((t) => t.isDefault);
  const dark = editMode.value === 'dark';
  const pick = (k: string) => dark
    ? (draftDark.value[k] || theme?.tokensDark?.[k] || base?.tokensDark?.[k] || '')
    : (draft.value[k] || theme?.tokens?.[k] || base?.tokens?.[k] || '');
  return CONTRAST_CHECKS.map(([fg, bg, label, min]) => {
    const ratio = Contrast(pick(fg), pick(bg));
    return { label, min, ratio, pass: ratio >= min, text: ratio ? ratio.toFixed(2) + ':1' : '—' };
  });
});

const ClickEditTokens = (t: AdminSiteThemeDto) => {
  editingId.value = t.id;
  editMode.value = 'light';
  const base = themes.value.find((x) => x.isDefault);
  const next: Record<string, string> = {};
  const nextDark: Record<string, string> = {};
  for (const f of TOKEN_FIELDS) {
    next[f.key] = (t.tokens?.[f.key] || base?.tokens?.[f.key] || '#000000').toUpperCase();
    nextDark[f.key] = (t.tokensDark?.[f.key] || base?.tokensDark?.[f.key] || '#000000').toUpperCase();
  }
  draft.value = next;
  draftDark.value = nextDark;
};

const ClickCancelTokens = () => {
  editingId.value = '';
  draft.value = {};
  draftDark.value = {};
};

/** 色票文字欄：允許使用者邊打邊看，只在合法 hex 時才同步給色塊 */
const OnHexInput = (key: string, value: string) => {
  const v = value.trim();
  activeDraft.value[key] = v.startsWith('#') ? v.toUpperCase() : ('#' + v).toUpperCase();
};

const ApiSaveTokens = async (t: AdminSiteThemeDto) => {
  // 兩組一起驗、一起存 —— 只存一半的話，淺色與深色會落在不同的版本上
  const invalid = TOKEN_FIELDS.filter(
    (f) => !HEX_RE.test(draft.value[f.key] || '') || !HEX_RE.test(draftDark.value[f.key] || ''),
  );
  if (invalid.length) {
    ElMessage({ message: `色票格式錯誤：${invalid.map((f) => f.label).join('、')}（需 6 碼 hex）`, type: 'error' });
    return;
  }
  const failing = contrastRows.value.filter((r) => !r.pass);
  const warn = failing.length
    ? `\n\n⚠ 這些對比未達門檻，乘客端可能難以閱讀：\n${failing.map((r) => `· ${r.label} ${r.text}（需 ${r.min}:1）`).join('\n')}`
    : '';
  const scope = t.isDefault
    ? '\n\n⚠ 這是**預設主題**，其他節日包沒覆寫的色票都會 fallback 到它 —— 等於同時改動所有主題的底。'
    : '';
  const ok = await UseAsk(`確定儲存「${t.name.zh}」的色票？乘客端最多 30 秒後生效。${scope}${warn}`);
  if (!ok) return;

  savingTokens.value = true;
  try {
    const res = await $api.PatchThemeTokens(t.id, { ...draft.value }, { ...draftDark.value });
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '儲存色票失敗', type: 'error' });
      return;
    }
    ElMessage({ message: '色票已儲存', type: 'success' });
    editingId.value = '';
    draft.value = {};
    draftDark.value = {};
    await ApiLoadThemes();
  } finally {
    savingTokens.value = false;
  }
};

</script>

<template lang="pug">
.SettingsSeasonalThemes
  .SettingsSeasonalThemes__hint
    | 切換乘客端整組配色與首頁 Hero 主視覺；換色只影響乘客端，司機端與後台外觀不變。
    | 可切換 / 啟用停用 / 更換 Hero 主圖，並直接編輯 12 個色票（存檔前會即時檢查 WCAG 對比）。

  .SettingsSeasonalThemes__loading(v-if="loading") 載入中…

  template(v-else)
    .SettingsSeasonalThemes__empty(v-if="themes.length === 0") 尚無主題資料

    .SettingsSeasonalThemes__grid(v-else)
      article.SettingsSeasonalThemes__card(
        v-for="t in themes"
        :key="t.id"
        :class="{ 'is-active': t.id === activeThemeId, 'is-disabled': !t.enabled }"
      )
        //- 卡頭：名稱 + 狀態徽章
        .SettingsSeasonalThemes__card-head
          .SettingsSeasonalThemes__card-name
            span.SettingsSeasonalThemes__card-zh {{ t.name.zh }}
            span.SettingsSeasonalThemes__card-id {{ '#' + t.id }}
          .SettingsSeasonalThemes__badges
            span.SettingsSeasonalThemes__badge.is-active(v-if="t.id === activeThemeId") 生效中
            span.SettingsSeasonalThemes__badge.is-default(v-if="t.isDefault") 預設
            span.SettingsSeasonalThemes__badge.is-off(v-if="!t.enabled") 已停用

        //- 副名（en / ja）
        .SettingsSeasonalThemes__card-sub {{ t.name.en }} · {{ t.name.ja }}

        //- 色票
        .SettingsSeasonalThemes__swatches
          .SettingsSeasonalThemes__swatch(
            v-for="s in SWATCH_KEYS"
            v-show="t.tokens[s.key]"
            :key="s.key"
            :title="s.label + '：' + t.tokens[s.key]"
          )
            span.SettingsSeasonalThemes__swatch-chip(:style="{ background: t.tokens[s.key] }")
            span.SettingsSeasonalThemes__swatch-label {{ s.label }}


        //- ── 色票編輯器（階段 2）────────────────────────────────
        .SettingsSeasonalThemes__editor(v-if="editingId === t.id")
          //- 淺色 / 深色雙盤：深色不是從淺色推導的，兩組都要編
          .SettingsSeasonalThemes__mode
            button.SettingsSeasonalThemes__mode-btn(
              type="button"
              :class="{ 'is-on': editMode === 'light' }"
              @click="editMode = 'light'"
            ) 淺色
            button.SettingsSeasonalThemes__mode-btn(
              type="button"
              :class="{ 'is-on': editMode === 'dark' }"
              @click="editMode = 'dark'"
            ) 深色
          .SettingsSeasonalThemes__editor-grid
            label.SettingsSeasonalThemes__field(v-for="f in TOKEN_FIELDS" :key="f.key")
              span.SettingsSeasonalThemes__field-label {{ f.label }}
              span.SettingsSeasonalThemes__field-hint {{ f.hint }}
              .SettingsSeasonalThemes__field-row
                input.SettingsSeasonalThemes__color(
                  type="color"
                  :value="activeDraft[f.key]"
                  @input="(e) => OnHexInput(f.key, (e.target as HTMLInputElement).value)"
                )
                input.SettingsSeasonalThemes__hex(
                  type="text"
                  maxlength="7"
                  spellcheck="false"
                  :value="activeDraft[f.key]"
                  @input="(e) => OnHexInput(f.key, (e.target as HTMLInputElement).value)"
                )

          //- 對比即時檢查：色票編輯最容易出事的地方，不是「好不好看」是「看不看得見」
          .SettingsSeasonalThemes__contrast
            .SettingsSeasonalThemes__contrast-head 對比檢查（WCAG · {{ editMode === 'dark' ? '深色' : '淺色' }}）
            .SettingsSeasonalThemes__contrast-row(
              v-for="r in contrastRows"
              :key="r.label"
              :class="{ 'is-fail': !r.pass }"
            )
              span.SettingsSeasonalThemes__contrast-label {{ r.label }}
              span.SettingsSeasonalThemes__contrast-value {{ r.text }}
              span.SettingsSeasonalThemes__contrast-min 需 {{ r.min }}:1

          .SettingsSeasonalThemes__editor-foot
            button.SettingsSeasonalThemes__btn.is-ghost(
              type="button"
              :disabled="savingTokens"
              @click="ClickCancelTokens"
            ) 取消
            button.SettingsSeasonalThemes__btn.is-apply(
              type="button"
              :disabled="savingTokens"
              @click="ApiSaveTokens(t)"
            ) {{ savingTokens ? '儲存中…' : '儲存色票' }}

        //- Hero 主圖預覽 + 上傳
        .SettingsSeasonalThemes__hero
          .SettingsSeasonalThemes__hero-frame
            img.SettingsSeasonalThemes__hero-img(
              v-if="t.hero.bgImage"
              :src="t.hero.bgImage"
              :alt="t.name.zh + ' Hero'"
            )
            .SettingsSeasonalThemes__hero-empty(v-else) 純色背景（無主圖）
            .SettingsSeasonalThemes__hero-overlay(v-if="uploadingId === t.id") 處理中…
          input(
            :ref="SetFileInput(t.id)"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style="display:none"
            @change="(e) => OnHeroChange(e as Event, t)"
          )
          .SettingsSeasonalThemes__hero-actions
            button.SettingsSeasonalThemes__btn.is-ghost(
              type="button"
              :disabled="uploadingId === t.id"
              @click="ClickPickHero(t.id)"
            ) {{ t.hero.bgImage ? '更換主圖' : '上傳主圖' }}
            button.SettingsSeasonalThemes__btn.is-delete(
              v-if="t.hero.bgImage"
              type="button"
              :disabled="uploadingId === t.id"
              @click="ClickRemoveHero(t)"
            ) 移除

        //- 動作列
        .SettingsSeasonalThemes__card-foot
          button.SettingsSeasonalThemes__btn.is-ghost(
            type="button"
            :disabled="t.isDefault || togglingId === t.id"
            @click="ClickToggleEnabled(t)"
          ) {{ t.enabled ? '停用' : '啟用' }}
          button.SettingsSeasonalThemes__btn.is-ghost(
            type="button"
            :disabled="savingTokens"
            @click="editingId === t.id ? ClickCancelTokens() : ClickEditTokens(t)"
          ) {{ editingId === t.id ? '收起色票' : '編輯色票' }}
          button.SettingsSeasonalThemes__btn.is-apply(
            type="button"
            :disabled="t.id === activeThemeId || !t.enabled || applyingId === t.id"
            @click="ClickApply(t)"
          ) {{ t.id === activeThemeId ? '生效中' : (applyingId === t.id ? '切換中…' : '設為生效') }}
</template>

<style lang="scss" scoped>



.SettingsSeasonalThemes {
  display: flex;
  flex-direction: column;
}

.SettingsSeasonalThemes__hint {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  line-height: var(--lh-relaxed);
  color: var(--surface-a50);
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-a06);
}

.SettingsSeasonalThemes__loading,
.SettingsSeasonalThemes__empty {
  padding: 24px 16px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a40);
  text-align: center;
}

.SettingsSeasonalThemes__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
  padding: 16px;
}

.SettingsSeasonalThemes__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--surface-a06);
  background: var(--surface-a06);
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);

  &.is-active {
    border-color: var(--accent-a60);
    background: var(--accent-a06);
  }
  &.is-disabled { opacity: 0.55; }
}

.SettingsSeasonalThemes__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.SettingsSeasonalThemes__card-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.SettingsSeasonalThemes__card-zh {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 700;
  color: var(--surface-a96);
}

.SettingsSeasonalThemes__card-id {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--surface-a40);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}

.SettingsSeasonalThemes__badges {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.SettingsSeasonalThemes__badge {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  border-radius: var(--r-pill);
  padding: 1px 8px;
  border: 1px solid;

  &.is-active {
    color: var(--good);
    background: var(--good-a08);
    border-color: var(--good-a30);
  }
  &.is-default {
    color: var(--surface-a72);
    background: var(--surface-a06);
    border-color: var(--surface-a06);
  }
  &.is-off {
    color: var(--stop);
    background: var(--stop-a08);
    border-color: var(--stop-a30);
  }
}

.SettingsSeasonalThemes__card-sub {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--surface-a40);
}

.SettingsSeasonalThemes__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.SettingsSeasonalThemes__swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.SettingsSeasonalThemes__swatch-chip {
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a20);
}

.SettingsSeasonalThemes__swatch-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--surface-a40);
}

.SettingsSeasonalThemes__hero {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.SettingsSeasonalThemes__hero-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-md);
  border: 1px dashed var(--surface-a20);
  background: var(--ink-a20);
  overflow: hidden;
}

.SettingsSeasonalThemes__hero-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.SettingsSeasonalThemes__hero-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--surface-a30);
}

.SettingsSeasonalThemes__hero-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ink-a60);
  color: var(--surface-raised);
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
}

.SettingsSeasonalThemes__hero-actions,
.SettingsSeasonalThemes__card-foot {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.SettingsSeasonalThemes__card-foot {
  justify-content: flex-end;
  margin-top: 2px;
}

.SettingsSeasonalThemes__btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 6px 14px;
  border-radius: var(--r-sm);
  border: 1px solid;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-ghost {
    background: var(--surface-a06);
    border-color: var(--surface-a20);
    color: var(--surface-a72);
    &:hover:not(:disabled) { background: var(--surface-a12); color: var(--surface-raised); }
  }

  &.is-apply {
    background: var(--accent-a12);
    border-color: var(--accent-a40);
    color: var(--accent);
    &:hover:not(:disabled) { background: var(--accent-a20); }
  }

  &.is-delete {
    background: var(--stop-a08);
    border-color: var(--stop-a30);
    color: var(--stop);
    &:hover:not(:disabled) { background: var(--stop-a15); }
  }
}

.SettingsSeasonalThemes__mode {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--surface-a06);
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-pill);
  align-self: flex-start;
}

.SettingsSeasonalThemes__mode-btn {
  min-height: 26px;
  padding: 0 14px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--surface-a50);
  background: none;
  border: none;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.SettingsSeasonalThemes__mode-btn.is-on {
  color: var(--ink);
  background: var(--accent);
}

/* ── 色票編輯器（階段 2）──────────────────────────────────── */
.SettingsSeasonalThemes__editor {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--surface-a06);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.SettingsSeasonalThemes__editor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.SettingsSeasonalThemes__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.SettingsSeasonalThemes__field-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--surface-a72);
}

.SettingsSeasonalThemes__field-hint {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.SettingsSeasonalThemes__field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.SettingsSeasonalThemes__color {
  width: 30px;
  height: 30px;
  flex: none;
  padding: 0;
  border: 1px solid var(--surface-a20);
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
}

.SettingsSeasonalThemes__hex {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  font-family: var(--ff-mono);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-snug);
  color: var(--surface-a88);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-sm);
  transition: border-color var(--dur-fast) var(--ease-out);
}

.SettingsSeasonalThemes__hex:focus {
  outline: none;
  border-color: var(--accent);
}

.SettingsSeasonalThemes__contrast {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--surface-a06);
  border-radius: var(--r-sm);
}

.SettingsSeasonalThemes__contrast-head {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  color: var(--surface-a50);
  margin-bottom: 2px;
}

.SettingsSeasonalThemes__contrast-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: baseline;
  gap: 8px;
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a72);
}

.SettingsSeasonalThemes__contrast-row.is-fail {
  color: var(--stop);
}

.SettingsSeasonalThemes__contrast-value {
  font-family: var(--ff-mono);
  font-variant-numeric: tabular-nums;
}

.SettingsSeasonalThemes__contrast-min {
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.SettingsSeasonalThemes__contrast-row.is-fail .SettingsSeasonalThemes__contrast-min {
  color: var(--stop);
}

.SettingsSeasonalThemes__editor-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
