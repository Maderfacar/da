import { describe, it, expect } from 'vitest';
import { configStr } from './runtime-config';

describe('configStr', () => {
  it('純數字 env（被 destr 轉成 number）還原為字串', () => {
    // 迴歸：LINE Login channel id 2009509209 經 Nitro destr 後是 number，
    // 直接與 LINE verify 回傳的 aud（字串）比對會永遠不相等 → 登入全滅。
    expect(configStr(2009509209)).toBe('2009509209');
    expect(configStr(2009509209) === '2009509209').toBe(true);
  });

  it('字串原樣回傳並去除前後空白', () => {
    expect(configStr('2009509209')).toBe('2009509209');
    expect(configStr('  abc  ')).toBe('abc');
    expect(configStr('')).toBe('');
  });

  it('bigint / boolean 轉字串', () => {
    expect(configStr(10n)).toBe('10');
    expect(configStr(true)).toBe('true');
  });

  it('未設定或非純量 → 空字串（讓 caller 的 config 檢查分支接手）', () => {
    expect(configStr(undefined)).toBe('');
    expect(configStr(null)).toBe('');
    expect(configStr(Number.NaN)).toBe('');
    expect(configStr({ id: 1 })).toBe('');
    expect(configStr(['a'])).toBe('');
  });
});
