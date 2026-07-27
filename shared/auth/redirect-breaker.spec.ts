import { describe, it, expect } from 'vitest';
import { evaluateBreaker, BREAKER_MAX, BREAKER_WINDOW_MS } from './redirect-breaker';

describe('evaluateBreaker', () => {
  it('無前次狀態 → count=1、允許', () => {
    const { state, allow } = evaluateBreaker(null, 1000);
    expect(allow).toBe(true);
    expect(state).toEqual({ count: 1, windowStart: 1000 });
  });

  it('時間窗內連續累加，未達門檻仍允許', () => {
    let state = evaluateBreaker(null, 0).state;
    for (let i = 2; i <= BREAKER_MAX; i++) {
      const r = evaluateBreaker(state, 100 * i);
      state = r.state;
      expect(r.allow).toBe(true);
      expect(state.count).toBe(i);
    }
  });

  it('時間窗內超過門檻 → 斷路（不允許）', () => {
    let state: { count: number; windowStart: number } | null = null;
    let last = evaluateBreaker(state, 0);
    state = last.state;
    // 連打 BREAKER_MAX+1 次（都在時間窗內）
    for (let i = 0; i < BREAKER_MAX; i++) {
      last = evaluateBreaker(state, 10 * (i + 1));
      state = last.state;
    }
    // 第 BREAKER_MAX+1 次應被斷路
    expect(last.allow).toBe(false);
    expect(state.count).toBe(BREAKER_MAX + 1);
  });

  it('超出時間窗 → 重置為新視窗、允許', () => {
    const prev = { count: BREAKER_MAX + 5, windowStart: 0 };
    const { state, allow } = evaluateBreaker(prev, BREAKER_WINDOW_MS + 1);
    expect(allow).toBe(true);
    expect(state).toEqual({ count: 1, windowStart: BREAKER_WINDOW_MS + 1 });
  });
});
