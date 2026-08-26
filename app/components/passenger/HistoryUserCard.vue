<script setup lang="ts">
// PassengerHistoryUserCard — 歷史訂單頁的使用者頭像卡（原 /profile 頂部卡片）
const authStore = StoreAuth();
const { lineProfile, isFriend, isSignIn } = storeToRefs(authStore);
// 認證根治 P3 後：server OAuth 登入 user=null，改走 currentLineUid（避免 UID 顯示 undefined）
const currentLineUid = computed(() => authStore.currentLineUid);
const lineOaUrl = useRuntimeConfig().public.lineOaAddUrl as string;
</script>

<template lang="pug">
.PassengerHistoryUserCard(v-if="isSignIn && lineProfile")
  img.PassengerHistoryUserCard__avatar(
    :src="lineProfile.pictureUrl"
    :alt="lineProfile.displayName"
  )
  .PassengerHistoryUserCard__info
    .PassengerHistoryUserCard__name {{ lineProfile.displayName }}
    .PassengerHistoryUserCard__uid UID: {{ currentLineUid }}

  //- LINE 好友狀態
  .PassengerHistoryUserCard__friend(v-if="isFriend !== null")
    span.PassengerHistoryUserCard__friend-dot(:class="{ 'is-friend': isFriend }")
    span {{ isFriend ? '已加入 LINE 官方帳號' : '尚未加入 LINE 官方帳號' }}

  //- 加好友連結
  a.PassengerHistoryUserCard__add(
    v-if="isFriend === false && lineOaUrl"
    :href="lineOaUrl"
    target="_blank"
    rel="noopener"
  ) + 加入官方帳號（接收訂單通知）
</template>

<style lang="scss" scoped>

.PassengerHistoryUserCard {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 24px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  margin-bottom: 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}

.PassengerHistoryUserCard__avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--accent-a50);
}

.PassengerHistoryUserCard__name {
  font-family: var(--ff-label);
  font-size: 20px;
  font-weight: 700;
  color: var(--da-dark);
  letter-spacing: 0.04em;
}

.PassengerHistoryUserCard__uid {
  font-family: var(--ff-label);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--da-gray-light);
}

.PassengerHistoryUserCard__friend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ff-ui);
  font-size: 12px;
  color: var(--da-gray);
}

.PassengerHistoryUserCard__friend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--da-gray-pale);
  flex-shrink: 0;

  &.is-friend { background: #16a34a; }
}

.PassengerHistoryUserCard__add {
  display: inline-block;
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 18px;
  border-radius: 100px;
  background: #06c755;
  color: #fff;
  text-decoration: none;
}
</style>
