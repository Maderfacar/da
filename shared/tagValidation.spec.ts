import { describe, it, expect } from 'vitest';
import { validateTagInput } from './tagValidation';

describe('validateTagInput', () => {
  it('完整合法 input → []', () => {
    const result = validateTagInput({
      name: { zh_tw: '純電', en: 'EV', ja: 'EV' },
      group: 'power',
      scope: 'vehicle',
      surchargeAmount: 0,
      sortOrder: 1,
    });
    expect(result).toEqual([]);
  });

  it('name.zh_tw 缺 → required', () => {
    const result = validateTagInput({
      name: { en: 'EV' },
      group: 'power',
      scope: 'vehicle',
      surchargeAmount: 0,
    });
    expect(result).toContainEqual({ field: 'name.zh_tw', code: 'required' });
  });

  it('name.zh_tw 全空白 → required', () => {
    const result = validateTagInput({
      name: { zh_tw: '   ' },
      group: 'power',
      scope: 'vehicle',
      surchargeAmount: 0,
    });
    expect(result).toContainEqual({ field: 'name.zh_tw', code: 'required' });
  });

  it('name.zh_tw 超過 32 字 → too_long', () => {
    const result = validateTagInput({
      name: { zh_tw: 'A'.repeat(33) },
      group: 'power',
      scope: 'vehicle',
      surchargeAmount: 0,
    });
    expect(result).toContainEqual({ field: 'name.zh_tw', code: 'too_long' });
  });

  it('group: "foo" → invalid', () => {
    const result = validateTagInput({
      name: { zh_tw: '純電' },
      group: 'foo',
      scope: 'vehicle',
      surchargeAmount: 0,
    });
    expect(result).toContainEqual({ field: 'group', code: 'invalid' });
  });

  it('group=power, scope=driver → mismatch（power 應為 vehicle）', () => {
    const result = validateTagInput({
      name: { zh_tw: '純電' },
      group: 'power',
      scope: 'driver',
      surchargeAmount: 0,
    });
    expect(result).toContainEqual({ field: 'scope', code: 'mismatch' });
  });

  it('surchargeAmount: -1 → negative', () => {
    const result = validateTagInput({
      name: { zh_tw: '純電' },
      group: 'power',
      scope: 'vehicle',
      surchargeAmount: -1,
    });
    expect(result).toContainEqual({ field: 'surchargeAmount', code: 'negative' });
  });

  it('isUpdate: true 且只給 surchargeAmount=100 → []（其他不檢查 required）', () => {
    const result = validateTagInput(
      { surchargeAmount: 100 },
      { isUpdate: true },
    );
    expect(result).toEqual([]);
  });

  it('isUpdate: true 仍會檢查 group 是否合法', () => {
    const result = validateTagInput(
      { group: 'foo' },
      { isUpdate: true },
    );
    expect(result).toContainEqual({ field: 'group', code: 'invalid' });
  });

  it('sortOrder 非整數 → invalid', () => {
    const result = validateTagInput({
      name: { zh_tw: '純電' },
      group: 'power',
      scope: 'vehicle',
      surchargeAmount: 0,
      sortOrder: 1.5,
    });
    expect(result).toContainEqual({ field: 'sortOrder', code: 'invalid' });
  });
});
