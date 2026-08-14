import { describe, it, expect } from 'vitest';
import { isBlockedCrossOrigin } from './csrf-origin';

describe('isBlockedCrossOrigin', () => {
  const host = 'da-line-liff-app.vercel.app';

  it('GET 一律放行（非 mutating）', () => {
    expect(isBlockedCrossOrigin('GET', '/nuxt-api/orders', 'https://evil.com', host)).toBe(false);
  });

  it('非 /nuxt-api 路徑放行', () => {
    expect(isBlockedCrossOrigin('POST', '/api/line/webhook', 'https://evil.com', host)).toBe(false);
  });

  it('無 Origin（webhook / server-to-server）放行', () => {
    expect(isBlockedCrossOrigin('POST', '/nuxt-api/orders', undefined, host)).toBe(false);
  });

  it('同源 mutating 放行', () => {
    expect(isBlockedCrossOrigin('POST', '/nuxt-api/auth/session-login', `https://${host}`, host)).toBe(false);
  });

  it('跨站 mutating 擋', () => {
    expect(isBlockedCrossOrigin('POST', '/nuxt-api/orders', 'https://evil.com', host)).toBe(true);
  });

  it('Origin 格式非法 擋', () => {
    expect(isBlockedCrossOrigin('DELETE', '/nuxt-api/orders/1', 'not-a-url', host)).toBe(true);
  });

  it('method 大小寫不敏感', () => {
    expect(isBlockedCrossOrigin('post', '/nuxt-api/orders', 'https://evil.com', host)).toBe(true);
  });

  it('帶 port 的同源放行', () => {
    expect(isBlockedCrossOrigin('POST', '/nuxt-api/orders', 'http://localhost:3000', 'localhost:3000')).toBe(false);
  });
});
