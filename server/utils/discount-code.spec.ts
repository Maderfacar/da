import { describe, it, expect } from 'vitest';
import { validateDiscountCodeBody, normalizeDiscountCode } from './discount-code';

describe('normalizeDiscountCode', () => {
  it('轉大寫並去空白', () => {
    const r = normalizeDiscountCode('  welcome100 ');
    expect(r).toEqual({ ok: true, value: 'WELCOME100' });
  });

  it('過短的 code 回 error', () => {
    const r = normalizeDiscountCode('AB');
    expect(r.ok).toBe(false);
  });

  it('含符號的 code 回 error', () => {
    const r = normalizeDiscountCode('WELCOME-100');
    expect(r.ok).toBe(false);
  });
});

describe('validateDiscountCodeBody', () => {
  const base = { discountAmount: 100, validUntil: '2099-12-31T00:00:00Z' };

  it('合法 body：回正規化值', () => {
    const r = validateDiscountCodeBody({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.discountAmount).toBe(100);
      expect(r.value.validFromMs).toBeNull();
      expect(r.value.enabled).toBe(true);
    }
  });

  it('discountAmount <= 0 回 error', () => {
    expect(validateDiscountCodeBody({ ...base, discountAmount: 0 }).ok).toBe(false);
  });

  it('validUntil 缺失回 error', () => {
    expect(validateDiscountCodeBody({ discountAmount: 100 }).ok).toBe(false);
  });

  it('validFrom 晚於 validUntil 回 error', () => {
    const r = validateDiscountCodeBody({
      discountAmount: 100,
      validFrom: '2099-12-31T00:00:00Z',
      validUntil: '2026-01-01T00:00:00Z',
    });
    expect(r.ok).toBe(false);
  });

  it('allowedOrderTypes 含非法值回 error', () => {
    expect(validateDiscountCodeBody({ ...base, allowedOrderTypes: ['charter', 'bogus'] }).ok).toBe(false);
  });

  it('allowedOrderTypes 空陣列正規化為 null', () => {
    const r = validateDiscountCodeBody({ ...base, allowedOrderTypes: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.allowedOrderTypes).toBeNull();
  });

  it('maxRedemptions 為負數回 error', () => {
    expect(validateDiscountCodeBody({ ...base, maxRedemptions: -1 }).ok).toBe(false);
  });
});
