import { describe, it, expect } from 'vitest';
import {
  DISPATCH_LEVEL_VALUES,
  isDispatchLevel,
  type DispatchLevel,
} from './dispatch-visibility';

describe('DISPATCH_LEVEL_VALUES', () => {
  it('恰好三個值對齊 driver-category', () => {
    expect(DISPATCH_LEVEL_VALUES).toEqual(['0', '1', '2']);
  });
});

describe('isDispatchLevel', () => {
  it.each(['0', '1', '2'])('合法值 \'%s\' → true', (v) => {
    expect(isDispatchLevel(v)).toBe(true);
  });

  it.each(['', '3', '-1', 'pro', null, undefined, 0, 1, 2, {}])(
    'illegal value %p → false',
    (v) => {
      expect(isDispatchLevel(v)).toBe(false);
    },
  );

  it('narrowed type 可直接賦值給 DispatchLevel', () => {
    const v: unknown = '2';
    if (isDispatchLevel(v)) {
      const lvl: DispatchLevel = v; // 型別檢查通過即視為 pass
      expect(lvl).toBe('2');
    }
  });
});

describe('字典序比較（driverCategory vs currentLevel）', () => {
  // 此測試只是文件化「為何可以直接字串比較」— 給未來維護者參考
  it('\'2\' >= \'1\' >= \'0\'', () => {
    expect('2' >= '1').toBe(true);
    expect('1' >= '0').toBe(true);
    expect('0' >= '0').toBe(true);
  });
  it('\'0\' < \'1\' < \'2\'', () => {
    expect('0' < '1').toBe(true);
    expect('1' < '2').toBe(true);
  });
});
