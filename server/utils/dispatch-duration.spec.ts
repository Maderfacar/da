import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  DISPATCH_DURATION,
  isDispatchOrderType,
  getNextDowngradeAt,
  nextLowerLevel,
} from './dispatch-duration';

describe('isDispatchOrderType', () => {
  it.each([
    ['airport-pickup', true],
    ['airport-dropoff', true],
    ['transfer', true],
    ['charter', true],
  ])('已知 type %s → %s', (t, expected) => {
    expect(isDispatchOrderType(t)).toBe(expected);
  });

  it('unknown type → false', () => {
    expect(isDispatchOrderType('unknown')).toBe(false);
    expect(isDispatchOrderType('')).toBe(false);
    expect(isDispatchOrderType(undefined)).toBe(false);
    expect(isDispatchOrderType(null)).toBe(false);
  });
});

describe('nextLowerLevel', () => {
  it('\'2\' → \'1\'', () => expect(nextLowerLevel('2')).toBe('1'));
  it('\'1\' → \'0\'', () => expect(nextLowerLevel('1')).toBe('0'));
  it('\'0\' → null（終態）', () => expect(nextLowerLevel('0')).toBeNull());
});

describe('getNextDowngradeAt', () => {
  const baseMs = new Date('2026-05-25T10:00:00Z').getTime();
  const openedAt = Timestamp.fromMillis(baseMs);

  it('airport-pickup 從 2 降 1 = +180 秒', () => {
    const next = getNextDowngradeAt('airport-pickup', '2', openedAt);
    expect(next).not.toBeNull();
    expect(next!.toMillis()).toBe(baseMs + 180 * 1000);
  });

  it('airport-pickup 從 1 降 0 = +300 秒', () => {
    const next = getNextDowngradeAt('airport-pickup', '1', openedAt);
    expect(next!.toMillis()).toBe(baseMs + 300 * 1000);
  });

  it('transfer 從 2 降 1 = +480 秒', () => {
    const next = getNextDowngradeAt('transfer', '2', openedAt);
    expect(next!.toMillis()).toBe(baseMs + 480 * 1000);
  });

  it('charter 從 1 降 0 = +3600 秒（1 小時）', () => {
    const next = getNextDowngradeAt('charter', '1', openedAt);
    expect(next!.toMillis()).toBe(baseMs + 3600 * 1000);
  });

  it('currentLevel=\'0\' 終態回 null（不再降）', () => {
    expect(getNextDowngradeAt('charter', '0', openedAt)).toBeNull();
  });

  it('unknown orderType 回 null（safety：新 type 漏 config 不會崩）', () => {
    expect(getNextDowngradeAt('unknown', '2', openedAt)).toBeNull();
  });

  it('缺 openedAt 回 null', () => {
    expect(getNextDowngradeAt('airport-pickup', '2', null)).toBeNull();
    expect(getNextDowngradeAt('airport-pickup', '2', undefined)).toBeNull();
  });

  it('DISPATCH_DURATION config 完整覆蓋 4 orderType × 2 key', () => {
    const types = Object.keys(DISPATCH_DURATION);
    expect(types).toHaveLength(4);
    for (const t of types) {
      const cfg = DISPATCH_DURATION[t as keyof typeof DISPATCH_DURATION];
      expect(typeof cfg['2->1']).toBe('number');
      expect(typeof cfg['1->0']).toBe('number');
      // sanity：間距為正、1→0 比 2→1 大（給更多時間等較低分級湧入）
      expect(cfg['2->1']).toBeGreaterThan(0);
      expect(cfg['1->0']).toBeGreaterThanOrEqual(cfg['2->1']);
    }
  });
});
