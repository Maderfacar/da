/**
 * 折扣碼重檢 helper（Wave 1C — admin 訂單 tag 後修專用）
 *
 * 用途：admin 改 tag 觸發車資重算時，原本套在訂單上的折扣碼需重新評估：
 *   - 折扣碼仍有效（enabled / 在時間區間 / minFare 仍達標 / 行程類型仍允許）
 *     → 使用最新 discountAmount（金額是否異動端看 admin 後台是否改過 discount_codes doc）
 *   - 折扣碼失效（過期 / 停用 / 不存在 / minFare 不達標 等）
 *     → fallback 原訂單的 discountAmount + warning='expired_fallback'
 *
 * 重要：
 *   - **不**呼叫 redeemDiscountCode（不重複扣 redemption usage）
 *   - **不**驗 perUserLimit（admin 後修場景無此風險，且 transaction 內也驗不到）
 *   - 訂單原本就沒套折扣碼（discountCode 為空）→ 直接回 { discountAmount: 0 }
 */
import type { Firestore } from 'firebase-admin/firestore';
import {
  evaluateDiscountCode,
  normalizeDiscountCode,
  type DiscountCodeDoc,
  type DiscountCodeEvalData,
} from '@@/utils/discount-code';

export type DiscountRecheckWarning = 'expired_fallback';

export interface DiscountRecheckInput {
  /** 訂單原本套用的折扣碼字串（已 normalize 大寫；空字串 / null 表示沒折扣） */
  discountCode: string | null | undefined;
  /** 訂單原本的 discountAmount（fallback 用） */
  originalDiscountAmount: number;
  /** 訂單 orderType（再驗 allowedOrderTypes 用） */
  orderType: string;
  /** 新車資（folder discount 前）— 通常 tag 改動時 baseFare 不變，仍要傳供 minFare 比對 */
  fareBeforeDiscount: number;
}

export interface DiscountRecheckResult {
  /** 重檢後的 discountAmount（折扣碼仍有效時用新值；失效則 fallback 原值；無碼為 0） */
  discountAmount: number;
  /** 失效時帶 warning，呼叫端可顯示給 admin */
  warning?: DiscountRecheckWarning;
}

function tsToMs(v: unknown): number | null {
  const d = (v as { toDate?: () => Date } | null)?.toDate?.();
  return d ? d.getTime() : null;
}

function toEvalData(d: Partial<DiscountCodeDoc>): DiscountCodeEvalData {
  return {
    discountAmount: typeof d.discountAmount === 'number' ? d.discountAmount : 0,
    validFromMs: tsToMs(d.validFrom),
    validUntilMs: tsToMs(d.validUntil) ?? 0,
    maxRedemptions: typeof d.maxRedemptions === 'number' ? d.maxRedemptions : null,
    // perUserLimit 與 admin 後修場景無關，本 util 不再復查（已超過建單時的 validate）
    perUserLimit: null,
    minFare: typeof d.minFare === 'number' ? d.minFare : null,
    allowedOrderTypes: Array.isArray(d.allowedOrderTypes) ? d.allowedOrderTypes : null,
    enabled: d.enabled === true,
    redemptionCount: typeof d.redemptionCount === 'number' ? d.redemptionCount : 0,
  };
}

/**
 * 重檢訂單原本套用的折扣碼。
 *
 * 失敗（含 NOT_FOUND / DISABLED / EXPIRED / ORDER_TYPE_NOT_ALLOWED / BELOW_MIN_FARE /
 * GLOBAL_LIMIT_REACHED）→ fallback 原訂單 discountAmount + warning='expired_fallback'。
 * 即使 admin 後台改動 discountAmount，本 util 仍照當前最新值套用（小於 minFare 才退回）。
 */
export async function recheckDiscountCode(
  db: Firestore,
  input: DiscountRecheckInput,
): Promise<DiscountRecheckResult> {
  const rawCode = typeof input.discountCode === 'string' ? input.discountCode.trim() : '';
  if (!rawCode) {
    // 訂單原本無折扣碼 → 0
    return { discountAmount: 0 };
  }

  const norm = normalizeDiscountCode(rawCode);
  if (!norm.ok) {
    // 訂單存的碼格式異常（理論上不會發生）→ fallback
    return {
      discountAmount: sanitizeNonNeg(input.originalDiscountAmount),
      warning: 'expired_fallback',
    };
  }

  const snap = await db.collection('discount_codes').doc(norm.value).get();
  if (!snap.exists) {
    return {
      discountAmount: sanitizeNonNeg(input.originalDiscountAmount),
      warning: 'expired_fallback',
    };
  }

  const data = snap.data() as Partial<DiscountCodeDoc>;
  const result = evaluateDiscountCode({
    code: toEvalData(data),
    fare: sanitizeNonNeg(input.fareBeforeDiscount),
    orderType: input.orderType,
    userRedemptionCount: 0, // perUserLimit 不在後修場景復查
    nowMs: Date.now(),
  });

  if (!result.ok) {
    return {
      discountAmount: sanitizeNonNeg(input.originalDiscountAmount),
      warning: 'expired_fallback',
    };
  }

  return { discountAmount: result.discountAmount };
}

function sanitizeNonNeg(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}
