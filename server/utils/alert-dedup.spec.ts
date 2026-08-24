import { describe, it, expect } from 'vitest';
import {
  buildAlertFingerprint,
  decideAlertDispatch,
  summarizeNotifyResults,
  shouldPersistDispatch,
  ALERT_REMINDER_MS,
} from './alert-dedup';

const t = (iso: string) => new Date(iso).getTime();

describe('buildAlertFingerprint', () => {
  it('同一批事件（種類與最新時間都相同）指紋相同，筆數變動不影響', () => {
    // 筆數會因舊事件滾出視窗而下降（3 → 2），那不是新故障，指紋不可因此改變
    const a = buildAlertFingerprint([], [], [
      { event: 'auth.liff.init.failed', count: 3, sampleMessage: 'x', firstAt: '2026-08-23T07:14:43Z', lastAt: '2026-08-23T08:53:52Z' },
    ]);
    const b = buildAlertFingerprint([], [], [
      { event: 'auth.liff.init.failed', count: 2, sampleMessage: 'x', firstAt: '2026-08-23T08:53:50Z', lastAt: '2026-08-23T08:53:52Z' },
    ]);
    expect(a).toBe(b);
  });

  it('最新時間推進（真的又壞一次）→ 指紋不同', () => {
    const a = buildAlertFingerprint([], [], [
      { event: 'auth.liff.init.failed', count: 2, sampleMessage: 'x', firstAt: null, lastAt: '2026-08-23T08:53:52Z' },
    ]);
    const b = buildAlertFingerprint([], [], [
      { event: 'auth.liff.init.failed', count: 2, sampleMessage: 'x', firstAt: null, lastAt: '2026-08-23T12:40:00Z' },
    ]);
    expect(a).not.toBe(b);
  });

  it('出現新事件種類 → 指紋不同（新面孔一定要叫）', () => {
    const base = [{ event: 'auth.liff.init.failed', count: 2, sampleMessage: 'x', firstAt: null, lastAt: '2026-08-23T08:53:52Z' }];
    const a = buildAlertFingerprint([], [], base);
    const b = buildAlertFingerprint([], [], [...base,
      { event: 'window.unhandledrejection', count: 1, sampleMessage: 'y', firstAt: null, lastAt: '2026-08-23T08:53:52Z' }]);
    expect(a).not.toBe(b);
  });

  it('事件順序不同但內容相同 → 指紋相同（排序由筆數決定，會隨視窗變動）', () => {
    const e1 = { event: 'a.x', count: 1, sampleMessage: '', firstAt: null, lastAt: '2026-08-23T01:00:00Z' };
    const e2 = { event: 'b.y', count: 5, sampleMessage: '', firstAt: null, lastAt: '2026-08-23T02:00:00Z' };
    expect(buildAlertFingerprint([], [], [e1, e2])).toBe(buildAlertFingerprint([], [], [e2, e1]));
  });

  it('成功率越界也納入指紋（路徑與等級變化要能叫）', () => {
    const a = buildAlertFingerprint([], [{ route: 'liff', level: 'critical', ok: 0, fail: 3, attempts: 3, successRate: 0 }], []);
    const b = buildAlertFingerprint([], [{ route: 'browser-oauth', level: 'critical', ok: 0, fail: 3, attempts: 3, successRate: 0 }], []);
    expect(a).not.toBe(b);
  });
});

describe('decideAlertDispatch', () => {
  const FP = 'fp-same';
  const now = t('2026-08-23T10:00:00Z');

  it('第一次出現 → 發送', () => {
    const d = decideAlertDispatch(null, FP, now);
    expect(d.send).toBe(true);
    expect(d.reason).toBe('new');
  });

  it('指紋不同（有新東西）→ 立刻發送，不受降頻限制', () => {
    const prev = { fingerprint: 'fp-old', lastSentAt: now - 1000 };
    const d = decideAlertDispatch(prev, FP, now);
    expect(d.send).toBe(true);
    expect(d.reason).toBe('changed');
  });

  it('指紋相同且距上次發送未滿提醒間隔 → 抑制（這就是重複報那三次）', () => {
    const prev = { fingerprint: FP, lastSentAt: now - 60 * 60 * 1000 };
    const d = decideAlertDispatch(prev, FP, now);
    expect(d.send).toBe(false);
    expect(d.reason).toBe('duplicate');
  });

  it('指紋相同但已超過提醒間隔 → 仍要再叫一次（避免長期問題被永久靜音）', () => {
    const prev = { fingerprint: FP, lastSentAt: now - ALERT_REMINDER_MS - 1 };
    const d = decideAlertDispatch(prev, FP, now);
    expect(d.send).toBe(true);
    expect(d.reason).toBe('reminder');
  });

  it('剛好等於提醒間隔的邊界 → 發送（寧可多叫一次，不可少叫）', () => {
    const prev = { fingerprint: FP, lastSentAt: now - ALERT_REMINDER_MS };
    expect(decideAlertDispatch(prev, FP, now).send).toBe(true);
  });

  it('狀態毀損（lastSentAt 非數字）→ 發送，不因狀態壞掉而靜音', () => {
    const prev = { fingerprint: FP, lastSentAt: Number.NaN };
    expect(decideAlertDispatch(prev, FP, now).send).toBe(true);
  });

  it('未來時間戳（時鐘飄移）→ 發送，不可因此永久抑制', () => {
    const prev = { fingerprint: FP, lastSentAt: now + 999999 };
    expect(decideAlertDispatch(prev, FP, now).send).toBe(true);
  });
});

