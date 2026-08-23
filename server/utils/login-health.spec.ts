import { describe, it, expect } from 'vitest';
import {
  buildLoginHealthSummary,
  tallyLoginOutcomes,
  evaluateLoginSuccessRate,
  detectUnknownEvents,
  isBenignEvent,
  LOGIN_EVENT_OK,
  LOGIN_EVENT_FAIL,
  CRITICAL_MIN_ATTEMPTS,
  formatTaipei,
  toLogDate,
} from './login-health';

const ok = (route: string) => ({ event: LOGIN_EVENT_OK, severity: 'info', metadata: { route } });
const fail = (route: string) => ({ event: LOGIN_EVENT_FAIL, severity: 'warn', metadata: { route } });
const many = (n: number, make: () => object) => Array.from({ length: n }, make);

describe('tallyLoginOutcomes', () => {
  it('依 route 分組計算 ok / fail / attempts / successRate', () => {
    const tally = tallyLoginOutcomes([
      ok('liff'), ok('liff'), fail('liff'),
      fail('browser-oauth'),
    ]);
    expect(tally.liff).toEqual({ ok: 2, fail: 1, attempts: 3, successRate: 2 / 3 });
    expect(tally['browser-oauth']).toEqual({ ok: 0, fail: 1, attempts: 1, successRate: 0 });
  });

  it('忽略非登入結果事件', () => {
    const tally = tallyLoginOutcomes([
      { event: 'route.navigate', severity: 'info' },
      { event: 'auth.roles.slow', severity: 'warn' },
      ok('liff'),
    ]);
    expect(Object.keys(tally)).toEqual(['liff']);
  });

  it('沒標 route 的歸入 unknown 而非丟棄（新入口忘了標會被看見）', () => {
    const tally = tallyLoginOutcomes([
      { event: LOGIN_EVENT_FAIL, severity: 'warn' },
      { event: LOGIN_EVENT_FAIL, severity: 'warn', metadata: {} },
    ]);
    expect(tally.unknown).toMatchObject({ fail: 2, attempts: 2, successRate: 0 });
  });
});

describe('evaluateLoginSuccessRate', () => {
  it('迴歸：2026-08-15 事故形狀（browser-oauth ok=0 / fail=11）必須是 critical', () => {
    const tally = tallyLoginOutcomes(many(11, () => fail('browser-oauth')));
    const breaches = evaluateLoginSuccessRate(tally);

    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({
      route: 'browser-oauth',
      level: 'critical',
      ok: 0,
      fail: 11,
      attempts: 11,
      successRate: 0,
    });
  });

  it('迴歸：該事故在「第 3 次失敗」當下就要成立，不必等累積數日', () => {
    const tally = tallyLoginOutcomes(many(CRITICAL_MIN_ATTEMPTS, () => fail('browser-oauth')));
    expect(evaluateLoginSuccessRate(tally)[0]?.level).toBe('critical');
  });

  it('全滅但樣本不足 3 次 → 尚不判定', () => {
    const tally = tallyLoginOutcomes(many(2, () => fail('browser-oauth')));
    expect(evaluateLoginSuccessRate(tally)).toEqual([]);
  });

  it('沒人使用（attempts=0）不判定為異常', () => {
    expect(evaluateLoginSuccessRate({})).toEqual([]);
    expect(evaluateLoginSuccessRate({ liff: { ok: 0, fail: 0, attempts: 0, successRate: null } })).toEqual([]);
  });

  it('全數成功不告警', () => {
    const tally = tallyLoginOutcomes(many(20, () => ok('liff')));
    expect(evaluateLoginSuccessRate(tally)).toEqual([]);
  });

  it('樣本足夠且成功率低於 50% → warn', () => {
    const tally = tallyLoginOutcomes([...many(4, () => ok('liff')), ...many(8, () => fail('liff'))]);
    const breaches = evaluateLoginSuccessRate(tally);
    expect(breaches[0]).toMatchObject({ route: 'liff', level: 'warn', attempts: 12 });
  });

  it('成功率低但樣本不足 10 → 不判定', () => {
    const tally = tallyLoginOutcomes([ok('liff'), fail('liff'), fail('liff')]);
    expect(evaluateLoginSuccessRate(tally)).toEqual([]);
  });

  it('一條路徑壞掉不影響另一條的判定', () => {
    const tally = tallyLoginOutcomes([
      ...many(5, () => ok('liff')),
      ...many(4, () => fail('browser-oauth')),
    ]);
    const breaches = evaluateLoginSuccessRate(tally);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.route).toBe('browser-oauth');
  });
});

