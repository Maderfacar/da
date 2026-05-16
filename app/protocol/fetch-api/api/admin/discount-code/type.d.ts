// Admin 折扣碼 types（對齊 server/utils/discount-code.ts DiscountCodeDto）

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
}

export interface CreateDiscountCodeBody extends DiscountCodeWriteBody {
  code: string;
}
