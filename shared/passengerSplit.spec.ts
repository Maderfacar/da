import { describe, it, expect } from 'vitest';
import { resolvePassengerSplit, validatePassengerSplit } from './passengerSplit';

describe('resolvePassengerSplit (向後相容 fallback)', () => {
  it('帶 adult/child → 直接使用', () => {
    expect(resolvePassengerSplit({ adultCount: 2, childCount: 1 })).toEqual({
      adultCount: 2,
      childCount: 1,
      totalPassengers: 3,
    });
  });

  it('只帶 passengerCount（舊 client） → fallback adult=passengerCount, child=0', () => {
    expect(resolvePassengerSplit({ passengerCount: 4 })).toEqual({
      adultCount: 4,
      childCount: 0,
      totalPassengers: 4,
    });
  });

  it('帶 adult 沒 child → child fallback 0', () => {
    expect(resolvePassengerSplit({ adultCount: 3 })).toEqual({
      adultCount: 3,
      childCount: 0,
      totalPassengers: 3,
    });
  });

  it('adult/child 同時帶 → passengerCount 被忽略（adult/child 為準）', () => {
    expect(resolvePassengerSplit({ adultCount: 1, childCount: 2, passengerCount: 99 })).toEqual({
      adultCount: 1,
      childCount: 2,
      totalPassengers: 3,
    });
  });
});

describe('validatePassengerSplit (容量校驗規則)', () => {
  it('合法：大人 1 + 兒童 0 + capacity 4 → ok', () => {
    const r = validatePassengerSplit({ adultCount: 1, childCount: 0 }, 4);
    expect(r.ok).toBe(true);
  });

  it('合法：大人 2 + 兒童 2 + capacity 5 → ok（兒童佔 1 座位）', () => {
    const r = validatePassengerSplit({ adultCount: 2, childCount: 2 }, 5);
    expect(r.ok).toBe(true);
  });

  it('合法：剛好填滿 capacity → ok（大人 3 + 兒童 1 + capacity 4）', () => {
    const r = validatePassengerSplit({ adultCount: 3, childCount: 1 }, 4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalPassengers).toBe(4);
    }
  });

  it('容量超出：大人 3 + 兒童 2 + capacity 4 → capacity_exceeded', () => {
    const r = validatePassengerSplit({ adultCount: 3, childCount: 2 }, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('capacity_exceeded');
      expect(r.context.total).toBe(5);
      expect(r.context.capacity).toBe(4);
    }
  });

  it('大人 < 1 → adult_invalid', () => {
    const r = validatePassengerSplit({ adultCount: 0, childCount: 2 }, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('adult_invalid');
  });

  it('兒童 < 0 → child_invalid', () => {
    const r = validatePassengerSplit({ adultCount: 1, childCount: -1 }, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('child_invalid');
  });

  it('總人數 > 20 → total_invalid', () => {
    const r = validatePassengerSplit({ adultCount: 15, childCount: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('total_invalid');
  });

  it('舊 client（只帶 passengerCount=3） + capacity 4 → ok（向後相容）', () => {
    const r = validatePassengerSplit({ passengerCount: 3 }, 4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.adultCount).toBe(3);
      expect(r.childCount).toBe(0);
      expect(r.totalPassengers).toBe(3);
    }
  });

  it('舊 client（passengerCount=10） + capacity 8 → capacity_exceeded', () => {
    const r = validatePassengerSplit({ passengerCount: 10 }, 8);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('capacity_exceeded');
  });

  it('無 vehicleCapacity → 只校驗 adult/child/total 範圍', () => {
    const ok = validatePassengerSplit({ adultCount: 10, childCount: 5 });
    expect(ok.ok).toBe(true);
    const bad = validatePassengerSplit({ adultCount: 0, childCount: 5 });
    expect(bad.ok).toBe(false);
  });

  it('非整數 adult → fallback 經 passengerCount fallback；無 passengerCount → 0 → adult_invalid', () => {
    const r1 = validatePassengerSplit({ adultCount: 1.5, childCount: 0 }, 4);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('adult_invalid');
  });

  it('非整數 child → fallback 0（與 server 行為一致，容錯）', () => {
    // childCount 0.5 不是整數 → fallback 0 → total = adultCount = 1，校驗通過
    const r = validatePassengerSplit({ adultCount: 1, childCount: 0.5 }, 4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.childCount).toBe(0);
      expect(r.totalPassengers).toBe(1);
    }
  });
});
