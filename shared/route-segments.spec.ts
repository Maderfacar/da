import { describe, it, expect } from 'vitest';
import {
  parseRouteSegments,
  stripHtml,
  compilePatterns,
  DEFAULT_HIGHWAY_PATTERNS,
  type RouteStepLite,
} from './route-segments';

const PATTERNS = DEFAULT_HIGHWAY_PATTERNS;

describe('stripHtml', () => {
  it('剝離 <b> / <div> 等標籤', () => {
    expect(stripHtml('<b>上 國道一號</b> 往 基隆')).toBe('上 國道一號 往 基隆');
    expect(stripHtml('<div style="x">向右轉</div>')).toBe('向右轉');
  });

  it('解碼常見 HTML entity', () => {
    expect(stripHtml('A &amp; B')).toBe('A & B');
    expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
    expect(stripHtml('a&nbsp;b')).toBe('a b');
  });

  it('空 / 非字串 → 空字串', () => {
    expect(stripHtml('')).toBe('');
    // @ts-expect-error 測 fallback
    expect(stripHtml(undefined)).toBe('');
  });

  it('多空白塞到單空白', () => {
    expect(stripHtml('  靠右  進入   國道一號  ')).toBe('靠右 進入 國道一號');
  });
});

describe('compilePatterns', () => {
  it('合法 regex 全部編譯', () => {
    const r = compilePatterns(['國道一號', '台\\s*61']);
    expect(r).toHaveLength(2);
    expect(r[0]!.test('國道一號')).toBe(true);
    expect(r[1]!.test('台 61')).toBe(true);
  });

  it('非法 regex silent skip', () => {
    const r = compilePatterns(['國道一號', '[invalid', '']);
    expect(r).toHaveLength(1);
  });

  it('case-insensitive', () => {
    const r = compilePatterns(['freeway']);
    expect(r[0]!.test('FREEWAY')).toBe(true);
    expect(r[0]!.test('Freeway')).toBe(true);
  });
});

