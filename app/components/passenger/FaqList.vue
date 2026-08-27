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

.PassengerFaqList {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PassengerFaqList__item {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  overflow: hidden;
  transition: border-color var(--dur-fast) var(--ease-out);
}

.PassengerFaqList__item.is-open {
  border-color: var(--accent-a40);
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
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--da-dark);
  line-height: var(--lh-normal);
}

.PassengerFaqList__q-mark {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  color: var(--da-amber);
  flex-shrink: 0;
  line-height: var(--lh-flat);
}

.PassengerFaqList__a {
  padding: 0 18px 18px;
}

.PassengerFaqList__a p {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 300;
  color: var(--da-gray);
  line-height: var(--lh-relaxed);
}
</style>