describe('summarizeNotifyResults', () => {
  it('沒有任何嘗試 → 未送達，理由 not-attempted（與「試了但失敗」要能分辨）', () => {
    expect(summarizeNotifyResults([])).toEqual({ delivered: false, reason: 'not-attempted' });
  });

  it('全部送達 → delivered', () => {
    expect(summarizeNotifyResults([{ delivered: true }, { delivered: true }])).toEqual({ delivered: true });
  });

  it('任一封未送達 → 未送達，並帶出第一個失敗原因', () => {
    expect(summarizeNotifyResults([{ delivered: true }, { delivered: false, reason: 'no-key' }]))
      .toEqual({ delivered: false, reason: 'no-key' });
  });

  it('失敗但沒給理由 → 補 error，不留 undefined 讓 log 看起來像成功', () => {
    expect(summarizeNotifyResults([{ delivered: false }])).toEqual({ delivered: false, reason: 'error' });
  });
});

describe('shouldPersistDispatch', () => {
  it('這輪不推播 → 不記狀態', () => {
    expect(shouldPersistDispatch(false, [])).toBe(false);
  });

  it('推播成功 → 記狀態（24h 內同一批才會被正確抑制）', () => {
    expect(shouldPersistDispatch(true, [{ delivered: true }])).toBe(true);
  });

  it('email 管道未設定（no-key）→ 不記狀態，下一輪要再試', () => {
    // 這條是本函式存在的理由：記了狀態等於把一批沒人看到的告警吞掉 24 小時，
    // 且管道修好之後仍然收不到。
    expect(shouldPersistDispatch(true, [{ delivered: false, reason: 'no-key' }])).toBe(false);
  });

  it('無收件人 → 不記狀態', () => {
    expect(shouldPersistDispatch(true, [{ delivered: false, reason: 'no-recipients' }])).toBe(false);
  });

  it('兩封只成功一封 → 不記狀態（另一封下輪要補）', () => {
    expect(shouldPersistDispatch(true, [{ delivered: true }, { delivered: false, reason: 'error' }])).toBe(false);
  });

  it('決定要推播卻一封都沒發出 → 不記狀態', () => {
    expect(shouldPersistDispatch(true, [])).toBe(false);
  });
});

describe('buildAlertFingerprint — authHealth 越界也要進指紋', () => {
  it('只有 authHealth 越界的兩種不同故障，指紋不可相同', () => {
    // 缺這一項時兩者都是 e[]r[] —— 前一天的 chunk 告警會把今天的 rolesSlow
    // （使用者誤判登出的主因事件）當成重複而抑制掉。
    const chunk = buildAlertFingerprint(['chunkError'], [], []);
    const roles = buildAlertFingerprint(['rolesSlow'], [], []);
    expect(chunk).not.toBe(roles);
  });

  it('同一組越界項目、順序不同 → 指紋相同', () => {
    expect(buildAlertFingerprint(['chunkError', 'rolesSlow'], [], []))
      .toBe(buildAlertFingerprint(['rolesSlow', 'chunkError'], [], []));
  });

  it('新增一項越界 → 指紋不同（多壞一種一定要叫）', () => {
    expect(buildAlertFingerprint(['chunkError'], [], []))
      .not.toBe(buildAlertFingerprint(['chunkError', 'userdocMissing'], [], []));
  });

  it('沒有任何越界 → 與有越界的指紋不同', () => {
    expect(buildAlertFingerprint([], [], [])).not.toBe(buildAlertFingerprint(['chunkError'], [], []));
  });
});
