import { describe, it, expect } from 'vitest';
import { isPublicRoute, PUBLIC_ROUTE_PREFIXES } from './auth-public-routes';

describe('isPublicRoute', () => {
  it('treats root path as public', () => {
    expect(isPublicRoute('/')).toBe(true);
  });

  it('treats listed prefix /fare as public', () => {
    expect(isPublicRoute('/fare')).toBe(true);
  });

  it('treats nested path under listed prefix as public', () => {
    expect(isPublicRoute('/legal/terms')).toBe(true);
    expect(isPublicRoute('/legal/privacy')).toBe(true);
  });

  it('strips /en locale prefix before matching', () => {
    expect(isPublicRoute('/en/fare')).toBe(true);
    expect(isPublicRoute('/en')).toBe(true);
    expect(isPublicRoute('/en/')).toBe(true);
  });

  it('strips /ja locale prefix before matching nested public path', () => {
    expect(isPublicRoute('/ja/fleet')).toBe(true);
    expect(isPublicRoute('/ja/legal/terms')).toBe(true);
  });

  it('treats authenticated routes as non-public', () => {
    expect(isPublicRoute('/home')).toBe(false);
    expect(isPublicRoute('/booking')).toBe(false);
    expect(isPublicRoute('/orders')).toBe(false);
    expect(isPublicRoute('/admin/orders')).toBe(false);
    expect(isPublicRoute('/driver/dashboard')).toBe(false);
  });

  it('treats driver login + register entries as public (W4-FU)', () => {
    // 司機端 LIFF 登入入口應與乘客 /login 對稱不被 BootGate 卡住
    expect(isPublicRoute('/driver/auth')).toBe(true);
    expect(isPublicRoute('/driver/register')).toBe(true);
    // 三語系都要放行
    expect(isPublicRoute('/en/driver/auth')).toBe(true);
    expect(isPublicRoute('/ja/driver/register')).toBe(true);
  });

  it('treats vehicles public profile as public', () => {
    expect(isPublicRoute('/vehicles')).toBe(true);
    expect(isPublicRoute('/vehicles/some-driver-uid')).toBe(true);
  });

  it('does not treat driver private pages as public', () => {
    // /driver/auth + /driver/register 加 public 不可誤波及 dashboard / trip 等
    expect(isPublicRoute('/driver/dashboard')).toBe(false);
    expect(isPublicRoute('/driver/trip')).toBe(false);
    expect(isPublicRoute('/driver/profile')).toBe(false);
    expect(isPublicRoute('/driver/cost')).toBe(false);
    // 子字串攻擊：/driver/authdashboard 不可被 startsWith 漏過
    expect(isPublicRoute('/driver/authdashboard')).toBe(false);
    expect(isPublicRoute('/driver/registerfoo')).toBe(false);
  });

  it('does not partial-match a different route that shares a prefix substring', () => {
    // /faqother 不可被當作 /faq 的子路徑放行
    expect(isPublicRoute('/faqother')).toBe(false);
    expect(isPublicRoute('/fleetdriver')).toBe(false);
  });

  it('treats empty string as non-public', () => {
    expect(isPublicRoute('')).toBe(false);
  });

  it('exports a non-empty readonly prefix list', () => {
    expect(PUBLIC_ROUTE_PREFIXES.length).toBeGreaterThan(0);
    expect(PUBLIC_ROUTE_PREFIXES).toContain('/');
    expect(PUBLIC_ROUTE_PREFIXES).toContain('/fleet');
  });
});
