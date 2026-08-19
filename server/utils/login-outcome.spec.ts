import { describe, it, expect } from 'vitest';
import {
  buildChannelMismatchLog,
  buildLoginOutcomeLog,
  LOGIN_CHANNEL_ENFORCE,
  LOGIN_EVENT_CHANNEL_MISMATCH,
  LOGIN_EVENT_OK,
  LOGIN_EVENT_FAIL,
  LOGIN_ROUTES,
} from './login-outcome';

const base = {
  route: 'liff' as const,
  end: 'passenger' as const,
  message: 'test',
  path: '/nuxt-api/auth/line-exchange',
};

describe('buildLoginOutcomeLog', () => {
  it('成功寫 auth.login.ok / severity=info', () => {
    const log = buildLoginOutcomeLog({ ...base, outcome: 'ok' });
    expect(log.event).toBe(LOGIN_EVENT_OK);
    expect(log.severity).toBe('info');
  });

  it('失敗寫 auth.login.fail / severity=warn', () => {
    const log = buildLoginOutcomeLog({ ...base, outcome: 'fail' });
    expect(log.event).toBe(LOGIN_EVENT_FAIL);
    expect(log.severity).toBe('warn');
  });

  it('成功用 info 而非 warn —— 否則會污染 deny-by-default 的 error/warn 偵測', () => {
    const ok = buildLoginOutcomeLog({ ...base, outcome: 'ok' });
    expect(['error', 'warn']).not.toContain(ok.severity);
  });

  it('route 一定寫進 metadata（少了它就無法分路徑算成功率）', () => {
    for (const route of LOGIN_ROUTES) {
      const log = buildLoginOutcomeLog({ ...base, route, outcome: 'ok' });
      expect(log.metadata?.route).toBe(route);
    }
  });

  it('stage / reason 有給才寫入，未給不留空欄位', () => {
    const withStage = buildLoginOutcomeLog({
      ...base,
      outcome: 'fail',
      stage: 'verify',
      reason: 'payload-mismatch',
    });
    expect(withStage.metadata).toMatchObject({ route: 'liff', stage: 'verify', reason: 'payload-mismatch' });

    const without = buildLoginOutcomeLog({ ...base, outcome: 'ok' });
    expect(without.metadata).not.toHaveProperty('stage');
    expect(without.metadata).not.toHaveProperty('reason');
  });

  it('額外 metadata 併入，且同名以額外欄位為準', () => {
    const log = buildLoginOutcomeLog({
      ...base,
      outcome: 'fail',
      stage: 'verify',
      metadata: { audType: 'string', stage: 'overridden' },
    });
    expect(log.metadata?.audType).toBe('string');
    expect(log.metadata?.stage).toBe('overridden');
    expect(log.metadata?.route).toBe('liff');
  });

  it('lineUserId 未給時為 null（不是 undefined，避免寫入缺欄位）', () => {
    expect(buildLoginOutcomeLog({ ...base, outcome: 'ok' }).lineUserId).toBeNull();
    expect(buildLoginOutcomeLog({ ...base, outcome: 'ok', lineUserId: 'U123' }).lineUserId).toBe('U123');
  });

  it('兩條登入路徑都必須被列舉（新增入口忘了擴充會被這條擋下）', () => {
    expect([...LOGIN_ROUTES].sort()).toEqual(['browser-oauth', 'liff']);
  });
});

describe('buildChannelMismatchLog', () => {
  const mismatch = {
    end: 'passenger' as const,
    path: '/nuxt-api/auth/line-exchange',
    actualType: 'string',
    expectedType: 'string',
  };

  it('severity=error —— 必須被 deny-by-default 未知事件規則抓到', () => {
    const log = buildChannelMismatchLog({ ...mismatch, enforced: false });
    expect(log.event).toBe(LOGIN_EVENT_CHANNEL_MISMATCH);
    expect(log.severity).toBe('error');
  });

  it('觀測模式與擋下模式的訊息可區分', () => {
    expect(buildChannelMismatchLog({ ...mismatch, enforced: false }).message).toContain('觀測模式放行');
    expect(buildChannelMismatchLog({ ...mismatch, enforced: true }).message).toContain('已擋下');
    expect(buildChannelMismatchLog({ ...mismatch, enforced: false }).metadata?.enforced).toBe(false);
  });

  it('只記型別，不得寫入 client_id 實際值（屬憑證資訊）', () => {
    const log = buildChannelMismatchLog({ ...mismatch, enforced: false });
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain('2009509209');
    expect(log.metadata).toMatchObject({ actualType: 'string', expectedType: 'string' });
    expect(log.lineUserId).toBeNull();
  });

  it('導入初期為觀測模式（翻 true 前必須先確認 prod 無不符紀錄）', () => {
    expect(LOGIN_CHANNEL_ENFORCE).toBe(false);
  });
});
