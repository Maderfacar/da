import { describe, it, expect } from 'vitest';
import { getErrorLogRetentionCutoff, ERROR_LOG_RETENTION_DAYS } from './error-log-retention';

describe('getErrorLogRetentionCutoff', () => {
  it('預設保留 7 天', () => {
    expect(ERROR_LOG_RETENTION_DAYS).toBe(7);
  });

  it('回傳「現在 - 保留天數」的時戳', () => {
    const now = new Date('2026-07-28T00:00:00.000Z');
    const cutoff = getErrorLogRetentionCutoff(now);
    expect(cutoff.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });

  it('可自訂天數', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    expect(getErrorLogRetentionCutoff(now, 3).toISOString()).toBe('2026-07-25T12:00:00.000Z');
  });

  it('cutoff 早於 now', () => {
    const now = new Date();
    expect(getErrorLogRetentionCutoff(now).getTime()).toBeLessThan(now.getTime());
  });
});
