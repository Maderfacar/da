import { describe, it, expect } from 'vitest';
import {
  validateDiscountCodeBody,
  normalizeDiscountCode,
  toDiscountCodeDto,
  evaluateDiscountCode,
  isDiscountCodeActive,
  type DiscountCodeEvalData,
} from './discount-code';

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

  it('缺 source/ownerUid 時回 admin / null', () => {
    const dto = toDiscountCodeDto({ code: 'LEGACY' });
    expect(dto.source).toBe('admin');
    expect(dto.ownerUid).toBeNull();
  });

  it('保留 referral 來源與 ownerUid', () => {
    const dto = toDiscountCodeDto({
      code: 'WLCABCDEFGH',
      source: 'referral-welcome',
      ownerUid: 'Uxxxx',
    });
    expect(dto.source).toBe('referral-welcome');
    expect(dto.ownerUid).toBe('Uxxxx');
  });

  it('非法 source 值回退為 admin', () => {
    const dto = toDiscountCodeDto({ code: 'BOGUS', source: 'hacker' as never });
    expect(dto.source).toBe('admin');
  });
});

describe('evaluateDiscountCode', () => {
  const NOW = Date.UTC(2026, 4, 16, 0, 0, 0); // 2026-05-16
  const DAY = 86_400_000;

  const baseCode = (over: Partial<DiscountCodeEvalData> = {}): DiscountCodeEvalData => ({
    discountAmount: 100,
    validFromMs: null,
    validUntilMs: NOW + 30 * DAY,
    maxRedemptions: null,
    perUserLimit: null,
    minFare: null,
    allowedOrderTypes: null,
    enabled: true,
    redemptionCount: 0,
    ...over,
  });

  const ctx = { fare: 1000, orderType: 'charter', userRedemptionCount: 0, nowMs: NOW };

  it('碼不存在回 NOT_FOUND', () => {
    const r = evaluateDiscountCode({ code: null, ...ctx });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('停用回 DISABLED', () => {
    const r = evaluateDiscountCode({ code: baseCode({ enabled: false }), ...ctx });
    expect(r).toMatchObject({ ok: false, code: 'DISABLED' });
  });

  it('未到生效日回 NOT_STARTED', () => {
    const r = evaluateDiscountCode({ code: baseCode({ validFromMs: NOW + DAY }), ...ctx });
    expect(r).toMatchObject({ ok: false, code: 'NOT_STARTED' });
  });

  it('已過期回 EXPIRED', () => {
    const r = evaluateDiscountCode({ code: baseCode({ validUntilMs: NOW - DAY }), ...ctx });
    expect(r).toMatchObject({ ok: false, code: 'EXPIRED' });
  });

  it('行程類型不符回 ORDER_TYPE_NOT_ALLOWED', () => {
    const r = evaluateDiscountCode({ code: baseCode({ allowedOrderTypes: ['transfer'] }), ...ctx });
    expect(r).toMatchObject({ ok: false, code: 'ORDER_TYPE_NOT_ALLOWED' });
  });

  it('車資低於門檻回 BELOW_MIN_FARE', () => {
    const r = evaluateDiscountCode({ code: baseCode({ minFare: 2000 }), ...ctx });
    expect(r).toMatchObject({ ok: false, code: 'BELOW_MIN_FARE' });
  });

  it('全域上限已滿回 GLOBAL_LIMIT_REACHED', () => {
    const r = evaluateDiscountCode({
      code: baseCode({ maxRedemptions: 5, redemptionCount: 5 }),
      ...ctx,
    });
    expect(r).toMatchObject({ ok: false, code: 'GLOBAL_LIMIT_REACHED' });
  });

  it('個人上限已滿回 PER_USER_LIMIT_REACHED', () => {
    const r = evaluateDiscountCode({
      code: baseCode({ perUserLimit: 1 }),
      fare: 1000,
      orderType: 'charter',
      userRedemptionCount: 1,
      nowMs: NOW,
    });
    expect(r).toMatchObject({ ok: false, code: 'PER_USER_LIMIT_REACHED' });
  });

  it('通過：回 discountAmount', () => {
    const r = evaluateDiscountCode({ code: baseCode(), ...ctx });
    expect(r).toEqual({ ok: true, discountAmount: 100 });
  });

  it('折抵不超過車資（折後最低歸 0）', () => {
    const r = evaluateDiscountCode({
      code: baseCode({ discountAmount: 5000 }),
      fare: 800,
      orderType: 'charter',
      userRedemptionCount: 0,
      nowMs: NOW,
    });
    expect(r).toEqual({ ok: true, discountAmount: 800 });
  });

  it('allowedOrderTypes 為空時不限行程類型', () => {
    const r = evaluateDiscountCode({ code: baseCode({ allowedOrderTypes: [] }), ...ctx });
    expect(r).toMatchObject({ ok: true });
  });
});

describe('isDiscountCodeActive', () => {
  const base: DiscountCodeEvalData = {
    discountAmount: 100,
    validFromMs: null,
    validUntilMs: 2_000,
    maxRedemptions: null,
    perUserLimit: null,
    minFare: null,
    allowedOrderTypes: null,
    enabled: true,
    redemptionCount: 0,
  };

  it('enabled 且在有效期內回 true', () => {
    expect(isDiscountCodeActive(base, 1_000)).toBe(true);
  });

  it('enabled=false 回 false', () => {
    expect(isDiscountCodeActive({ ...base, enabled: false }, 1_000)).toBe(false);
  });

  it('尚未到 validFrom 回 false', () => {
    expect(isDiscountCodeActive({ ...base, validFromMs: 1_500 }, 1_000)).toBe(false);
  });

  it('已過 validUntil 回 false', () => {
    expect(isDiscountCodeActive(base, 3_000)).toBe(false);
  });

  it('已達 maxRedemptions 回 false', () => {
    expect(isDiscountCodeActive({ ...base, maxRedemptions: 5, redemptionCount: 5 }, 1_000)).toBe(false);
  });

  it('未達 maxRedemptions 回 true', () => {
    expect(isDiscountCodeActive({ ...base, maxRedemptions: 5, redemptionCount: 4 }, 1_000)).toBe(true);
  });

  it('nowMs 恰等於 validUntilMs 仍回 true（上界含邊界）', () => {
    expect(isDiscountCodeActive(base, 2_000)).toBe(true);
  });

  it('validFromMs 為 null 時不限生效起始日', () => {
    expect(isDiscountCodeActive({ ...base, validFromMs: null }, 1)).toBe(true);
  });
});
