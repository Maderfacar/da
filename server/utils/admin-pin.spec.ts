import { describe, it, expect } from 'vitest';
import { validatePinFormat, hashPin, comparePin } from './admin-pin';

describe('admin-pin: validatePinFormat', () => {
  it('接受 4 位數', () => {
    expect(validatePinFormat('1234')).toBe(true);
  });

  it('接受 8 位數', () => {
    expect(validatePinFormat('12345678')).toBe(true);
  });

  it('拒絕 3 位數（過短）', () => {
    expect(validatePinFormat('123')).toBe(false);
  });

  it('拒絕 9 位數（過長）', () => {
    expect(validatePinFormat('123456789')).toBe(false);
  });

  it('拒絕含字母', () => {
    expect(validatePinFormat('12a4')).toBe(false);
  });

  it('拒絕含空白', () => {
    expect(validatePinFormat('12 34')).toBe(false);
  });

  it('拒絕空字串 / null / undefined / 數字', () => {
    expect(validatePinFormat('')).toBe(false);
    expect(validatePinFormat(null)).toBe(false);
    expect(validatePinFormat(undefined)).toBe(false);
    expect(validatePinFormat(1234)).toBe(false);
  });
});

describe('admin-pin: bcrypt round-trip', () => {
  it('hash + compare 同字串回 true', async () => {
    const hash = await hashPin('1234');
    expect(hash).toMatch(/^\$2[ayb]\$10\$/);
    expect(await comparePin('1234', hash)).toBe(true);
  });

  it('compare 錯誤 PIN 回 false', async () => {
    const hash = await hashPin('1234');
    expect(await comparePin('5678', hash)).toBe(false);
  });

  it('compare 對毀損 hash 回 false（不拋錯）', async () => {
    expect(await comparePin('1234', 'not-a-hash')).toBe(false);
  });

  it('同 PIN 兩次 hash 不同（salt 不同）', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a).not.toBe(b);
    expect(await comparePin('1234', a)).toBe(true);
    expect(await comparePin('1234', b)).toBe(true);
  });
});
