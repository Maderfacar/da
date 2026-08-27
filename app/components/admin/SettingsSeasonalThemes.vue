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
</script>

<template lang="pug">
.SettingsSeasonalThemes
  .SettingsSeasonalThemes__hint
    | 切換乘客端整組配色與首頁 Hero 主視覺；換色只影響乘客端，司機端與後台外觀不變。
    | 首發僅提供切換 / 啟用停用 / 更換 Hero 主圖，色票由系統預設（如需改色請通知工程）。

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
  font-size: 12px;
  line-height: 1.6;
  color: var(--surface-a50);
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-a06);
}

.SettingsSeasonalThemes__loading,
.SettingsSeasonalThemes__empty {
  padding: 24px 16px;
  font-family: var(--ff-label);
  font-size: 12px;
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
  font-size: 15px;
  font-weight: 700;
  color: var(--surface-a96);
}

.SettingsSeasonalThemes__card-id {
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
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
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
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
  font-size: 11px;
  letter-spacing: 0.04em;
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
  font-size: 9px;
  letter-spacing: 0.04em;
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
  font-size: 11px;
  letter-spacing: 0.06em;
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
  font-size: 12px;
  letter-spacing: 0.1em;
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
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
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
</style>
