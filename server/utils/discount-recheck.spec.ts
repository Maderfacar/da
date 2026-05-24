import { describe, it, expect } from 'vitest';
import { recheckDiscountCode } from './discount-recheck';

// 簡易 fake Firestore：只支援 collection('discount_codes').doc(id).get()
type DocData = Record<string, unknown>;
function fakeDb(codeId: string, data: DocData | null): unknown {
  return {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (col === 'discount_codes' && id === codeId && data !== null) {
            return { exists: true, data: () => data };
          }
          return { exists: false, data: () => undefined };
        },
      }),
    }),
  };
}

function tsAt(epochMs: number): { toDate: () => Date } {
  return { toDate: () => new Date(epochMs) };
}

describe('recheckDiscountCode', () => {
  it('無折扣碼 → discountAmount=0、無 warning', async () => {
    const db = fakeDb('NONE', null) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: null,
      originalDiscountAmount: 0,
      orderType: 'airport-pickup',
      fareBeforeDiscount: 1000,
    });
    expect(r.discountAmount).toBe(0);
    expect(r.warning).toBeUndefined();
  });

  it('折扣碼 doc 不存在 → fallback 原 discountAmount + warning', async () => {
    const db = fakeDb('SUMMER25', null) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: 'SUMMER25',
      originalDiscountAmount: 100,
      orderType: 'airport-pickup',
      fareBeforeDiscount: 1000,
    });
    expect(r.discountAmount).toBe(100);
    expect(r.warning).toBe('expired_fallback');
  });

  it('折扣碼仍有效（時間區間內、enabled、minFare 達標）→ 用最新 discountAmount', async () => {
    const now = Date.now();
    const data: DocData = {
      discountAmount: 200,
      validFrom: tsAt(now - 86400000),
      validUntil: tsAt(now + 86400000),
      enabled: true,
      maxRedemptions: null,
      minFare: 500,
      allowedOrderTypes: null,
      redemptionCount: 5,
    };
    const db = fakeDb('VALID', data) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: 'VALID',
      originalDiscountAmount: 150, // 原本 150，admin 改 doc 後改 200
      orderType: 'airport-pickup',
      fareBeforeDiscount: 1000,
    });
    expect(r.discountAmount).toBe(200);
    expect(r.warning).toBeUndefined();
  });

  it('折扣碼已過期（validUntil < now）→ fallback', async () => {
    const now = Date.now();
    const data: DocData = {
      discountAmount: 200,
      validFrom: tsAt(now - 7 * 86400000),
      validUntil: tsAt(now - 86400000), // 昨天過期
      enabled: true,
      maxRedemptions: null,
      minFare: null,
      allowedOrderTypes: null,
      redemptionCount: 5,
    };
    const db = fakeDb('EXPIRED', data) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: 'EXPIRED',
      originalDiscountAmount: 150,
      orderType: 'airport-pickup',
      fareBeforeDiscount: 1000,
    });
    expect(r.discountAmount).toBe(150);
    expect(r.warning).toBe('expired_fallback');
  });

  it('折扣碼被 admin 停用 → fallback', async () => {
    const now = Date.now();
    const data: DocData = {
      discountAmount: 200,
      validFrom: tsAt(now - 86400000),
      validUntil: tsAt(now + 86400000),
      enabled: false, // 停用
      maxRedemptions: null,
      minFare: null,
      allowedOrderTypes: null,
      redemptionCount: 5,
    };
    const db = fakeDb('DISABLED', data) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: 'DISABLED',
      originalDiscountAmount: 150,
      orderType: 'airport-pickup',
      fareBeforeDiscount: 1000,
    });
    expect(r.discountAmount).toBe(150);
    expect(r.warning).toBe('expired_fallback');
  });

  it('新 fare 未達 minFare → fallback', async () => {
    const now = Date.now();
    const data: DocData = {
      discountAmount: 200,
      validFrom: tsAt(now - 86400000),
      validUntil: tsAt(now + 86400000),
      enabled: true,
      maxRedemptions: null,
      minFare: 1500, // 門檻 1500，新 fare 800 不達
      allowedOrderTypes: null,
      redemptionCount: 5,
    };
    const db = fakeDb('NEEDBIG', data) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: 'NEEDBIG',
      originalDiscountAmount: 100,
      orderType: 'airport-pickup',
      fareBeforeDiscount: 800,
    });
    expect(r.discountAmount).toBe(100);
    expect(r.warning).toBe('expired_fallback');
  });

  it('orderType 不在 allowedOrderTypes 內 → fallback', async () => {
    const now = Date.now();
    const data: DocData = {
      discountAmount: 200,
      validFrom: tsAt(now - 86400000),
      validUntil: tsAt(now + 86400000),
      enabled: true,
      maxRedemptions: null,
      minFare: null,
      allowedOrderTypes: ['charter'], // 只允許包車
      redemptionCount: 5,
    };
    const db = fakeDb('CHARTERONLY', data) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: 'CHARTERONLY',
      originalDiscountAmount: 100,
      orderType: 'airport-pickup',
      fareBeforeDiscount: 1000,
    });
    expect(r.discountAmount).toBe(100);
    expect(r.warning).toBe('expired_fallback');
  });

  it('discountAmount > fare → 鎖底到 fare（與 evaluateDiscountCode 一致）', async () => {
    const now = Date.now();
    const data: DocData = {
      discountAmount: 2000, // 折扣 > 車資
      validFrom: tsAt(now - 86400000),
      validUntil: tsAt(now + 86400000),
      enabled: true,
      maxRedemptions: null,
      minFare: null,
      allowedOrderTypes: null,
      redemptionCount: 0,
    };
    const db = fakeDb('HUGEDISCOUNT', data) as Parameters<typeof recheckDiscountCode>[0];
    const r = await recheckDiscountCode(db, {
      discountCode: 'HUGEDISCOUNT',
      originalDiscountAmount: 1000,
      orderType: 'airport-pickup',
      fareBeforeDiscount: 800,
    });
    expect(r.discountAmount).toBe(800); // min(2000, 800)
    expect(r.warning).toBeUndefined();
  });
});
