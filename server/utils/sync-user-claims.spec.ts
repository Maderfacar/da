import { describe, it, expect, vi } from 'vitest';
import { parseRolesLoose, syncUserClaims, type Role } from './sync-user-claims';

describe('parseRolesLoose', () => {
  it('陣列直接濾出合法角色', () => {
    expect(parseRolesLoose(['passenger', 'admin', 'x'])).toEqual(['passenger', 'admin']);
  });

  it('字串（Console 誤存）"[\'passenger\',\'driver\']" 可 parse', () => {
    expect(parseRolesLoose('[\'passenger\',\'driver\']')).toEqual(['passenger', 'driver']);
  });

  it('逗號字串 "passenger,admin" 可 parse', () => {
    expect(parseRolesLoose('passenger,admin')).toEqual(['passenger', 'admin']);
  });

  it('非法輸入回空陣列', () => {
    expect(parseRolesLoose(undefined)).toEqual([]);
    expect(parseRolesLoose(123)).toEqual([]);
    expect(parseRolesLoose(['nope'])).toEqual([]);
  });
});

// ── 測試用 fake Firestore / Auth ────────────────────────────────
function makeDb(userData: Record<string, unknown> | null) {
  const setSpy = vi.fn().mockResolvedValue(undefined);
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: userData !== null, data: () => userData ?? undefined }),
        set: setSpy,
      }),
    }),
  };
  return { db: db as never, setSpy };
}

function makeAuth(shouldThrow = false) {
  const setClaims = vi.fn(shouldThrow
    ? () => Promise.reject(new Error('user-not-found'))
    : () => Promise.resolve(undefined));
  return { auth: { setCustomUserClaims: setClaims } as never, setClaims };
}

describe('syncUserClaims', () => {
  it('傳入已知 roles 時不讀 Firestore，直接寫 persistent claims', async () => {
    const { db, setSpy } = makeDb(null);
    const { auth, setClaims } = makeAuth();
    const roles: Role[] = ['passenger', 'admin'];

    const res = await syncUserClaims(auth, db, 'Uabc', { roles });

    expect(res).toEqual({ ok: true, roles });
    expect(setClaims).toHaveBeenCalledWith('line:Uabc', { roles });
    expect(setSpy).toHaveBeenCalledTimes(1); // claimsUpdatedAt bump
  });

  it('未傳 roles → 從 Firestore users doc 讀', async () => {
    const { db } = makeDb({ roles: ['passenger', 'driver'] });
    const { auth, setClaims } = makeAuth();

    const res = await syncUserClaims(auth, db, 'Uxyz');

    expect(res.ok).toBe(true);
    expect(res.roles).toEqual(['passenger', 'driver']);
    expect(setClaims).toHaveBeenCalledWith('line:Uxyz', { roles: ['passenger', 'driver'] });
  });

  it('roles 為空 → fallback ["passenger"]', async () => {
    const { db } = makeDb({ roles: [] });
    const { auth, setClaims } = makeAuth();

    const res = await syncUserClaims(auth, db, 'Uempty');

    expect(res.roles).toEqual(['passenger']);
    expect(setClaims).toHaveBeenCalledWith('line:Uempty', { roles: ['passenger'] });
  });

  it('setCustomUserClaims 失敗（user 不存在）→ ok:false 不 throw', async () => {
    const { db } = makeDb(null);
    const { auth } = makeAuth(true);

    const res = await syncUserClaims(auth, db, 'Ughost', { roles: ['passenger'] });

    expect(res.ok).toBe(false);
    expect(res.reason).toContain('setCustomUserClaims failed');
  });
});
