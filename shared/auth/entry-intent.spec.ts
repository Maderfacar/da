import { beforeEach, describe, expect, it } from 'vitest';
import {
  ENTRY_INTENT_TTL_MS,
  _resetEntryIntentForTest,
  clearEntryIntent,
  entryEndOf,
  isEntryIntentFresh,
  makeEntryIntent,
  readEntryIntent,
  rememberEntryEnd,
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

// 2026-08-17：司機 OA 進站時 pathname 仍是 `/`、深連結尚未出現，
// 唯一可信的端別訊號是「實際成功 liff.init 的 LIFF ID」。
describe('rememberEntryEnd（只記端別、不帶目標）', () => {
  it('記下端別，target 為空字串', () => {
    rememberEntryEnd('driver', 1000);

    const intent = readEntryIntent(1500);
    expect(intent?.end).toBe('driver');
    expect(intent?.target).toBe('');
  });

  it('不覆蓋已帶深連結目標的意圖（深連結較精確，不可降級）', () => {
    rememberEntryIntent('/driver/trip', 1000);
    rememberEntryEnd('passenger', 1100);

    const intent = readEntryIntent(1200);
    expect(intent?.target).toBe('/driver/trip');
    expect(intent?.end).toBe('driver');
  });

  it('已有的純端別意圖可被後來的深連結升級', () => {
    rememberEntryEnd('driver', 1000);
    rememberEntryIntent('/driver/dispatched', 1100);

    expect(readEntryIntent(1200)?.target).toBe('/driver/dispatched');
  });

  it('過期的端別意圖不會生效', () => {
    rememberEntryEnd('driver', 1000);

    expect(readEntryIntent(1000 + ENTRY_INTENT_TTL_MS)).toBeNull();
  });
});

// ── 死路由防護（2026-08-29）────────────────────────────────────────────────
// 現場：tab bar 指向不存在的 /profile → 404 → LIFF 返回鍵重進站 → middleware 依 intent
// 又導回 /profile → 再 404。中間 LIFF 重跑 OAuth（舊 code 重用），prod 實測卡 104 秒。
// 規則：死路由降級成「只知端別」，不是整份丟掉 —— 端別仍要保住，否則多重身分者會落回
// 角色預設被丟去 admin 端（即 2026-08-17 修過的那顆）。
const routeExists = (path: string) => path.split('?')[0] !== '/profile';

describe('死路由降級', () => {
  it('makeEntryIntent：目標無對應頁面時只保留端別', () => {
    expect(makeEntryIntent('/profile', 1000, routeExists)).toEqual({ target: '', end: 'passenger', at: 1000 });
  });

  it('makeEntryIntent：死路由仍由原路徑推導端別（保住 driver，不落回角色預設）', () => {
    expect(makeEntryIntent('/driver/gone', 1000, () => false)).toEqual({
      target: '',
      end: 'driver',
      at: 1000,
    });
  });

  it('makeEntryIntent：存在的路由不受影響', () => {
    expect(makeEntryIntent('/orders', 1000, routeExists)).toEqual({ target: '/orders', end: 'passenger', at: 1000 });
  });

  it('不傳 routeExists 時維持舊行為（不檢查）', () => {
    expect(makeEntryIntent('/profile', 1000)).toEqual({ target: '/profile', end: 'passenger', at: 1000 });
  });

  it('帶 query 的死路由一樣被擋', () => {
    expect(makeEntryIntent('/profile?liff.hback=2', 1000, routeExists)?.target).toBe('');
  });

  it('rememberEntryIntent：死路由不會洗掉前一輪記到的正確目標', () => {
    rememberEntryIntent('/driver/trip', 1000, routeExists);
    rememberEntryIntent('/profile', 1100, routeExists);

    expect(readEntryIntent(1200, routeExists)?.target).toBe('/driver/trip');
  });

  it('readEntryIntent：記憶體裡的死路由在讀取時也會被降級', () => {
    rememberEntryIntent('/profile', 1000);

    const intent = readEntryIntent(1100, routeExists);
    expect(intent?.target).toBe('');
    expect(intent?.end).toBe('passenger');
  });
});
