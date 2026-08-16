import { describe, it, expect } from 'vitest';
import { resolveAuthTarget, isLoginEntry, isPathAuthorized, resolveDestination } from './auth-target';

describe('isLoginEntry', () => {
  it('treats root, /login, /driver/auth as login entries', () => {
    expect(isLoginEntry('/')).toBe(true);
    expect(isLoginEntry('/login')).toBe(true);
    expect(isLoginEntry('/driver/auth')).toBe(true);
    expect(isLoginEntry('/driver/auth/callback')).toBe(true);
  });

  it('does not treat other paths as login entries', () => {
    expect(isLoginEntry('/home')).toBe(false);
    expect(isLoginEntry('/admin/orders')).toBe(false);
    expect(isLoginEntry('/driver/dashboard')).toBe(false);
    expect(isLoginEntry('/driver/register')).toBe(false);
    expect(isLoginEntry('/fare')).toBe(false);
  });
});

describe('resolveAuthTarget — / entry', () => {
  const base = { entryPath: '/', isSignIn: true, approved: false };

  it('returns empty when not signed in', () => {
    expect(resolveAuthTarget({ ...base, isSignIn: false, roles: ['passenger'] })).toBe('');
  });

  it('admin → /admin/orders', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'admin'] })).toBe('/admin/orders');
  });

  it('approved driver → /driver/dashboard', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'driver'], approved: true })).toBe('/driver/dashboard');
  });

  it('passenger only → /home', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger'] })).toBe('/home');
  });

  it('pending driver (not approved) → /home', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'driver'], approved: false })).toBe('/home');
  });

  it('roles=[] edge case → /login', () => {
    expect(resolveAuthTarget({ ...base, roles: [] })).toBe('/login');
  });

  it('admin takes precedence over approved driver', () => {
    expect(resolveAuthTarget({ ...base, roles: ['admin', 'driver'], approved: true })).toBe('/admin/orders');
  });
});

describe('resolveAuthTarget — /login entry', () => {
  const base = { entryPath: '/login', isSignIn: true, approved: false };

  it('admin → /admin/orders', () => {
    expect(resolveAuthTarget({ ...base, roles: ['admin'] })).toBe('/admin/orders');
  });

  it('passenger → /home', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger'] })).toBe('/home');
  });
});

describe('resolveAuthTarget — /driver/auth entry', () => {
  const base = { entryPath: '/driver/auth', isSignIn: true, approved: false };

  it('approved driver → /driver/dashboard', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'driver'], approved: true })).toBe('/driver/dashboard');
  });

  it('pending driver → /driver/register', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'driver'], approved: false })).toBe('/driver/register');
  });

  it('admin only (no driver) → /admin/orders', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'admin'] })).toBe('/admin/orders');
  });

  it('passenger only → /driver/register (apply mode)', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger'] })).toBe('/driver/register');
  });

  it('roles=[] → /driver/register (fallback to apply flow)', () => {
    expect(resolveAuthTarget({ ...base, roles: [] })).toBe('/driver/register');
  });
});

describe('resolveAuthTarget — non-login paths', () => {
  it('returns empty for protected paths (decision belongs to other middleware)', () => {
    expect(resolveAuthTarget({
      entryPath: '/admin/orders',
      isSignIn: true,
      roles: ['admin'],
      approved: false,
    })).toBe('');
  });
});

// ── W2：深連結授權校驗 ────────────────────────────────────────
describe('isPathAuthorized', () => {
  it('/driver/auth、/driver/register 公開入口 → 任何已登入者可進', () => {
    expect(isPathAuthorized('/driver/auth', [], false)).toBe(true);
    expect(isPathAuthorized('/driver/register', ['passenger'], false)).toBe(true);
  });

  it('/driver/* 保護頁 → 需 driver 且 approved', () => {
    expect(isPathAuthorized('/driver/trip', ['passenger', 'driver'], true)).toBe(true);
    expect(isPathAuthorized('/driver/trip', ['passenger', 'driver'], false)).toBe(false); // 未核准
    expect(isPathAuthorized('/driver/trip', ['passenger'], true)).toBe(false); // 非司機
  });

  it('/admin/* → 需 admin；/admin/2fa 永遠放行', () => {
    expect(isPathAuthorized('/admin/orders', ['passenger', 'admin'], false)).toBe(true);
    expect(isPathAuthorized('/admin/orders', ['passenger'], false)).toBe(false);
    expect(isPathAuthorized('/admin/2fa/setup', ['passenger'], false)).toBe(true);
  });

  it('乘客頁 → 任何已登入者可進', () => {
    expect(isPathAuthorized('/orders', ['passenger'], false)).toBe(true);
    expect(isPathAuthorized('/home', ['passenger'], false)).toBe(true);
  });
});

