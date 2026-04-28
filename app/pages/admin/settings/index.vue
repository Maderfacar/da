<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

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
</script>

<template lang="pug">
.PageAdminSettings
  .PageAdminSettings__header
    .PageAdminSettings__header-label SYSTEM SETTINGS
    h1.PageAdminSettings__header-title 系統設定

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
}

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
