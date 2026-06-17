import { describe, it, expect, vi } from 'vitest';
import { createLazyLoader } from './lazy-loader';

describe('lazy-loader', () => {
  it('happy：第一次 ensure() 呼叫 fn 一次並 resolve', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const loader = createLazyLoader(fn);
    await loader.ensure();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('已 resolved 後再呼叫 → 不重發 fn', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const loader = createLazyLoader(fn);
    await loader.ensure();
    await loader.ensure();
    await loader.ensure();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('並行 ensure 共用同一個 in-flight promise', async () => {
    let resolveFn!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { resolveFn = r; }));
    const loader = createLazyLoader(fn);

    const p1 = loader.ensure();
    const p2 = loader.ensure();
    expect(fn).toHaveBeenCalledTimes(1);
    resolveFn();
    await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('失敗：throw → in-flight 清掉，下次 ensure 可重試', async () => {
    const fn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce(undefined);
    const loader = createLazyLoader(fn);

    await expect(loader.ensure()).rejects.toThrow('first');
    await loader.ensure();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reset 後 → ensure 重發 fn', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const loader = createLazyLoader(fn);
    await loader.ensure();
    loader.reset();
    await loader.ensure();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('isLoaded：resolved 後 true，reset 後 false', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const loader = createLazyLoader(fn);
    expect(loader.isLoaded()).toBe(false);
    await loader.ensure();
    expect(loader.isLoaded()).toBe(true);
    loader.reset();
    expect(loader.isLoaded()).toBe(false);
  });

  it('失敗後 isLoaded 仍為 false（只有成功才算 loaded）', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const loader = createLazyLoader(fn);
    await expect(loader.ensure()).rejects.toThrow();
    expect(loader.isLoaded()).toBe(false);
  });
});
