<script setup lang="ts">
// P37 Phase 3.3：公告即時預覽（LINE Flex + App 卡片視覺模擬）
//
// 「視覺模擬」≠ LINE Flex Simulator 100% 還原。
// 目的：給 admin 一個直覺對照——標題 / body / 封面 / CTA 在兩個渠道大致長什麼樣。
// 真正 LINE Flex 結構由 Phase 4 server/utils/announcement-flex.ts 組裝。

interface CtaButton {
  label: string;
  url: string;
}

interface Props {
  title: string;
  body: string;            // HTML（TinyEditor 輸出）
  coverImageUrl: string | null;
  ctaButton: CtaButton | null;
}

const props = defineProps<Props>();

// LINE Flex 用：body 去 tag + 200 字 preview（對齊 server announcement-flex 規格）
const lineBodyPreview = computed(() => {
  return props.body
    .replace(/<[^>]+>/g, '')   // strip HTML tag
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
});

// App 內卡片直接 v-html，僅做最低限度 sanitize（移除 <script> / on*）
const appBodyHtml = computed(() => {
  return props.body
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
});

const displayTitle = computed(() => props.title.trim() || '（未輸入標題）');
</script>

<template lang="pug">
.AnnouncementPreview
  //- ── LINE Flex 模擬 ───────────────────────────────────────────
  section.AnnouncementPreview__section
    .AnnouncementPreview__sectionLabel LINE FLEX MESSAGE
    .AnnouncementPreview__lineCard
      img.AnnouncementPreview__lineHero(
        v-if="coverImageUrl"
        :src="coverImageUrl"
        alt="cover"
      )
      .AnnouncementPreview__lineBody
        .AnnouncementPreview__lineTitle {{ displayTitle }}
        .AnnouncementPreview__lineText(v-if="lineBodyPreview") {{ lineBodyPreview }}
        .AnnouncementPreview__linePlaceholder(v-else) （未輸入內文）
      .AnnouncementPreview__lineFooter(v-if="ctaButton && ctaButton.label && ctaButton.url")
        button.AnnouncementPreview__lineButton(disabled)
          | {{ ctaButton.label }}

  //- ── App 內卡片模擬 ──────────────────────────────────────────
  section.AnnouncementPreview__section
    .AnnouncementPreview__sectionLabel APP NOTIFICATION CARD
    article.AnnouncementPreview__appCard
      img.AnnouncementPreview__appHero(
        v-if="coverImageUrl"
        :src="coverImageUrl"
        alt="cover"
      )
      .AnnouncementPreview__appBody
        h3.AnnouncementPreview__appTitle {{ displayTitle }}
        .AnnouncementPreview__appText(v-if="appBodyHtml" v-html="appBodyHtml")
        .AnnouncementPreview__appPlaceholder(v-else) （未輸入內文）
        a.AnnouncementPreview__appButton(
          v-if="ctaButton && ctaButton.label && ctaButton.url"
          @click.prevent
        )
          | {{ ctaButton.label }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.4);
$border: rgba(255, 255, 255, 0.08);

.AnnouncementPreview {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.AnnouncementPreview__section { }

.AnnouncementPreview__sectionLabel {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: $muted;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;

  &::before {
    content: '';
    width: 16px;
    height: 1.5px;
    background: $amber;
  }
}

// ── LINE Flex ─────────────────────────────────────────────────
.AnnouncementPreview__lineCard {
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  max-width: 320px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
  color: #222;
}

.AnnouncementPreview__lineHero {
  width: 100%;
  aspect-ratio: 20 / 13;
  object-fit: cover;
  display: block;
}

.AnnouncementPreview__lineBody {
  padding: 14px 16px 8px;
}

.AnnouncementPreview__lineTitle {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #222;
  line-height: 1.4;
  margin-bottom: 6px;
}

.AnnouncementPreview__lineText {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.AnnouncementPreview__linePlaceholder {
  font-size: 12px;
  color: #bbb;
  font-style: italic;
}

.AnnouncementPreview__lineFooter {
  padding: 8px 12px 14px;
}

.AnnouncementPreview__lineButton {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: none;
  background: $amber;
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: default;
  opacity: 0.95;
}

// ── App Card ──────────────────────────────────────────────────
.AnnouncementPreview__appCard {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid $border;
  border-radius: 14px;
  overflow: hidden;
  max-width: 360px;
}

.AnnouncementPreview__appHero {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
}

.AnnouncementPreview__appBody {
  padding: 14px 16px 16px;
}

.AnnouncementPreview__appTitle {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  line-height: 1.4;
  margin: 0 0 8px;
}

.AnnouncementPreview__appText {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.6;
  word-break: break-word;

  // 最少限度排版（避免 v-html 內排版崩掉）
  :deep(p) { margin: 0 0 6px; }
  :deep(a) { color: $amber; text-decoration: underline; }
  :deep(strong) { font-weight: 700; color: #fff; }
  :deep(ul), :deep(ol) { margin: 4px 0 6px 18px; }
  :deep(img) { max-width: 100%; border-radius: 6px; margin: 6px 0; }
}

.AnnouncementPreview__appPlaceholder {
  font-size: 12px;
  color: $muted;
  font-style: italic;
}

.AnnouncementPreview__appButton {
  display: inline-block;
  margin-top: 12px;
  padding: 8px 18px;
  border-radius: 100px;
  background: rgba($amber, 0.18);
  border: 1px solid rgba($amber, 0.5);
  color: $amber;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  text-decoration: none;
}
</style>
