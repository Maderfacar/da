import { describe, it, expect } from 'vitest';
import { recalcFinalTotal, diffFare } from './recalc';

describe('recalcFinalTotal', () => {
  it('無折扣 / 無 tag → finalTotal = fareBeforeDiscount', () => {
    const r = recalcFinalTotal({ fareBeforeDiscount: 1000, discountAmount: 0, tagSurcharge: 0 });
    expect(r.finalTotal).toBe(1000);
    expect(r.fareBeforeDiscount).toBe(1000);
    expect(r.discountAmount).toBe(0);
    expect(r.tagSurcharge).toBe(0);
  });

  it('有 tag、無折扣 → finalTotal = fareBeforeDiscount + tagSurcharge', () => {
    const r = recalcFinalTotal({ fareBeforeDiscount: 1000, discountAmount: 0, tagSurcharge: 200 });
    expect(r.finalTotal).toBe(1200);
  });

  it('有折扣、無 tag → finalTotal = fareBeforeDiscount - discountAmount', () => {
    const r = recalcFinalTotal({ fareBeforeDiscount: 1000, discountAmount: 150, tagSurcharge: 0 });
    expect(r.finalTotal).toBe(850);
  });

  it('折扣 + tag 同時存在 → 公式正確', () => {
    const r = recalcFinalTotal({ fareBeforeDiscount: 1500, discountAmount: 100, tagSurcharge: 300 });
    expect(r.finalTotal).toBe(1700);
  });

  it('折扣 > 車資 → finalTotal 鎖 0（不為負）', () => {
    const r = recalcFinalTotal({ fareBeforeDiscount: 500, discountAmount: 800, tagSurcharge: 0 });
    expect(r.finalTotal).toBe(0);
  });

  it('折扣 > 車資 但有 tag → tag 可拉回車資', () => {
    const r = recalcFinalTotal({ fareBeforeDiscount: 500, discountAmount: 800, tagSurcharge: 400 });
    expect(r.finalTotal).toBe(100); // 500 - 800 + 400 = 100
  });

  it('非數字輸入 → 視為 0', () => {
    const r = recalcFinalTotal({
      fareBeforeDiscount: NaN as unknown as number,
      discountAmount: undefined as unknown as number,
      tagSurcharge: -50,
    });
    expect(r.fareBeforeDiscount).toBe(0);
    expect(r.discountAmount).toBe(0);
    expect(r.tagSurcharge).toBe(0); // 負數視為 0
    expect(r.finalTotal).toBe(0);
  });
});

describe('diffFare', () => {
  it('全相同 → diff 全 0', () => {
    const base = { fareBeforeDiscount: 1000, discountAmount: 100, tagSurcharge: 50, finalTotal: 950 };
    expect(diffFare(base, base)).toEqual({
      fareBeforeDiscount: 0,
      discountAmount: 0,
      tagSurcharge: 0,
      finalTotal: 0,
    });
  });

  it('after tagSurcharge 上升 50 → diff.tagSurcharge = 50 / diff.finalTotal = 50', () => {
    const before = { fareBeforeDiscount: 1000, discountAmount: 100, tagSurcharge: 50, finalTotal: 950 };
    const after = { fareBeforeDiscount: 1000, discountAmount: 100, tagSurcharge: 100, finalTotal: 1000 };
    const d = diffFare(before, after);
    expect(d.tagSurcharge).toBe(50);
    expect(d.finalTotal).toBe(50);
  });

  it('discountAmount 下降（折扣失效 fallback 為 0）→ diff.discountAmount 為負', () => {
    const before = { fareBeforeDiscount: 1000, discountAmount: 100, tagSurcharge: 0, finalTotal: 900 };
    const after = { fareBeforeDiscount: 1000, discountAmount: 0, tagSurcharge: 0, finalTotal: 1000 };
    const d = diffFare(before, after);
    expect(d.discountAmount).toBe(-100);
    expect(d.finalTotal).toBe(100);
  });
});
