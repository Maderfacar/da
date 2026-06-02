/**
 * 醜點系統 Phase 1（A2）— 純函式單元測試
 *
 * 涵蓋：
 *  - 24h 邊界：剛好 24h 整點、24h 多 1 秒、24h 少 1 秒
 *  - 6 個月歸零：剛好 6 月、6 月少 1 秒、6 月多 1 秒、月底 edge case
 *  - 點數：late_cancel = 1、no_show = 2
 *  - 推播判定：< 2 不推、= 2 警告、≥ 3 暫停
 *  - 異常輸入：pickupDateTime 缺失 / 非法 → 'free'、uglyResetAt null → 不歸零
 */
import { describe, it, expect } from 'vitest';
import {
  classifyCancellation,
  computeUglyPoints,
  shouldResetUgly,
  decidePenaltyPush,
  LATE_CANCEL_WINDOW_MS,
} from './penalty';

const PICKUP_TW = '2026-06-10T14:30:00+08:00';
const pickupMs = new Date(PICKUP_TW).getTime();

describe('classifyCancellation — 24h 邊界', () => {
  it('剛好 24h 整 → late（門檻內）', () => {
    const now = new Date(pickupMs - LATE_CANCEL_WINDOW_MS);
    expect(classifyCancellation({ now, pickupDateTime: PICKUP_TW })).toBe('late');
  });

  it('24h 多 1 秒（更早取消）→ free', () => {
    const now = new Date(pickupMs - LATE_CANCEL_WINDOW_MS - 1000);
    expect(classifyCancellation({ now, pickupDateTime: PICKUP_TW })).toBe('free');
  });

  it('24h 少 1 秒（更晚取消）→ late', () => {
    const now = new Date(pickupMs - LATE_CANCEL_WINDOW_MS + 1000);
    expect(classifyCancellation({ now, pickupDateTime: PICKUP_TW })).toBe('late');
  });

  it('取消當下 = 上車時間 → late', () => {
    const now = new Date(pickupMs);
    expect(classifyCancellation({ now, pickupDateTime: PICKUP_TW })).toBe('late');
  });

  it('一週前取消 → free', () => {
    const now = new Date(pickupMs - 7 * 24 * 60 * 60 * 1000);
    expect(classifyCancellation({ now, pickupDateTime: PICKUP_TW })).toBe('free');
  });
});

describe('classifyCancellation — 異常輸入 fallback', () => {
  it('pickupDateTime = undefined → free（不誤記醜點）', () => {
    expect(classifyCancellation({ now: new Date(), pickupDateTime: undefined })).toBe('free');
  });

  it('pickupDateTime = null → free', () => {
    expect(classifyCancellation({ now: new Date(), pickupDateTime: null })).toBe('free');
  });

  it('pickupDateTime 非法字串 → free', () => {
    expect(classifyCancellation({ now: new Date(), pickupDateTime: 'not-a-date' })).toBe('free');
  });

  it('pickupDateTime 不帶時區 → 視為台灣時間後判定', () => {
    // 上車時間 = 2026-06-10 14:30 +08:00；取消時間 = 同一日 14:00 +08:00 → 距上車 30 分 → late
    const now = new Date('2026-06-10T14:00:00+08:00');
    expect(classifyCancellation({ now, pickupDateTime: '2026-06-10T14:30:00' })).toBe('late');
  });
});

describe('computeUglyPoints', () => {
  it('late_cancel → 1 點', () => {
    expect(computeUglyPoints('late_cancel')).toBe(1);
  });

  it('no_show → 2 點', () => {
    expect(computeUglyPoints('no_show')).toBe(2);
  });
});

describe('shouldResetUgly — 6 個月邊界', () => {
  it('uglyResetAt = null → 不歸零（從未記過）', () => {
    expect(shouldResetUgly(null, new Date())).toBe(false);
  });

  it('上次記點剛好 6 個月前 → 應歸零', () => {
    const last = new Date('2026-01-10T00:00:00+08:00');
    const now = new Date('2026-07-10T00:00:00+08:00');
    expect(shouldResetUgly(last, now)).toBe(true);
  });

  it('上次記點 6 個月差 1 秒（尚未滿）→ 不歸零', () => {
    const last = new Date('2026-01-10T00:00:00+08:00');
    const now = new Date('2026-07-09T23:59:59+08:00');
    expect(shouldResetUgly(last, now)).toBe(false);
  });

  it('上次記點 6 個月多 1 秒 → 應歸零', () => {
    const last = new Date('2026-01-10T00:00:00+08:00');
    const now = new Date('2026-07-10T00:00:01+08:00');
    expect(shouldResetUgly(last, now)).toBe(true);
  });

  it('上次記點 5 個月前 → 不歸零', () => {
    const last = new Date('2026-01-10T00:00:00+08:00');
    const now = new Date('2026-06-10T00:00:00+08:00');
    expect(shouldResetUgly(last, now)).toBe(false);
  });

  it('上次記點 1 年前 → 應歸零', () => {
    const last = new Date('2025-06-10T00:00:00+08:00');
    const now = new Date('2026-06-10T00:00:00+08:00');
    expect(shouldResetUgly(last, now)).toBe(true);
  });

  it('uglyResetAt 為 Invalid Date → 不歸零', () => {
    expect(shouldResetUgly(new Date('invalid'), new Date())).toBe(false);
  });
});

describe('decidePenaltyPush', () => {
  it('0 醜 → 不推', () => {
    expect(decidePenaltyPush(0)).toBeNull();
  });

  it('1 醜 → 不推', () => {
    expect(decidePenaltyPush(1)).toBeNull();
  });

  it('剛好 2 醜 → 警告', () => {
    expect(decidePenaltyPush(2)).toBe('warning');
  });

  it('剛好 3 醜 → 暫停', () => {
    expect(decidePenaltyPush(3)).toBe('suspended');
  });

  it('4 醜以上 → 暫停', () => {
    expect(decidePenaltyPush(4)).toBe('suspended');
    expect(decidePenaltyPush(10)).toBe('suspended');
  });
});
