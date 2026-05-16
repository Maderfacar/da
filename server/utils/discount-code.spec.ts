import { describe, it, expect } from 'vitest';
import { validateDiscountCodeBody, normalizeDiscountCode, toDiscountCodeDto } from './discount-code';

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

  it('allowedOrderTypes 含非字串元素回 error', () => {
    expect(validateDiscountCodeBody({ ...base, allowedOrderTypes: [1, 'charter'] }).ok).toBe(false);
  });
});

describe('toDiscountCodeDto', () => {
  it('Timestamp 欄位轉 ISO string', () => {
    const fakeTs = { toDate: () => new Date('2026-05-16T00:00:00.000Z') };
    const dto = toDiscountCodeDto({
      code: 'WELCOME100',
      discountAmount: 100,
      validFrom: fakeTs as never,
      validUntil: fakeTs as never,
      enabled: true,
      redemptionCount: 3,
      createdAt: fakeTs as never,
      updatedAt: fakeTs as never,
      createdBy: 'lineUid1',
      updatedBy: 'lineUid2',
    });
    expect(dto.validUntil).toBe('2026-05-16T00:00:00.000Z');
    expect(dto.discountAmount).toBe(100);
    expect(dto.redemptionCount).toBe(3);
  });

  it('缺失欄位回 fallback 預設值', () => {
    const dto = toDiscountCodeDto({ code: 'EMPTY' });
    expect(dto.discountAmount).toBe(0);
    expect(dto.validFrom).toBeNull();
    expect(dto.validUntil).toBeNull();
    expect(dto.maxRedemptions).toBeNull();
    expect(dto.allowedOrderTypes).toBeNull();
    expect(dto.enabled).toBe(false);
    expect(dto.redemptionCount).toBe(0);
    expect(dto.createdBy).toBe('');
  });
});
