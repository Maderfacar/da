import { describe, it, expect, vi } from 'vitest';
import { createUnauthorizedPolicy } from './unauthorized-policy';

describe('unauthorized-policy', () => {
  it('happy path：第一次 401 → refresh 成功 → 回 retry，不觸發 SignOut', async () => {
    const refreshToken = vi.fn().mockResolvedValue('fresh-token');
    const signOutToLogin = vi.fn().mockResolvedValue(undefined);
    const policy = createUnauthorizedPolicy({ refreshToken, signOutToLogin });

    const decision = await policy.handle(false);

    expect(decision).toBe('retry');
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(signOutToLogin).not.toHaveBeenCalled();
  });

  it('refresh 回空字串 → 視為失敗 → 觸發 SignOut 回 signed-out', async () => {
    const refreshToken = vi.fn().mockResolvedValue('');
    const signOutToLogin = vi.fn().mockResolvedValue(undefined);
    const policy = createUnauthorizedPolicy({ refreshToken, signOutToLogin });

    const decision = await policy.handle(false);

    expect(decision).toBe('signed-out');
    expect(signOutToLogin).toHaveBeenCalledTimes(1);
  });

  it('refresh throw → 視為失敗 → 觸發 SignOut 回 signed-out', async () => {
    const refreshToken = vi.fn().mockRejectedValue(new Error('network'));
    const signOutToLogin = vi.fn().mockResolvedValue(undefined);
    const policy = createUnauthorizedPolicy({ refreshToken, signOutToLogin });

    const decision = await policy.handle(false);

    expect(decision).toBe('signed-out');
    expect(signOutToLogin).toHaveBeenCalledTimes(1);
  });

  it('retry 仍 401（isRetry=true）→ 直接 SignOut，不再 refresh', async () => {
    const refreshToken = vi.fn();
    const signOutToLogin = vi.fn().mockResolvedValue(undefined);
    const policy = createUnauthorizedPolicy({ refreshToken, signOutToLogin });

    const decision = await policy.handle(true);

    expect(decision).toBe('signed-out');
    expect(refreshToken).not.toHaveBeenCalled();
    expect(signOutToLogin).toHaveBeenCalledTimes(1);
  });

  it('SignOut 後續呼叫 → 回 noop，不重複 SignOut', async () => {
    const refreshToken = vi.fn().mockResolvedValue('');
    const signOutToLogin = vi.fn().mockResolvedValue(undefined);
    const policy = createUnauthorizedPolicy({ refreshToken, signOutToLogin });

    await policy.handle(false); // signed-out
    const second = await policy.handle(false);
    const third = await policy.handle(true);

    expect(second).toBe('noop');
    expect(third).toBe('noop');
    expect(signOutToLogin).toHaveBeenCalledTimes(1);
  });

  it('並行 401：兩個 handle(false) 同時呼叫 → 共用一次 refresh', async () => {
    let resolveRefresh!: (val: string) => void;
    const refreshToken = vi.fn(
      () => new Promise<string>((r) => { resolveRefresh = r; }),
    );
    const signOutToLogin = vi.fn().mockResolvedValue(undefined);
    const policy = createUnauthorizedPolicy({ refreshToken, signOutToLogin });

    const p1 = policy.handle(false);
    const p2 = policy.handle(false);
    resolveRefresh('fresh');
    const [d1, d2] = await Promise.all([p1, p2]);

    expect(d1).toBe('retry');
    expect(d2).toBe('retry');
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(signOutToLogin).not.toHaveBeenCalled();
  });

  it('reset 後可重新試 refresh', async () => {
    const refreshToken = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const signOutToLogin = vi.fn().mockResolvedValue(undefined);
    const policy = createUnauthorizedPolicy({ refreshToken, signOutToLogin });

    await policy.handle(false);
    policy.reset();
    const decision = await policy.handle(false);

    expect(decision).toBe('retry');
    expect(refreshToken).toHaveBeenCalledTimes(2);
  });
});