describe('detectUnknownEvents（deny-by-default）', () => {
  it('沒見過的 error 事件即使從未設定過也會被抓到', () => {
    const found = detectUnknownEvents([
      { event: 'auth.brand.new.failure', severity: 'error', message: '前所未見的錯誤' },
    ]);
    expect(found).toEqual([
      { event: 'auth.brand.new.failure', count: 1, sampleMessage: '前所未見的錯誤', firstAt: null, lastAt: null },
    ]);
  });

  it('迴歸：本次事故若沿用舊事件名也會被抓到（不需事先加進任何設定）', () => {
    const found = detectUnknownEvents(
      many(11, () => ({ event: 'auth.line-login.callback.fail', severity: 'warn', message: 'verify failed' })),
    );
    expect(found[0]).toMatchObject({ event: 'auth.line-login.callback.fail', count: 11 });
  });

  it('info 級事件不列入', () => {
    expect(detectUnknownEvents([{ event: 'auth.login.ok', severity: 'info' }])).toEqual([]);
  });

  it('良性事件不告警', () => {
    const found = detectUnknownEvents([
      { event: 'route.navigate', severity: 'error' },
      { event: 'middleware.redirect.login-entry', severity: 'error' },
      { event: 'middleware.redirect.unauth', severity: 'error' },
      { event: 'auth.liff.init.retry', severity: 'warn' },
    ]);
    expect(found).toEqual([]);
  });

  it('已被成功率規則涵蓋的 auth.login.fail 不重複告警', () => {
    expect(detectUnknownEvents(many(5, () => fail('liff')))).toEqual([]);
  });

  it('已被既有四項規則涵蓋的事件不重複告警', () => {
    const found = detectUnknownEvents([
      { event: 'auth.roles.slow', severity: 'warn' },
      { event: 'app.chunk-error', severity: 'error' },
    ]);
    expect(found).toEqual([]);
  });

  it('依筆數由多到少排序', () => {
    const found = detectUnknownEvents([
      { event: 'a.rare', severity: 'error' },
      ...many(3, () => ({ event: 'b.common', severity: 'error' })),
    ]);
    expect(found.map((f) => f.event)).toEqual(['b.common', 'a.rare']);
  });

  it('真正的 LIFF 初始化失敗不算良性（retry 才是）', () => {
    expect(isBenignEvent('auth.liff.init.retry')).toBe(true);
    expect(isBenignEvent('auth.liff.init.failed')).toBe(false);
    expect(isBenignEvent('window.unhandledrejection')).toBe(false);
    expect(isBenignEvent('auth.login.channel-mismatch')).toBe(false);
  });
});

describe('buildLoginHealthSummary', () => {
  it('沒有任何越界時回空字串（caller 據此判斷不發訊息）', () => {
    expect(buildLoginHealthSummary([], [])).toBe('');
  });

  it('成功率越界列出路徑、百分比與分子分母', () => {
    const tally = tallyLoginOutcomes(many(11, () => fail('browser-oauth')));
    const summary = buildLoginHealthSummary(evaluateLoginSuccessRate(tally), []);
    expect(summary).toContain('browser-oauth');
    expect(summary).toContain('0%');
    expect(summary).toContain('0/11');
  });

  it('未知事件列出種類數與各自筆數', () => {
    const summary = buildLoginHealthSummary([], [
      { event: 'auth.liff.init.failed', count: 4, sampleMessage: 'x' },
    ]);
    expect(summary).toContain('未知錯誤事件 1 種');
    expect(summary).toContain('auth.liff.init.failed ×4');
  });

  it('未知事件過多時只列前幾種、其餘以數量帶過', () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      event: `e${i}`,
      count: 8 - i,
      sampleMessage: '',
    }));
    const summary = buildLoginHealthSummary([], events, 5);
    expect(summary).toContain('未知錯誤事件 8 種');
    expect(summary).toContain('…另 3 種');
    expect(summary).not.toContain('e5 ×');
  });

  it('摘要以換行分隔，不含實體斷行以外的控制字元', () => {
    const summary = buildLoginHealthSummary(
      evaluateLoginSuccessRate(tallyLoginOutcomes(many(3, () => fail('liff')))),
      [{ event: 'x.y', count: 1, sampleMessage: '' }],
    );
    expect(summary.split('\n').length).toBeGreaterThan(1);
  });
});

// ── 台北時間與「同一批重複報」辨識（2026-08-23） ─────────────────────
//
// 為什麼加這段：告警訊息原本只有事件名與筆數，沒有任何時間，導致視窗重疊造成的
// 重複告警與真正的新事件在收訊端長得一模一樣（人只能靠人工比對筆數猜）。
// 判別靠的是「最新一筆時間有沒有往前推進」，所以那個時間必須出現在訊息裡。

describe('formatTaipei', () => {
  it('UTC 轉台北（+8），輸出 MM/DD HH:mm', () => {
    expect(formatTaipei('2026-08-23T08:53:50.000Z')).toBe('08/23 16:53');
  });

  it('跨日：UTC 深夜為台北隔日清晨', () => {
    expect(formatTaipei('2026-08-23T17:30:00.000Z')).toBe('08/24 01:30');
  });

  it('可只輸出時分', () => {
    expect(formatTaipei('2026-08-23T08:53:50.000Z', false)).toBe('16:53');
  });

  it('無法解析時回空字串，不拋錯', () => {
    expect(formatTaipei(undefined)).toBe('');
    expect(formatTaipei('not a date')).toBe('');
  });
});

