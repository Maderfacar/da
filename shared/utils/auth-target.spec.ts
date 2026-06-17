import { describe, it, expect } from 'vitest';
import { resolveAuthTarget, isLoginEntry } from './auth-target';

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