describe('parseRouteSegments', () => {
  it('空陣列 → highway 0 / surface 0 / breakdown 空', () => {
    expect(parseRouteSegments([], PATTERNS)).toEqual({
      highwayKm: 0,
      surfaceKm: 0,
      breakdown: [],
    });
  });

  it('「上 國道一號 往 基隆」→ highway', () => {
    const steps: RouteStepLite[] = [
      { instructions: '上 <b>國道一號</b> 往 基隆', distanceKm: 10 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(10);
    expect(r.surfaceKm).toBe(0);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0]!.isHighway).toBe(true);
  });

  it('「靠右行駛，進入 台 61 線」→ highway（快速道路白名單）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '靠右行駛，進入 台 61 線', distanceKm: 8 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(8);
    expect(r.surfaceKm).toBe(0);
    expect(r.breakdown[0]!.isHighway).toBe(true);
  });

  it('「靠左行駛，進入 台 2 線／淡金公路」→ surface（不誤抓）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '靠左行駛，進入 台 2 線/淡金公路', distanceKm: 12 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(0);
    expect(r.surfaceKm).toBe(12);
    expect(r.breakdown[0]!.isHighway).toBe(false);
  });

  it('「向右轉 進入 中山北路三段」→ surface', () => {
    const steps: RouteStepLite[] = [
      { instructions: '向右轉 進入 中山北路三段', distanceKm: 3 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(0);
    expect(r.surfaceKm).toBe(3);
  });

  it('HTML entities + tag 正確 strip 後仍能命中', () => {
    const steps: RouteStepLite[] = [
      { instructions: '上 <b>國道一號</b>&amp;前進 往 基隆', distanceKm: 5 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.breakdown[0]!.instructions).toContain('國道一號');
    expect(r.breakdown[0]!.instructions).toContain('&前進');
    expect(r.highwayKm).toBe(5);
  });

  it('混合路徑：高速 + 平面 — 各自累加', () => {
    const steps: RouteStepLite[] = [
      { instructions: '從 桃機 出發', distanceKm: 1 },
      { instructions: '上 國道二號 往 北', distanceKm: 18 },
      { instructions: '下交流道 進入 民權東路', distanceKm: 3 },
      { instructions: '靠右行駛，進入 國道一號 往 基隆', distanceKm: 20 },
      { instructions: '下交流道 進入 中山北路', distanceKm: 3 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(38); // 18 + 20
    expect(r.surfaceKm).toBe(7);  // 1 + 3 + 3
  });

  it('distanceKm 負值防呆 → 0', () => {
    const steps: RouteStepLite[] = [
      { instructions: '國道一號', distanceKm: -10 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(0);
    expect(r.surfaceKm).toBe(0);
  });

  it('非法 pattern 在 caller 端 silent skip 後不影響其他匹配', () => {
    const steps: RouteStepLite[] = [
      { instructions: '上 國道一號', distanceKm: 10 },
    ];
    const r = parseRouteSegments(steps, ['[invalid', '國道[一二三四五六八十]+號?']);
    expect(r.highwayKm).toBe(10);
  });

  it('「freeway / expressway」英文亦命中（case-insensitive）', () => {
    const steps: RouteStepLite[] = [
      { instructions: 'Merge onto Freeway 1', distanceKm: 12 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(12);
  });

  it('台 9 線（平面省道）→ surface，不被「台\\s*(61|...)」誤抓', () => {
    const steps: RouteStepLite[] = [
      { instructions: '進入 台 9 線', distanceKm: 7 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(0);
    expect(r.surfaceKm).toBe(7);
  });

  // ── 視窗 3 hotfix（2026-06-07）：阿拉伯數字國道 — Google Routes zh-TW 實際格式 ──
  it('「上 國道1號 往 基隆」→ highway（阿拉伯數字）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '上 國道1號 往 基隆', distanceKm: 15 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(15);
    expect(r.surfaceKm).toBe(0);
  });

  it('「繼續沿國道3號行駛」→ highway（阿拉伯數字，無空格）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '繼續沿國道3號行駛 35 公里', distanceKm: 35 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(35);
  });

  it('「國道 5 號」→ highway（阿拉伯數字 + 全形空格）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '前進至國道 5 號', distanceKm: 18 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(18);
  });

  it('混合阿拉伯 + 中文數字 — 各自累加', () => {
    const steps: RouteStepLite[] = [
      { instructions: '從 台北車站 出發', distanceKm: 1.5 },
      { instructions: '上 國道1號 往 基隆', distanceKm: 12 },
      { instructions: '靠右行駛 進入 國道一號 高速公路', distanceKm: 18 },
      { instructions: '下交流道 進入 中山北路', distanceKm: 2.5 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(30); // 12 + 18
    expect(r.surfaceKm).toBe(4);  // 1.5 + 2.5
  });

  // ── 視窗 3 hotfix（2026-06-07）：高架道路（台 1 線等市區常見高架）──
  it('「進入 重慶北路高架道路」→ highway（高架關鍵字）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '進入 重慶北路高架道路', distanceKm: 3.2 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(3.2);
    expect(r.surfaceKm).toBe(0);
  });

  it('「上 新生高架橋」→ highway', () => {
    const steps: RouteStepLite[] = [
      { instructions: '上 新生高架橋 前進', distanceKm: 1.8 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(1.8);
  });

  it('「下高架」短段也命中（接受微幅 over-count）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '下高架 靠右行駛', distanceKm: 0.4 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(0.4);
  });

  // ── 視窗 3 hotfix：砍死碼 `國[1-9]` 不應誤抓 ──
  it('「中國街3號」→ surface（單字 國 + 數字不該被誤抓為國道）', () => {
    const steps: RouteStepLite[] = [
      { instructions: '靠右行駛 進入 中國街3 號', distanceKm: 0.5 },
    ];
    const r = parseRouteSegments(steps, PATTERNS);
    expect(r.highwayKm).toBe(0);
    expect(r.surfaceKm).toBe(0.5);
  });
});