describe('toLogDate', () => {
  it('支援 Firestore Timestamp（具 toDate 方法的物件）', () => {
    const iso = '2026-08-23T08:53:50.000Z';
    const fsTimestamp = { toDate: () => new Date(iso) };
    expect(toLogDate(fsTimestamp)?.toISOString()).toBe(iso);
  });

  it('支援 Date / ISO 字串 / epoch 毫秒', () => {
    const iso = '2026-08-23T08:53:50.000Z';
    expect(toLogDate(new Date(iso))?.toISOString()).toBe(iso);
    expect(toLogDate(iso)?.toISOString()).toBe(iso);
    expect(toLogDate(Date.parse(iso))?.toISOString()).toBe(iso);
  });

  it('無效輸入回 null', () => {
    expect(toLogDate(null)).toBeNull();
    expect(toLogDate({})).toBeNull();
    expect(toLogDate('nope')).toBeNull();
  });
});

describe('detectUnknownEvents 的時間範圍', () => {
  const at = (iso: string) => ({
    event: 'auth.liff.init.failed', severity: 'error', message: 'boom', timestamp: iso,
  });

  it('記錄最早與最新一筆（輸入亂序也要正確，不可取頭尾筆）', () => {
    const found = detectUnknownEvents([
      at('2026-08-23T08:53:50.000Z'),
      at('2026-08-22T23:14:43.000Z'),
      at('2026-08-23T02:00:00.000Z'),
    ]);
    expect(found[0]?.firstAt).toBe('2026-08-22T23:14:43.000Z');
    expect(found[0]?.lastAt).toBe('2026-08-23T08:53:50.000Z');
  });

  it('沒有 timestamp 欄位時為 null，其餘欄位照常', () => {
    const found = detectUnknownEvents([{ event: 'x.y', severity: 'error', message: 'm' }]);
    expect(found[0]).toEqual({
      event: 'x.y', count: 1, sampleMessage: 'm', firstAt: null, lastAt: null,
    });
  });
});

describe('buildLoginHealthSummary 的時間顯示（辨識重複告警）', () => {
  const evt = (firstAt: string, lastAt: string) => ([{
    event: 'auth.liff.init.failed', count: 2, sampleMessage: 'x', firstAt, lastAt,
  }]);

  it('列出事件的最新發生時間（台北），這是判斷「同一批 vs 新事件」的依據', () => {
    const summary = buildLoginHealthSummary([], evt('2026-08-23T07:14:43.000Z', '2026-08-23T08:53:50.000Z'));
    expect(summary).toContain('15:14');
    expect(summary).toContain('16:53');
  });

  it('最早與最新同一分鐘時只印一個時間，不重複囉嗦', () => {
    const summary = buildLoginHealthSummary([], evt('2026-08-23T08:53:50.000Z', '2026-08-23T08:53:52.000Z'));
    expect(summary).toContain('08/23 16:53');
    expect(summary).not.toContain('→');
  });

  it('同一批重複報：兩次告警的最新時間相同 → 訊息內容逐字相同', () => {
    const a = buildLoginHealthSummary([], evt('2026-08-23T07:14:43.000Z', '2026-08-23T08:53:50.000Z'));
    const b = buildLoginHealthSummary([], evt('2026-08-23T07:14:43.000Z', '2026-08-23T08:53:50.000Z'));
    expect(a).toBe(b);
  });

  it('有新事件進來：最新時間推進 → 訊息不同（人可一眼看出）', () => {
    const before = buildLoginHealthSummary([], evt('2026-08-23T07:14:43.000Z', '2026-08-23T08:53:50.000Z'));
    const after = buildLoginHealthSummary([], evt('2026-08-23T07:14:43.000Z', '2026-08-23T10:20:00.000Z'));
    expect(after).not.toBe(before);
    expect(after).toContain('18:20');
  });

  it('沒有時間資料時退化為原本的樣子，不印空白時間', () => {
    const summary = buildLoginHealthSummary([], [
      { event: 'x.y', count: 1, sampleMessage: '', firstAt: null, lastAt: null },
    ]);
    expect(summary).toContain('x.y ×1');
    expect(summary).not.toContain('⏱');
  });

  it('帶入掃描區間時於結尾標示（台北）', () => {
    const summary = buildLoginHealthSummary(
      [], evt('2026-08-23T08:53:50.000Z', '2026-08-23T08:53:52.000Z'), 5,
      { from: '2026-08-23T08:32:00.000Z', to: '2026-08-23T11:32:00.000Z' },
    );
    expect(summary).toContain('16:32');
    expect(summary).toContain('19:32');
    expect(summary).toContain('台北');
  });

  it('沒有任何越界時，即使帶入區間也不產生訊息', () => {
    expect(buildLoginHealthSummary([], [], 5, { from: new Date(), to: new Date() })).toBe('');
  });
});
