<script setup lang="ts">
// PassengerFaqList — Information Desk 式問答清單
// props.itemKeys：要顯示的 faq.items.<key> 清單（順序即顯示順序）
// 每題可展開 / 收合，預設全收合。
//
// W4 AEO（2026-06-25）：div + button + v-show → <details> + <summary> 語意化
// - 利於 a11y（瀏覽器原生 expanded/collapsed announcement）
// - SEO/AEO 友善：crawler 看到 details/summary 直接識別為 Q&A 配對
// - 保留 Vue ownership：openKey 控制 :open（single-open-at-a-time 行為不變）
// - @click.prevent 阻止瀏覽器原生 toggle，由 Vue 完全管轄狀態

interface Props {
  itemKeys: ReadonlyArray<string>;
}
const props = defineProps<Props>();

const openKey = ref<string>('');

const ClickToggle = (key: string) => {
  openKey.value = openKey.value === key ? '' : key;
};
</script>

<template lang="pug">
.PassengerFaqList
  details.PassengerFaqList__item(
    v-for="key in props.itemKeys"
    :key="key"
    :open="openKey === key"
    :class="{ 'is-open': openKey === key }"
  )
    summary.PassengerFaqList__q(
      @click.prevent="ClickToggle(key)"
    )
      span.PassengerFaqList__q-text {{ $t('faq.items.' + key + '.q') }}
      span.PassengerFaqList__q-mark {{ openKey === key ? '−' : '+' }}
    .PassengerFaqList__a
      p {{ $t('faq.items.' + key + '.a') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PassengerFaqList {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PassengerFaqList__item {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 14px;
  overflow: hidden;
  transition: border-color 0.15s;
}

.PassengerFaqList__item.is-open {
  border-color: rgba(212, 134, 10, 0.4);
}

.PassengerFaqList__q {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  // 隱藏 <summary> 預設展開三角形
  list-style: none;
  &::-webkit-details-marker { display: none; }
  &::marker { display: none; }
}

.PassengerFaqList__q-text {
  font-family: $font-body;
  font-size: 15px;
  font-weight: 600;
  color: var(--da-dark);
  line-height: 1.5;
}

.PassengerFaqList__q-mark {
  font-family: $font-display;
  font-size: 22px;
  color: var(--da-amber);
  flex-shrink: 0;
  line-height: 1;
}

.PassengerFaqList__a {
  padding: 0 18px 18px;
}

.PassengerFaqList__a p {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 300;
  color: var(--da-gray);
  line-height: 1.75;
}
</style>
