import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeTarget,
  normalizeClientType,
  lineLoginRedirectUri,
  createLoginState,
  consumeLoginState,
  purgeExpiredLoginStates,
  LINE_CALLBACK_PATH,
  LINE_PROD_ORIGIN,
  LOGIN_STATE_TTL_MS,
} from './line-login-state';

describe('sanitizeTarget', () => {
  it('合法站內路徑原樣回傳', () => {
    expect(sanitizeTarget('/orders/abc', 'passenger')).toBe('/orders/abc');
    expect(sanitizeTarget('/driver/dispatched/x1', 'driver')).toBe('/driver/dispatched/x1');
    expect(sanitizeTarget('/orders?tab=upcoming', 'passenger')).toBe('/orders?tab=upcoming');
  });

  it('非字串 → 端別 fallback', () => {
    expect(sanitizeTarget(undefined, 'passenger')).toBe('/');
    expect(sanitizeTarget(123, 'driver')).toBe('/driver/dashboard');
    expect(sanitizeTarget(['/a', '/b'], 'passenger')).toBe('/');
  });

  it('非 / 開頭 → fallback', () => {
    expect(sanitizeTarget('orders', 'passenger')).toBe('/');
    expect(sanitizeTarget('https://evil.com', 'passenger')).toBe('/');
  });

  it('protocol-relative // → fallback（open redirect 防護）', () => {
    expect(sanitizeTarget('//evil.com', 'passenger')).toBe('/');
    expect(sanitizeTarget('//evil.com/path', 'driver')).toBe('/driver/dashboard');
  });

  it('含 scheme（:）→ fallback', () => {
    expect(sanitizeTarget('/redirect:javascript', 'passenger')).toBe('/');
    expect(sanitizeTarget('javascript:alert(1)', 'passenger')).toBe('/');
  });

  it('含反斜線 / 控制字元 / 空白 → fallback', () => {
    expect(sanitizeTarget('/a\\b', 'passenger')).toBe('/');
    expect(sanitizeTarget('/a b', 'passenger')).toBe('/');
    expect(sanitizeTarget('/a\nb', 'passenger')).toBe('/');
  });

  it('前後空白會 trim 後再判定', () => {
    expect(sanitizeTarget('  /orders  ', 'passenger')).toBe('/orders');
    expect(sanitizeTarget('   ', 'passenger')).toBe('/');
  });
});

describe('normalizeClientType', () => {
  it('driver 保留，其餘一律 passenger', () => {
    expect(normalizeClientType('driver')).toBe('driver');
    expect(normalizeClientType('passenger')).toBe('passenger');
    expect(normalizeClientType('admin')).toBe('passenger');
    expect(normalizeClientType(undefined)).toBe('passenger');
  });
});

describe('lineLoginRedirectUri', () => {
  it('siteUrl 有值時用之，去除尾斜線', () => {
    expect(lineLoginRedirectUri('https://foo.example.com')).toBe(`https://foo.example.com${LINE_CALLBACK_PATH}`);
    expect(lineLoginRedirectUri('https://foo.example.com/')).toBe(`https://foo.example.com${LINE_CALLBACK_PATH}`);
  });

  it('siteUrl 空 → fallback prod origin', () => {
    expect(lineLoginRedirectUri('')).toBe(`${LINE_PROD_ORIGIN}${LINE_CALLBACK_PATH}`);
    expect(lineLoginRedirectUri(undefined)).toBe(`${LINE_PROD_ORIGIN}${LINE_CALLBACK_PATH}`);
    expect(lineLoginRedirectUri(null)).toBe(`${LINE_PROD_ORIGIN}${LINE_CALLBACK_PATH}`);
  });
});

