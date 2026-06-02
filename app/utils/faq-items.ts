// FAQ 題庫定義 — q/a 文字皆走 i18n（faq.items.<key>.q / .a）
// FAQ_CATEGORIES：/faq 完整題庫，依分類分組
// FAQ_HOME_PICKS：首頁精選 FAQ 題目 key（取 5 題跨分類）

export interface FaqCategory {
  /** i18n key faq.categories.<id> */
  id: string;
  /** i18n key faq.items.<key> 清單 */
  itemKeys: string[];
}

export const FAQ_CATEGORIES: ReadonlyArray<FaqCategory> = [
  { id: 'booking', itemKeys: ['bookingHow', 'bookingWhen', 'bookingDriver'] },
  { id: 'payment', itemKeys: ['paymentHow', 'paymentCard', 'paymentWhen', 'fareSurcharge'] },
  { id: 'service', itemKeys: ['serviceArrive', 'servicePickup', 'serviceDelay'] },
  { id: 'change',  itemKeys: ['changeCancel', 'changeModify'] },
  { id: 'luggage', itemKeys: ['luggageCount', 'luggageMany'] },
  { id: 'other',   itemKeys: ['otherArea', 'otherChildSeat', 'otherContact'] },
];

/** 首頁精選 FAQ：跨分類挑 5 題最常問的 */
export const FAQ_HOME_PICKS: ReadonlyArray<string> = [
  'bookingHow', 'paymentHow', 'serviceDelay', 'changeCancel', 'otherArea',
];
