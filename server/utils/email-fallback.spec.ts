import { describe, it, expect } from 'vitest';
import {
  decideEmailQuota,
  buildFallbackEmail,
  EMAIL_DAILY_CAP,
  dayKeyTaipei,
} from './email-fallback';

const t = (iso: string) => new Date(iso).getTime();

describe('dayKeyTaipei', () => {
  it('以台北日界線分日（UTC 16:00 已是隔天）', () => {
    expect(dayKeyTaipei(t('2026-08-24T15:59:00Z'))).toBe('2026-08-24');
    expect(dayKeyTaipei(t('2026-08-24T16:00:00Z'))).toBe('2026-08-25');
  });
});

describe('decideEmailQuota', () => {
  const now = t('2026-08-25T02:00:00Z'); // 台北 08-25 10:00
  const today = '2026-08-25';

  it('沒有既有狀態 → 可寄，計數從 1 開始', () => {
    const d = decideEmailQuota(null, now);
    expect(d.send).toBe(true);
    expect(d.nextState).toEqual({ dayKey: today, count: 1 });
  });

  it('同一天累加計數', () => {
    const d = decideEmailQuota({ dayKey: today, count: 5 }, now);
    expect(d.send).toBe(true);
    expect(d.nextState.count).toBe(6);
  });

  it('跨日重置計數', () => {
    const d = decideEmailQuota({ dayKey: '2026-08-24', count: EMAIL_DAILY_CAP }, now);
    expect(d.send).toBe(true);
    expect(d.nextState).toEqual({ dayKey: today, count: 1 });
  });

  it('達到當日上限 → 不再寄（避免額度耗盡時信箱被洗版）', () => {
    const d = decideEmailQuota({ dayKey: today, count: EMAIL_DAILY_CAP }, now);
    expect(d.send).toBe(false);
  });

  it('剛好在上限前一封 → 仍可寄，且標記為最後一封', () => {
    const d = decideEmailQuota({ dayKey: today, count: EMAIL_DAILY_CAP - 1 }, now);
    expect(d.send).toBe(true);
    expect(d.isLastBeforeCap).toBe(true);
  });

  it('狀態毀損（count 非數字）→ 當作 0，照寄不靜音', () => {
    const d = decideEmailQuota({ dayKey: today, count: Number.NaN }, now);
    expect(d.send).toBe(true);
    expect(d.nextState.count).toBe(1);
  });
});

describe('buildFallbackEmail', () => {
  const base = {
    channel: 'passenger' as const,
    targetUid: 'U5813df1cc07f1f5c884035f61ccfaae9',
    statusCode: 429,
    errorDetails: '{"message":"You have reached your monthly limit."}',
    messages: [{ type: 'text' as const, text: '🔔 司機證件待審核\n司機：王小明' }],
    at: t('2026-08-25T02:00:00Z'),
  };

  it('主旨標明是未送達，且帶額度用罄的線索', () => {
    const m = buildFallbackEmail(base);
    expect(m.subject).toContain('未送達');
    expect(m.subject).toContain('429');
  });

  it('內文含原始訊息全文 —— 這封信要能取代原訊息', () => {
    const m = buildFallbackEmail(base);
    expect(m.text).toContain('司機證件待審核');
    expect(m.text).toContain('王小明');
  });

  it('內文含收件對象與 channel，讓人知道誰沒收到、要不要人工補', () => {
    const m = buildFallbackEmail(base);
    expect(m.text).toContain('U5813df1cc07f1f5c884035f61ccfaae9');
    expect(m.text).toContain('passenger');
  });

  it('時間以台北顯示', () => {
    const m = buildFallbackEmail(base);
    expect(m.text).toContain('08/25 10:00');
  });

  it('flex 訊息取 altText，不把整包 JSON 塞進信裡', () => {
    const m = buildFallbackEmail({
      ...base,
      messages: [{ type: 'flex', altText: '您的訂單已成立', contents: { big: 'x'.repeat(5000) } }],
    });
    expect(m.text).toContain('您的訂單已成立');
    expect(m.text).not.toContain('xxxxxxxxxx');
  });

  it('多則訊息全部列出', () => {
    const m = buildFallbackEmail({
      ...base,
      messages: [{ type: 'text', text: '第一則' }, { type: 'text', text: '第二則' }],
    });
    expect(m.text).toContain('第一則');
    expect(m.text).toContain('第二則');
  });
});
