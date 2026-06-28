// Admin 折扣碼 types（對齊 server/utils/discount-code.ts DiscountCodeDto）

/**
 * 折扣碼來源：
 *   - admin：admin 後台手動建立（一般碼）
 *   - referral-welcome / referral-reward：推薦系統鑄造（admin 不可編輯）
 *   - driver-referral：歸屬某司機的推薦碼（admin 建立、ownerUid 為司機 lineUid）
 */
export type DiscountCodeSource = 'admin' | 'referral-welcome' | 'referral-reward' | 'driver-referral';

export interface DiscountCodeDto {
  code: string;
  discountAmount: number;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  perUserLimit: number | null;
  minFare: number | null;
  allowedOrderTypes: string[] | null;
  enabled: boolean;
  redemptionCount: number;
  createdBy: string;
  createdAt: string | null;
  updatedBy: string;
  updatedAt: string | null;
  source: DiscountCodeSource;
  /** source='driver-referral' 時為司機 lineUid；其他來源為 null */
  ownerUid: string | null;
}

export interface DiscountCodeListRes {
  items: DiscountCodeDto[];
}

/** 建立 / 更新折扣碼的 body（更新時 code 由 route param 提供，不放 body） */
export interface DiscountCodeWriteBody {
  discountAmount: number;
  /** ISO 字串；不填 = 立即生效 */
  validFrom?: string | null;
  /** ISO 字串，必填 */
  validUntil: string;
  maxRedemptions?: number | null;
  perUserLimit?: number | null;
  minFare?: number | null;
  allowedOrderTypes?: string[] | null;
  enabled?: boolean;
  /** admin 後台僅可建立 'admin' / 'driver-referral'；不填預設 'admin' */
  source?: 'admin' | 'driver-referral';
  /** source='driver-referral' 時必填司機 lineUid */
  ownerUid?: string | null;
}

export interface CreateDiscountCodeBody extends DiscountCodeWriteBody {
  code: string;
}
