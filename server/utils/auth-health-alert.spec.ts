import { describe, it, expect } from 'vitest';
import {
  AUTH_HEALTH_EVENTS,
  AUTH_HEALTH_THRESHOLDS,
  tallyAuthHealthEvents,
  evaluateAuthHealth,
  type AuthHealthCounts,
} from './auth-health-alert';

/** 舊測試以事件名陣列表達；每筆給獨立 session，語意等同「各自獨立的事故」。 */
const asEntries = (events: ReadonlyArray<string | undefined | null>) =>
  events.map((event, i) => ({ event, context: { sessionId: `s${i}` } }));

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
    expect(tallyAuthHealthEvents(asEntries(events))).toEqual({
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
    expect(tallyAuthHealthEvents(asEntries(events))).toEqual({
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

describe('tallyAuthHealthEvents — chunkError 按 session 去重', () => {
  const chunk = (sessionId: string | null | undefined) => ({
    event: AUTH_HEALTH_EVENTS.chunkError,
    context: { sessionId },
  });

  it('同一 session 的一連串 chunk 錯誤只算一次事故', () => {
    // 2026-08-25 prod 實例：一次部署造成單一分頁 6 秒內寫入 19 筆
    // （vite:preloadError 與 app:chunkError 兩個收集器各記一次，再乘上多個 lazy 元件）。
    // 門檻 3 對這種形狀完全沒有鑑別力 —— 量到的是 log 筆數，不是受影響人數。
    const entries = Array.from({ length: 19 }, () => chunk('sess-A'));
    expect(tallyAuthHealthEvents(entries).chunkError).toBe(1);
  });

  it('不同 session 各算一次（真的多人受影響仍會越界）', () => {
    const entries = [chunk('a'), chunk('a'), chunk('b'), chunk('c'), chunk('c')];
    expect(tallyAuthHealthEvents(entries).chunkError).toBe(3);
  });

  it('缺 sessionId 者無法去重 → 各自獨立計數（寧可多叫，不可靜音）', () => {
    const entries = [chunk(undefined), chunk(null), chunk('')];
    expect(tallyAuthHealthEvents(entries).chunkError).toBe(3);
  });

  it('缺 sessionId 與有 sessionId 混合時互不吞沒', () => {
    const entries = [chunk('a'), chunk('a'), chunk(undefined)];
    expect(tallyAuthHealthEvents(entries).chunkError).toBe(2);
  });

  it('其他三項維持筆數計數（沒有證據支持去重，不臆測）', () => {
    const same = { sessionId: 'sess-A' };
    const entries = [
      { event: AUTH_HEALTH_EVENTS.rolesSlow, context: same },
      { event: AUTH_HEALTH_EVENTS.rolesSlow, context: same },
      { event: AUTH_HEALTH_EVENTS.lineExchangeBadStatus, context: same },
      { event: AUTH_HEALTH_EVENTS.lineExchangeBadStatus, context: same },
    ];
    const counts = tallyAuthHealthEvents(entries);
    expect(counts.rolesSlow).toBe(2);
    expect(counts.lineExchangeBadStatus).toBe(2);
  });
});
