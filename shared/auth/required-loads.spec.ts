import { describe, it, expect } from 'vitest';
import { resolveRequiredLoads } from './required-loads';

describe('required-loads', () => {
  it('純公開頁（非 login entry） — 不需任何 doc', () => {
    expect(resolveRequiredLoads('/fleet')).toEqual({ user: false, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/fare')).toEqual({ user: false, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/faq')).toEqual({ user: false, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/legal/terms')).toEqual({ user: false, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/legal/privacy')).toEqual({ user: false, driver: false, admin: false, admin2fa: false });
  });

  it('login entry — 需 users（為了算分流 target，即使 / 與 /login 同時是公開頁）', () => {
    expect(resolveRequiredLoads('/')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/login')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/driver/auth')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
  });

  it('passenger 受保護頁 — 需 users', () => {
    expect(resolveRequiredLoads('/home')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/booking')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/orders')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/orders/abc123')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/notifications')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/referral')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
  });

  it('/driver/register — 需 users（檢查 driver+approved 該不該跳 dashboard）', () => {
    expect(resolveRequiredLoads('/driver/register')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
  });

  it('driver 受保護頁 — 需 users + drivers', () => {
    expect(resolveRequiredLoads('/driver/dashboard')).toEqual({ user: true, driver: true, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/driver/dispatched')).toEqual({ user: true, driver: true, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/driver/trip/xxx')).toEqual({ user: true, driver: true, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/driver/profile')).toEqual({ user: true, driver: true, admin: false, admin2fa: false });
  });

  it('/admin/2fa/* — 需 users 但不需 admin doc / 2fa session（避免迴圈）', () => {
    expect(resolveRequiredLoads('/admin/2fa/setup')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/admin/2fa/challenge')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
  });

  it('admin 受保護頁 — 需 users + admins + 2fa session', () => {
    expect(resolveRequiredLoads('/admin/orders')).toEqual({ user: true, driver: false, admin: true, admin2fa: true });
    expect(resolveRequiredLoads('/admin/war-room')).toEqual({ user: true, driver: false, admin: true, admin2fa: true });
    expect(resolveRequiredLoads('/admin/settings')).toEqual({ user: true, driver: false, admin: true, admin2fa: true });
    expect(resolveRequiredLoads('/admin/drivers')).toEqual({ user: true, driver: false, admin: true, admin2fa: true });
  });

  it('語系前綴 /en /ja — 剝掉再判斷', () => {
    expect(resolveRequiredLoads('/en/fleet')).toEqual({ user: false, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/ja/home')).toEqual({ user: true, driver: false, admin: false, admin2fa: false });
    expect(resolveRequiredLoads('/en/admin/orders')).toEqual({ user: true, driver: false, admin: true, admin2fa: true });
    expect(resolveRequiredLoads('/ja/driver/dashboard')).toEqual({ user: true, driver: true, admin: false, admin2fa: false });
  });

  it('空字串 / 未匹配 path — 安全 fallback', () => {
    expect(resolveRequiredLoads('')).toEqual({ user: false, driver: false, admin: false, admin2fa: false });
  });
});
