// Fare 重算公用 util（Wave 1C — admin 訂單 tag 後修專用）
//
// 設計重點：
//   - 訂單 tag 後修不重跑 Routes API / Fare V2 路線運算（路線、上車時間、車型未變）
//   - 沿用 orders/index.post.ts 的車資組裝順序：
//       fareBeforeDiscount = baseFare（Fare V2 路線基底，不含 tags / discount）
//       finalTotal         = max(0, fareBeforeDiscount - discountAmount + tagSurcharge)
//   - Math.max(0, ...) 與建單一致（折扣比車資大時鎖底）
//
// 此檔純函式、無 Firestore 依賴，shared/__tests__ 可直接覆蓋。

export interface RecalcFinalTotalInput {
  /** Fare V2 路線基底車資（不含 tagSurcharge / discountAmount） */
  fareBeforeDiscount: number;
  /** 重算後折扣金額（已通過 evaluateDiscountCode 計算或 fallback 既有值） */
  discountAmount: number;
  /** 重算後偏好標籤加價（max(snapshot.surchargeAmount)；無命中為 0） */
  tagSurcharge: number;
}

export interface RecalcFinalTotalResult {
  /** 折扣前車資（不含 tagSurcharge）— 與 orders/index.post.ts 寫入欄位一致 */
  fareBeforeDiscount: number;
  /** 折扣金額 */
  discountAmount: number;
  /** tag 加價 */
  tagSurcharge: number;
  /** 訂單最終車資 = max(0, fareBeforeDiscount - discountAmount + tagSurcharge) */
  finalTotal: number;
}

/**
 * 重新計算訂單 finalTotal（route 不變、僅 tag / discount 改動時用）。
 */
export function recalcFinalTotal(input: RecalcFinalTotalInput): RecalcFinalTotalResult {
  const fareBeforeDiscount = sanitizeNonNeg(input.fareBeforeDiscount);
  const discountAmount = sanitizeNonNeg(input.discountAmount);
  const tagSurcharge = sanitizeNonNeg(input.tagSurcharge);
  const finalTotal = Math.max(0, fareBeforeDiscount - discountAmount + tagSurcharge);
  return { fareBeforeDiscount, discountAmount, tagSurcharge, finalTotal };
}

/** 把 finalTotal 拆成差額（before vs after） */
export interface FareDiff {
  fareBeforeDiscount: number;
  discountAmount: number;
  tagSurcharge: number;
  finalTotal: number;
}

export function diffFare(before: FareDiff, after: FareDiff): FareDiff {
  return {
    fareBeforeDiscount: after.fareBeforeDiscount - before.fareBeforeDiscount,
    discountAmount: after.discountAmount - before.discountAmount,
    tagSurcharge: after.tagSurcharge - before.tagSurcharge,
    finalTotal: after.finalTotal - before.finalTotal,
  };
}

function sanitizeNonNeg(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}
