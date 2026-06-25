import { describe, it, expect } from 'vitest';
import {
  resolveEnd,
  generateSessionId,
  clipString,
  isMetadataTooLarge,
} from './resolvers';

describe('resolveEnd — end 推導', () => {
  it('/admin 開頭 → admin', () => {
    expect(resolveEnd('/admin')).toBe('admin');
    expect(resolveEnd('/admin/orders')).toBe('admin');
    expect(resolveEnd('/admin/2fa/setup')).toBe('admin');
  });

  it('/driver 開頭 → driver', () => {
    expect(resolveEnd('/driver')).toBe('driver');
    expect(resolveEnd('/driver/dashboard')).toBe('driver');
    expect(resolveEnd('/driver/auth')).toBe('driver');
  });

  it('其他路徑 → passenger', () => {
    expect(resolveEnd('/')).toBe('passenger');
    expect(resolveEnd('/home')).toBe('passenger');
    expect(resolveEnd('/booking')).toBe('passenger');
    expect(resolveEnd('/orders/abc')).toBe('passenger');
    expect(resolveEnd('/fleet')).toBe('passenger');
  });

  it('非預期輸入永不 throw → 退回 passenger', () => {
    expect(resolveEnd('' as string)).toBe('passenger');
    expect(resolveEnd(undefined as unknown as string)).toBe('passenger');
    expect(resolveEnd(null as unknown as string)).toBe('passenger');
    expect(resolveEnd(123 as unknown as string)).toBe('passenger');
  });

  it('部分前綴相似但不該誤判（例 /administration）', () => {
    // 故意命中：/admin 前綴包含 /administrator/x；行為與生產一致（startsWith）
    expect(resolveEnd('/administrator/x')).toBe('admin');
    // 不該命中：/drives → passenger（不是 /driver）
    expect(resolveEnd('/drives')).toBe('passenger');
  });
});

describe('generateSessionId — sid 生成', () => {
  it('長度 7 + 字元限 a-z0-9', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateSessionId();
      expect(id).toMatch(/^[a-z0-9]{1,7}$/);
      expect(id.length).toBeLessThanOrEqual(7);
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('多次呼叫得到不同值（隨機性 sanity check）', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateSessionId());
    // 50 次至少出現 >40 個不同 id；極小機率重複
    expect(ids.size).toBeGreaterThan(40);
  });
});

describe('clipString — 字串截斷 + 型別防爆', () => {
  it('短於上限 → 原樣回', () => {
    expect(clipString('hello', 100)).toBe('hello');
  });

  it('恰好等於上限 → 原樣回', () => {
    const s = 'a'.repeat(100);
    expect(clipString(s, 100)).toBe(s);
  });

  it('超過上限 → 截斷至 max', () => {
    const s = 'a'.repeat(500);
    expect(clipString(s, 100).length).toBe(100);
  });

  it('非字串永不 throw → 回空字串', () => {
    expect(clipString(undefined, 100)).toBe('');
    expect(clipString(null, 100)).toBe('');
    expect(clipString(123, 100)).toBe('');
    expect(clipString({ a: 1 }, 100)).toBe('');
    expect(clipString([], 100)).toBe('');
  });
});

describe('isMetadataTooLarge — metadata 大小判定', () => {
  it('小物件 → false', () => {
    expect(isMetadataTooLarge({ a: 1, b: 'short' }, 1024)).toBe(false);
  });

  it('恰好等於上限 → false（<= 不算超）', () => {
    const s = 'x'.repeat(500);
    const obj = { s };
    const cap = JSON.stringify(obj).length;
    expect(isMetadataTooLarge(obj, cap)).toBe(false);
  });

  it('超過上限 → true', () => {
    const big = { s: 'x'.repeat(10_000) };
    expect(isMetadataTooLarge(big, 5 * 1024)).toBe(true);
  });

  it('非物件 → false（不該被當 metadata 處理）', () => {
    expect(isMetadataTooLarge(undefined, 1024)).toBe(false);
    expect(isMetadataTooLarge(null, 1024)).toBe(false);
    expect(isMetadataTooLarge('a string', 1024)).toBe(false);
    expect(isMetadataTooLarge(123, 1024)).toBe(false);
  });

  it('circular reference → true（不可序列化，視為過大下游 drop）', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(isMetadataTooLarge(o, 1024)).toBe(true);
  });
});