// ── 測試用 fake Firestore（含 transaction）────────────────────────
function makeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const docRef = (id: string) => ({ __id: id });
  const db = {
    collection: () => ({
      doc: (id: string) => ({
        ...docRef(id),
        set: async (data: Record<string, unknown>) => { store.set(id, data); },
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        // 真 Firestore：read 於讀取當下快照資料，delete 為緩衝寫入（commit 才生效）。
        // 故 snap.data() 須擷取讀取當下的值，不可在 tx.delete 後才 lazy 讀 store。
        get: async (ref: { __id: string }) => {
          const snapshot = store.get(ref.__id);
          return { exists: snapshot !== undefined, data: () => snapshot };
        },
        delete: (ref: { __id: string }) => { store.delete(ref.__id); },
      };
      return fn(tx);
    },
  };
  return { db: db as never, store };
}

describe('createLoginState / consumeLoginState', () => {
  it('建立後可消費一次，取回 target / clientType / nonce', async () => {
    const { db } = makeDb();
    const { state, nonce } = await createLoginState(db, { target: '/orders', clientType: 'passenger' });
    expect(state).toHaveLength(64); // 32 bytes hex
    expect(nonce).toHaveLength(32); // 16 bytes hex

    const payload = await consumeLoginState(db, state);
    expect(payload).toEqual({ target: '/orders', clientType: 'passenger', nonce });
  });

  it('消費一次後即失效（replay 防護）', async () => {
    const { db } = makeDb();
    const { state } = await createLoginState(db, { target: '/driver/dashboard', clientType: 'driver' });
    expect(await consumeLoginState(db, state)).not.toBeNull();
    expect(await consumeLoginState(db, state)).toBeNull(); // 第二次已被刪
  });

  it('不存在的 state → null', async () => {
    const { db } = makeDb();
    expect(await consumeLoginState(db, 'a'.repeat(64))).toBeNull();
  });

  it('過短 state → null（免打 Firestore）', async () => {
    const { db } = makeDb();
    expect(await consumeLoginState(db, 'short')).toBeNull();
    expect(await consumeLoginState(db, '')).toBeNull();
  });

  it('已過期 state → null 且仍被刪除', async () => {
    const { db, store } = makeDb();
    const { state } = await createLoginState(db, { target: '/orders', clientType: 'passenger' });
    // 竄改 expiresAt 為過去
    const doc = store.get(state)!;
    const past = Date.now() - LOGIN_STATE_TTL_MS - 1000;
    doc.expiresAt = { toMillis: () => past };
    expect(await consumeLoginState(db, state)).toBeNull();
    expect(store.has(state)).toBe(false); // 過期也一次性刪除
  });
});

// ── purgeExpiredLoginStates：批次刪過期 doc（fake query builder）─────
function makeCleanupDb(expiredIds: string[]) {
  const remaining = new Set(expiredIds);
  const deleted: string[] = [];
  const db = {
    collection: () => ({
      where: () => ({
        orderBy: () => ({
          limit: (n: number) => ({
            get: async () => {
              const ids = [...remaining].slice(0, n);
              return {
                empty: ids.length === 0,
                size: ids.length,
                docs: ids.map((id) => ({ ref: { __id: id } })),
              };
            },
          }),
        }),
      }),
    }),
    batch: () => ({
      delete: (ref: { __id: string }) => { deleted.push(ref.__id); },
      commit: async () => { deleted.forEach((id) => remaining.delete(id)); },
    }),
  };
  return { db: db as never, deleted, remaining };
}

describe('purgeExpiredLoginStates', () => {
  it('刪除所有過期 doc，回總數', async () => {
    const { db, remaining } = makeCleanupDb(['a', 'b', 'c']);
    const res = await purgeExpiredLoginStates(db);
    expect(res.deleted).toBe(3);
    expect(res.hasMore).toBe(false);
    expect(remaining.size).toBe(0);
  });

  it('無過期 doc → deleted 0、不 hasMore', async () => {
    const { db } = makeCleanupDb([]);
    const res = await purgeExpiredLoginStates(db);
    expect(res).toEqual({ deleted: 0, batches: 0, hasMore: false });
  });
});
