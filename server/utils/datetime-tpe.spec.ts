import { describe, it, expect } from 'vitest';
import { formatDateTimeTpe } from './datetime-tpe';

// pickupDateTime 在 Firestore 是混合格式：
//   乘客下單 = 無時區台灣在地字串；admin 建單/編輯 = toISOString() 的 UTC Z 字串。
// 這組測試鎖住「無時區照字面、帶 Z 轉 Asia/Taipei」的判定規則 —— 無論測試機時區為何，
// 兩類輸入的輸出都必須是台灣牆鐘時間。
describe('formatDateTimeTpe', () => {
  it('帶 Z 的 UTC 字串轉為台灣時間（+8h）', () => {
    expect(formatDateTimeTpe('2026-09-04T02:00:00.000Z')).toBe('2026-09-04 10:00');
  });

  it('UTC 轉換跨日：前一天 23:00Z → 台灣隔天 07:00', () => {
    expect(formatDateTimeTpe('2026-09-03T23:00:00.000Z')).toBe('2026-09-04 07:00');
  });

  it('帶 +08:00 offset 的字串維持台灣牆鐘時間', () => {
    expect(formatDateTimeTpe('2026-09-04T10:00:00+08:00')).toBe('2026-09-04 10:00');
  });

  it('無時區字串（乘客 datetime-local）視為台灣在地時間、照字面輸出', () => {
    expect(formatDateTimeTpe('2026-09-04T10:00')).toBe('2026-09-04 10:00');
  });

  it('自訂格式（LINE 派單卡 MM/DD HH:mm）', () => {
    expect(formatDateTimeTpe('2026-09-04T02:30:00.000Z', 'MM/DD HH:mm')).toBe('09/04 10:30');
  });

  it('空值回空字串', () => {
    expect(formatDateTimeTpe('')).toBe('');
    expect(formatDateTimeTpe(null)).toBe('');
    expect(formatDateTimeTpe(undefined)).toBe('');
  });

  it('無法解析的字串回傳原字串（與舊 _formatDateTime fallback 一致）', () => {
    expect(formatDateTimeTpe('not-a-date')).toBe('not-a-date');
  });
});
