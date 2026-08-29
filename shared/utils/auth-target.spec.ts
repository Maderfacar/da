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

  // 2026-08-29：`/` 是**乘客端**的入口，落點就是乘客端。
  // 舊規則用角色決定端別（有 admin 就丟 /admin/orders），實際後果是
  // 「在網址列打 https://…/ 卻跳到 /admin」—— 使用者指定了乘客端網址，被身分蓋掉。
  it('admin 也落 /home —— 入口決定端別，不是角色決定端別', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'admin'] })).toBe('/home');
  });

  it('approved driver 也落 /home（要進司機端請走 /driver/auth 或司機 OA）', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'driver'], approved: true })).toBe('/home');
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

  it('三重身分（passenger+admin+driver）從網址列打 / → /home，不再被丟去 admin', () => {
    expect(resolveAuthTarget({ ...base, roles: ['passenger', 'admin', 'driver'], approved: true })).toBe('/home');
  });
});

describe('resolveAuthTarget — /login entry', () => {
  const base = { entryPath: '/login', isSignIn: true, approved: false };

  it('admin 從乘客登入頁進來 → /home（頂欄有 ADMIN 鈕，要過去是一個點擊）', () => {
    expect(resolveAuthTarget({ ...base, roles: ['admin'] })).toBe('/home');
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

  it('乘客 OA 進站的 admin+driver → 乘客端 /home', () => {
    expect(resolveAuthTarget({ ...multiRole, entryEnd: 'passenger' })).toBe('/home');
  });

  it('無 entryEnd（桌機直接打網址）→ 乘客端 /home', () => {
    expect(resolveAuthTarget({ ...multiRole })).toBe('/home');
  });

  it('司機 OA 進站但 driver 未核准 → 不硬導司機端，落乘客端 /home', () => {
    expect(resolveAuthTarget({ ...multiRole, approved: false, entryEnd: 'driver' })).toBe('/home');
  });

  it('司機 OA 進站的純 admin（無 driver 角色）→ 落乘客端 /home，不再被丟去 admin', () => {
    expect(resolveAuthTarget({
      entryPath: '/', isSignIn: true, roles: ['passenger', 'admin'], approved: false, entryEnd: 'driver',
    })).toBe('/home');
  });

  it('entryEnd 透過 resolveDestination 傳遞下去', () => {
    expect(resolveDestination({ ...multiRole, liffTarget: '', entryEnd: 'driver' })).toBe('/driver/dashboard');
  });
});

// 2026-08-29：i18n prefix_except_default —— `/en` 與 `/ja/login` 也是入口。
// 在此之前它們不算入口，英日語系的已登入使用者打首頁完全不會被分流，
// 停在行銷 landing 上。本機瀏覽器是 zh-TW 所以一直沒人踩到。
describe('resolveAuthTarget — 語系前綴（/en、/ja）', () => {
  const signedIn = { isSignIn: true, roles: ['passenger'], approved: false } as const;

  it('/en 也算乘客端入口', () => {
    expect(isLoginEntry('/en')).toBe(true);
    expect(isLoginEntry('/ja/login')).toBe(true);
    expect(isLoginEntry('/en/driver/auth')).toBe(true);
  });

  it('/en → /en/home（不把英日使用者切回中文）', () => {
    expect(resolveAuthTarget({ ...signedIn, entryPath: '/en' })).toBe('/en/home');
    expect(resolveAuthTarget({ ...signedIn, entryPath: '/ja/login' })).toBe('/ja/home');
  });

  it('/en 的多重身分者一樣落乘客端，不進 admin', () => {
    expect(resolveAuthTarget({
      entryPath: '/en', isSignIn: true, roles: ['passenger', 'admin', 'driver'], approved: true,
    })).toBe('/en/home');
  });

  it('/ja/driver/auth 的 approved driver → /ja/driver/dashboard', () => {
    expect(resolveAuthTarget({
      entryPath: '/ja/driver/auth', isSignIn: true, roles: ['driver'], approved: true,
    })).toBe('/ja/driver/dashboard');
  });

  it('不是入口的語系路徑仍回空字串', () => {
    expect(resolveAuthTarget({ ...signedIn, entryPath: '/en/orders' })).toBe('');
  });
});
