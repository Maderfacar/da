<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const authStore = StoreAuth();
const { lineProfile, user, isFriend, isSignIn } = storeToRefs(authStore);

const config = useRuntimeConfig().public;
const lineOaUrl = config.lineOaAddUrl as string;
</script>

<template lang="pug">
.PageProfile
  .PageProfile__header
    .PageProfile__header-label MY ACCOUNT
    h1.PageProfile__header-title 個人資料

  //- 使用者資訊卡
  .PageProfile__card(v-if="isSignIn && lineProfile")
    img.PageProfile__avatar(
      :src="lineProfile.pictureUrl"
      :alt="lineProfile.displayName"
    )
    .PageProfile__info
      .PageProfile__name {{ lineProfile.displayName }}
      .PageProfile__uid UID: {{ user?.uid }}

    //- LINE 好友狀態
    .PageProfile__friend-status(v-if="isFriend !== null")
      span.PageProfile__friend-dot(:class="{ 'is-friend': isFriend }")
      span {{ isFriend ? '已加入 LINE 官方帳號' : '尚未加入 LINE 官方帳號' }}

    //- 加好友連結
    a.PageProfile__add-friend(
      v-if="isFriend === false && lineOaUrl"
      :href="lineOaUrl"
      target="_blank"
      rel="noopener"
    ) + 加入官方帳號（接收訂單通知）

  //- 未登入
  .PageProfile__unauth(v-else)
    .PageProfile__unauth-icon 👤
    p.PageProfile__unauth-text 尚未登入
</template>

<style lang="scss" scoped>
$bg: #0d1117;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.07);
$amber: #d4860a;

.PageProfile {
  padding: 72px 16px 120px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

// ── 頁首 ───────────────────────────────────────────────────────
.PageProfile__header {
  margin-bottom: 20px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.25em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    &::before { content: ''; width: 16px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 32px;
    letter-spacing: 0.04em;
    color: #fff;
  }
}

// ── 使用者卡 ──────────────────────────────────────────────────
.PageProfile__card {
  background: $surface;
  border: 1px solid $border;
  border-radius: 20px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  margin-bottom: 20px;
}

.PageProfile__avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba($amber, 0.4);
}

.PageProfile__name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.04em;
}

.PageProfile__uid {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
  font-family: 'Barlow Condensed', sans-serif;
  letter-spacing: 0.05em;
}

// ── LINE 好友狀態 ──────────────────────────────────────────────
.PageProfile__friend-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.PageProfile__friend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  flex-shrink: 0;

  &.is-friend { background: #4ade80; }
}

.PageProfile__add-friend {
  display: inline-block;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 18px;
  border-radius: 100px;
  background: #06C755;
  color: #fff;
  text-decoration: none;
}

// ── 未登入 ────────────────────────────────────────────────────
.PageProfile__unauth {
  text-align: center;
  padding: 60px 20px;

  &-icon { font-size: 48px; margin-bottom: 12px; }

  &-text {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.4);
  }
}

</style>
