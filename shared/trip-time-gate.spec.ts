/**
 * driver/trip Phase 3 時間 gate 單元測試。
 *
 * 涵蓋：
 *  - 客上 (arrived_pickup → in_transit) 前 90 min 應拒
 *  - 客上 前 60 min 邊界應通過
 *  - 客上 之後應通過
 *  - 客下 (in_transit → completed) 預估抵達 -30 min 應拒
 *  - 客下 預估抵達 -20 min 邊界應通過
 *  - 客下 預估抵達後應通過
 *  - 非 gate 的狀態轉換不擋（如 confirmed → en_route）
 *  - pickupDateTime 缺失或非法字串時不擋
 *  - completed 純序列限制（無時間 gate）
 */
import { describe, it, expect } from 'vitest';
import { checkTimeGate, formatRemaining, parseTaiwanTime } from './trip-time-gate';

const TW_PICKUP = '2026-05-25T14:30:00+08:00';
const pickupMs = parseTaiwanTime(TW_PICKUP).getTime();

describe('checkTimeGate — 客上 gate (arrived_pickup → in_transit)', () => {
  it('上車前 90 分鐘 → 拒絕，回 too_early_pickup', () => {
    const now = new Date(pickupMs - 90 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'arrived_pickup',
      nextStatus: 'in_transit',
      pickupDateTime: TW_PICKUP,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('too_early_pickup');
      // 還差約 30 min 才到「上車前 60 min」門檻
      expect(r.remainingMs).toBeGreaterThan(29 * 60 * 1000);
      expect(r.remainingMs).toBeLessThanOrEqual(30 * 60 * 1000);
    }
  });

  it('上車前 60 分鐘（門檻內）→ 通過', () => {
    const now = new Date(pickupMs - 60 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'arrived_pickup',
      nextStatus: 'in_transit',
      pickupDateTime: TW_PICKUP,
      now,
    });
    expect(r.ok).toBe(true);
  });

  it('上車後 10 分鐘 → 通過（早就到時間了）', () => {
    const now = new Date(pickupMs + 10 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'arrived_pickup',
      nextStatus: 'in_transit',
      pickupDateTime: TW_PICKUP,
      now,
    });
    expect(r.ok).toBe(true);
  });
});

describe('checkTimeGate — 客下 gate (in_transit → completed)', () => {
  const estimatedTimeMin = 45; // 預估 45 分鐘到達 → 預估抵達 = pickup + 45 min

  it('預估抵達前 30 分鐘 → 拒絕（容差 20 min 內未到）', () => {
    const arrival = pickupMs + estimatedTimeMin * 60 * 1000;
    const now = new Date(arrival - 30 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'in_transit',
      nextStatus: 'completed',
      pickupDateTime: TW_PICKUP,
      estimatedTimeMin,
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('too_early_dropoff');
      // 還差約 10 min 才到「預估抵達 -20 min」門檻
      expect(r.remainingMs).toBeGreaterThan(9 * 60 * 1000);
      expect(r.remainingMs).toBeLessThanOrEqual(10 * 60 * 1000);
    }
  });

  it('預估抵達前 20 分鐘（容差門檻）→ 通過', () => {
    const arrival = pickupMs + estimatedTimeMin * 60 * 1000;
    const now = new Date(arrival - 20 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'in_transit',
      nextStatus: 'completed',
      pickupDateTime: TW_PICKUP,
      estimatedTimeMin,
      now,
    });
    expect(r.ok).toBe(true);
  });

  it('預估抵達後 5 分鐘 → 通過', () => {
    const arrival = pickupMs + estimatedTimeMin * 60 * 1000;
    const now = new Date(arrival + 5 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'in_transit',
      nextStatus: 'completed',
      pickupDateTime: TW_PICKUP,
      estimatedTimeMin,
      now,
    });
    expect(r.ok).toBe(true);
  });

  it('estimatedTime 缺失視為 0 → 只看 pickup -20 min 門檻', () => {
    const now = new Date(pickupMs - 25 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'in_transit',
      nextStatus: 'completed',
      pickupDateTime: TW_PICKUP,
      estimatedTimeMin: undefined,
      now,
    });
    // pickup -20 min 才能執行；現在是 pickup -25 min → 還差 5 min
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('too_early_dropoff');
    }
  });
});

describe('checkTimeGate — 非 gate 的狀態轉換', () => {
  it('confirmed → en_route：不擋（任何時間都可執行）', () => {
    const now = new Date(pickupMs - 24 * 60 * 60 * 1000); // 提前一天
    const r = checkTimeGate({
      currentStatus: 'confirmed',
      nextStatus: 'en_route',
      pickupDateTime: TW_PICKUP,
      now,
    });
    expect(r.ok).toBe(true);
  });

  it('en_route → arrived_pickup：不擋', () => {
    const now = new Date(pickupMs - 24 * 60 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'en_route',
      nextStatus: 'arrived_pickup',
      pickupDateTime: TW_PICKUP,
      now,
    });
    expect(r.ok).toBe(true);
  });

  it('cancelled / pending 等非推進序列 → 不擋', () => {
    const now = new Date(pickupMs - 24 * 60 * 60 * 1000);
    const r = checkTimeGate({
      currentStatus: 'confirmed',
      nextStatus: 'cancelled',
      pickupDateTime: TW_PICKUP,
      now,
    });
    expect(r.ok).toBe(true);
  });
});

describe('checkTimeGate — edge cases', () => {
  it('pickupDateTime 缺失 → 不擋（fallback 允許）', () => {
    const r = checkTimeGate({
      currentStatus: 'arrived_pickup',
      nextStatus: 'in_transit',
      pickupDateTime: undefined,
      now: new Date(),
    });
    expect(r.ok).toBe(true);
  });

  it('pickupDateTime 非法字串 → 不擋（避免誤擋）', () => {
    const r = checkTimeGate({
      currentStatus: 'arrived_pickup',
      nextStatus: 'in_transit',
      pickupDateTime: 'not-a-date',
      now: new Date(),
    });
    expect(r.ok).toBe(true);
  });
});

describe('parseTaiwanTime', () => {
  it('帶時區 → 直接解析', () => {
    const d = parseTaiwanTime('2026-05-25T14:30:00+08:00');
    expect(d.toISOString()).toBe('2026-05-25T06:30:00.000Z');
  });

  it('不帶時區 → 補 +08:00', () => {
    const d = parseTaiwanTime('2026-05-25T14:30:00');
    expect(d.toISOString()).toBe('2026-05-25T06:30:00.000Z');
  });

  it('帶 Z → UTC 解析', () => {
    const d = parseTaiwanTime('2026-05-25T06:30:00Z');
    expect(d.toISOString()).toBe('2026-05-25T06:30:00.000Z');
  });
});

describe('formatRemaining', () => {
  it('< 60 秒 → 秒', () => {
    expect(formatRemaining(45_000)).toBe('45 秒');
  });
  it('60+ 秒 < 60 分 → 分鐘', () => {
    expect(formatRemaining(5 * 60 * 1000)).toBe('5 分鐘');
  });
  it('整小時 → 只顯示小時', () => {
    expect(formatRemaining(2 * 60 * 60 * 1000)).toBe('2 小時');
  });
  it('小時 + 分 → 「X 小時 Y 分鐘」', () => {
    expect(formatRemaining(2 * 60 * 60 * 1000 + 23 * 60 * 1000)).toBe('2 小時 23 分鐘');
  });
});