describe('resolveDestination — 深連結授權後導向（迴圈修復核心）', () => {
  it('passenger 帶 /driver/trip 深連結 → 不進司機頁，落 /driver/register（不對踢）', () => {
    expect(resolveDestination({
      entryPath: '/driver/auth', isSignIn: true, roles: ['passenger'], approved: false,
      liffTarget: '/driver/trip',
    })).toBe('/driver/register');
  });

  it('approved driver 帶 /driver/trip 深連結 → 授權通過，進 /driver/trip', () => {
    expect(resolveDestination({
      entryPath: '/driver/auth', isSignIn: true, roles: ['passenger', 'driver'], approved: true,
      liffTarget: '/driver/trip',
    })).toBe('/driver/trip');
  });

  it('passenger 帶乘客頁深連結 /orders → 授權通過，進 /orders', () => {
    expect(resolveDestination({
      entryPath: '/login', isSignIn: true, roles: ['passenger'], approved: false,
      liffTarget: '/orders',
    })).toBe('/orders');
  });

  it('無深連結 → 走 resolveAuthTarget 授權落點', () => {
    expect(resolveDestination({
      entryPath: '/login', isSignIn: true, roles: ['passenger'], approved: false,
      liffTarget: '',
    })).toBe('/home');
  });

  it('未登入 → 空字串（顯示登入按鈕）', () => {
    expect(resolveDestination({
      entryPath: '/login', isSignIn: false, roles: [], approved: false,
      liffTarget: '/driver/trip',
    })).toBe('');
  });

  it('非 admin 帶 /admin/* 深連結 → 不進，落乘客授權落點', () => {
    expect(resolveDestination({
      entryPath: '/login', isSignIn: true, roles: ['passenger'], approved: false,
      liffTarget: '/admin/orders',
    })).toBe('/home');
  });
});

// 2026-08-17 迴歸：司機 OA 進站的多重身分者被丟去 admin
// prod client_error_logs 實測：roles=[passenger,admin,driver] / path=/ / liffTarget=null → /admin/orders
describe('resolveAuthTarget — entryEnd 入口端別優先', () => {
  const multiRole = {
    entryPath: '/',
    isSignIn: true,
    roles: ['passenger', 'admin', 'driver'],
    approved: true,
  } as const;

  it('司機 OA 進站的 admin+driver → 司機端，不被 admin 優先蓋掉', () => {
    expect(resolveAuthTarget({ ...multiRole, entryEnd: 'driver' })).toBe('/driver/dashboard');
  });

  it('乘客 OA 進站的 admin+driver → 維持 admin 優先（既有行為不變）', () => {
    expect(resolveAuthTarget({ ...multiRole, entryEnd: 'passenger' })).toBe('/admin/orders');
  });

  it('無 entryEnd → 維持既有 admin 優先（不影響桌機直接開站）', () => {
    expect(resolveAuthTarget({ ...multiRole })).toBe('/admin/orders');
  });

  it('司機 OA 進站但 driver 未核准 → 不硬導司機端，仍回 admin', () => {
    expect(resolveAuthTarget({ ...multiRole, approved: false, entryEnd: 'driver' })).toBe('/admin/orders');
  });

  it('司機 OA 進站的純 admin（無 driver 角色）→ 仍回 admin', () => {
    expect(resolveAuthTarget({
      entryPath: '/', isSignIn: true, roles: ['passenger', 'admin'], approved: false, entryEnd: 'driver',
    })).toBe('/admin/orders');
  });

  it('entryEnd 透過 resolveDestination 傳遞下去', () => {
    expect(resolveDestination({ ...multiRole, liffTarget: '', entryEnd: 'driver' })).toBe('/driver/dashboard');
  });
});
