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
