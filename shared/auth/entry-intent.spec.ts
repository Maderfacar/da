import { beforeEach, describe, expect, it } from 'vitest';
import {
  ENTRY_INTENT_TTL_MS,
  _resetEntryIntentForTest,
  clearEntryIntent,
  entryEndOf,
  isEntryIntentFresh,
  makeEntryIntent,
  readEntryIntent,
  rememberEntryIntent,
} from './entry-intent';

beforeEach(() => {
  _resetEntryIntentForTest();
});

describe('entryEndOf', () => {
  it('/driver 開頭視為司機端', () => {
    expect(entryEndOf('/driver/trip')).toBe('driver');
    expect(entryEndOf('/driver/dispatched')).toBe('driver');
    expect(entryEndOf('/driver')).toBe('driver');
  });

  it('其餘視為乘客端', () => {
    expect(entryEndOf('/booking')).toBe('passenger');
    expect(entryEndOf('/orders')).toBe('passenger');
    expect(entryEndOf('/')).toBe('passenger');
  });

  it('不因前綴相似而誤判（/drivers 不是司機端路徑）', () => {
    expect(entryEndOf('/drivers-guide')).toBe('passenger');
  });
});

describe('makeEntryIntent', () => {
  it('由目標推導端別並記錄時間', () => {
    const intent = makeEntryIntent('/driver/trip', 1000);

    expect(intent).toEqual({ target: '/driver/trip', end: 'driver', at: 1000 });
  });

  it('非站內相對路徑回 null（防 open redirect）', () => {
    expect(makeEntryIntent('https://evil.example.com', 1000)).toBeNull();
    expect(makeEntryIntent('//evil.example.com', 1000)).toBeNull();
    expect(makeEntryIntent('driver/trip', 1000)).toBeNull();
    expect(makeEntryIntent('', 1000)).toBeNull();
  });
});

describe('isEntryIntentFresh', () => {
  it('TTL 內為新鮮', () => {
    const intent = makeEntryIntent('/driver/trip', 1000)!;

    expect(isEntryIntentFresh(intent, 1000 + ENTRY_INTENT_TTL_MS - 1)).toBe(true);
  });

  it('達 TTL 即過期', () => {
    const intent = makeEntryIntent('/driver/trip', 1000)!;

    expect(isEntryIntentFresh(intent, 1000 + ENTRY_INTENT_TTL_MS)).toBe(false);
  });

  it('null 一律不新鮮', () => {
    expect(isEntryIntentFresh(null, 1000)).toBe(false);
  });
});

describe('remember / read / clear（第二輪解析沿用）', () => {
  it('記住後可讀回——這正是 LIFF init 後第二輪解析要靠的路徑', () => {
    rememberEntryIntent('/driver/trip', 1000);

    const intent = readEntryIntent(1000 + 1_600); // prod 實測兩輪相隔約 1.6 秒

    expect(intent?.target).toBe('/driver/trip');
    expect(intent?.end).toBe('driver');
  });

  it('過期後讀不到', () => {
    rememberEntryIntent('/driver/trip', 1000);

    expect(readEntryIntent(1000 + ENTRY_INTENT_TTL_MS)).toBeNull();
  });

  it('清除後讀不到（落地非 login-entry 後不殘留）', () => {
    rememberEntryIntent('/driver/trip', 1000);
    clearEntryIntent();

    expect(readEntryIntent(1000 + 1_000)).toBeNull();
  });

  it('無效目標不會被記住', () => {
    rememberEntryIntent('//evil.example.com', 1000);

    expect(readEntryIntent(1000 + 1_000)).toBeNull();
  });

  it('後記的意圖覆蓋先前的', () => {
    rememberEntryIntent('/driver/trip', 1000);
    rememberEntryIntent('/booking', 1100);

    expect(readEntryIntent(1200)?.target).toBe('/booking');
  });
});
