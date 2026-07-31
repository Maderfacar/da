import { describe, it, expect } from 'vitest';
import {
  AUTH_HEALTH_EVENTS,
  AUTH_HEALTH_THRESHOLDS,
  tallyAuthHealthEvents,
  evaluateAuthHealth,
  type AuthHealthCounts,
} from './auth-health-alert';

describe('tallyAuthHealthEvents', () => {
  it('空陣列回全 0', () => {
    expect(tallyAuthHealthEvents([])).toEqual({
      rolesSlow: 0,
      userdocMissing: 0,
      chunkError: 0,
      lineExchangeBadStatus: 0,
    });
  });

  it('依 event 字串正確歸類計數', () => {
    const events = [
      AUTH_HEALTH_EVENTS.rolesSlow,
      AUTH_HEALTH_EVENTS.rolesSlow,
      AUTH_HEALTH_EVENTS.chunkError,
      AUTH_HEALTH_EVENTS.userdocMissing,
      AUTH_HEALTH_EVENTS.lineExchangeBadStatus,
      AUTH_HEALTH_EVENTS.lineExchangeBadStatus,
      AUTH_HEALTH_EVENTS.lineExchangeBadStatus,
    ];
    expect(tallyAuthHealthEvents(events)).toEqual({
      rolesSlow: 2,
      userdocMissing: 1,
      chunkError: 1,
      lineExchangeBadStatus: 3,
    });
  });

  it('忽略未知 / null / undefined / info 事件', () => {
    const events = [
      'auth.roles.arrived',           // info 非監控
      'auth.resolved.snapshot',       // info 非監控
      undefined,
      null,
      '',
      AUTH_HEALTH_EVENTS.rolesSlow,
    ];
    expect(tallyAuthHealthEvents(events)).toEqual({
      rolesSlow: 1,
      userdocMissing: 0,
      chunkError: 0,
      lineExchangeBadStatus: 0,
    });
  });
});

describe('evaluateAuthHealth', () => {
  const zero: AuthHealthCounts = {
    rolesSlow: 0, userdocMissing: 0, chunkError: 0, lineExchangeBadStatus: 0,
  };

  it('全部低於門檻 → 不越界', () => {
    const counts: AuthHealthCounts = {
      rolesSlow: 4,               // < 5
      chunkError: 2,              // < 3
      userdocMissing: 0,          // < 1
      lineExchangeBadStatus: 2,   // < 3
    };
    const res = evaluateAuthHealth(counts);
    expect(res.breached).toBe(false);
    expect(res.breaches).toEqual([]);
  });

  it('達門檻（等於）即越界', () => {
    const counts: AuthHealthCounts = { ...zero, userdocMissing: 1 };
    const res = evaluateAuthHealth(counts);
    expect(res.breached).toBe(true);
    expect(res.breaches).toEqual([{ key: 'userdocMissing', count: 1, threshold: 1 }]);
  });

  it('多項同時越界全數列出', () => {
    const counts: AuthHealthCounts = {
      rolesSlow: 6,
      chunkError: 5,
      userdocMissing: 0,
      lineExchangeBadStatus: 3,
    };
    const res = evaluateAuthHealth(counts);
    expect(res.breached).toBe(true);
    const keys = res.breaches.map((b) => b.key).sort();
    expect(keys).toEqual(['chunkError', 'lineExchangeBadStatus', 'rolesSlow']);
  });

  it('可自訂門檻（Brain AI 事後可調）', () => {
    const counts: AuthHealthCounts = { ...zero, rolesSlow: 2 };
    // 預設門檻 5 不越界
    expect(evaluateAuthHealth(counts).breached).toBe(false);
    // 調降為 2 即越界
    const custom: AuthHealthCounts = { ...AUTH_HEALTH_THRESHOLDS, rolesSlow: 2 };
    expect(evaluateAuthHealth(counts, custom).breached).toBe(true);
  });
});
