import { describe, it, expect } from 'vitest';
import { computeSU, validateSeatConfigs } from './luggageSU';

describe('computeSU', () => {
  it('轎車後廂 ~250L → 4 SU', () => {
    // 250 × 0.8 = 200 / 48 = 4.16 → floor 4
    expect(computeSU(250)).toBe(4);
  });

  it('SUV 後廂 ~450L → 7 SU', () => {
    // 450 × 0.8 = 360 / 48 = 7.5 → floor 7
    expect(computeSU(450)).toBe(7);
  });

  it('廂型車 ~900L → 15 SU', () => {
    // 900 × 0.8 = 720 / 48 = 15 → floor 15
    expect(computeSU(900)).toBe(15);
  });

  it('精確換算：60L → 1 SU', () => {
    // 60 × 0.8 = 48 / 48 = 1 → floor 1
    expect(computeSU(60)).toBe(1);
  });

  it('邊界：0L → 0 SU', () => {
    expect(computeSU(0)).toBe(0);
  });

  it('邊界：負數 → 0 SU', () => {
    expect(computeSU(-100)).toBe(0);
  });

  it('邊界：NaN → 0 SU', () => {
    expect(computeSU(NaN)).toBe(0);
  });
});

describe('validateSeatConfigs', () => {
  it('null / undefined → valid', () => {
    expect(validateSeatConfigs(null)).toBeNull();
    expect(validateSeatConfigs(undefined)).toBeNull();
  });

  it('合法配置 → null', () => {
    expect(validateSeatConfigs([
      { label: '折座模式', passengerCapacity: 2, luggageSU: 10 },
    ])).toBeNull();
  });

  it('超過 3 組 → error', () => {
    const configs = [1, 2, 3, 4].map((i) => ({ label: `cfg${i}`, passengerCapacity: 2, luggageSU: 5 }));
    expect(validateSeatConfigs(configs)).toMatch('最多 3 組');
  });

  it('缺 label → error', () => {
    expect(validateSeatConfigs([{ label: '', passengerCapacity: 2, luggageSU: 5 }])).toMatch('label');
  });

  it('passengerCapacity 非整數 → error', () => {
    expect(validateSeatConfigs([{ label: 'ok', passengerCapacity: 1.5, luggageSU: 5 }])).toMatch('passengerCapacity');
  });

  it('luggageSU = 0 → error', () => {
    expect(validateSeatConfigs([{ label: 'ok', passengerCapacity: 2, luggageSU: 0 }])).toMatch('luggageSU');
  });
});
