import { describe, it, expect } from 'vitest';
import { removeDeepLinkParams } from './deep-link';

describe('removeDeepLinkParams', () => {
  it('移除 liff.state', () => {
    expect(removeDeepLinkParams('https://x.com/driver/auth?liff.state=%2Fdriver%2Ftrip'))
      .toBe('/driver/auth');
  });

  it('移除 next', () => {
    expect(removeDeepLinkParams('https://x.com/login?next=%2Forders'))
      .toBe('/login');
  });

  it('同時移除 liff.state 與 next，保留其他 query', () => {
    expect(removeDeepLinkParams('https://x.com/login?liff.state=%2Fa&keep=1&next=%2Fb'))
      .toBe('/login?keep=1');
  });

  it('無深連結參數 → 回等價相對 URL', () => {
    expect(removeDeepLinkParams('https://x.com/home?foo=bar')).toBe('/home?foo=bar');
    expect(removeDeepLinkParams('https://x.com/home')).toBe('/home');
  });

  it('保留 hash', () => {
    expect(removeDeepLinkParams('https://x.com/login?liff.state=%2Fa#section'))
      .toBe('/login#section');
  });
});
