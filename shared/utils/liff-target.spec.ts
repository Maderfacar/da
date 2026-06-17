import { describe, it, expect } from 'vitest';
import { resolveLiffTarget } from './liff-target';

describe('resolveLiffTarget', () => {
  it('returns liff.state query when safe', () => {
    expect(resolveLiffTarget({ query: { 'liff.state': '/driver/dashboard' } })).toBe('/driver/dashboard');
  });

  it('returns next query when liff.state absent', () => {
    expect(resolveLiffTarget({ query: { next: '/admin/orders' } })).toBe('/admin/orders');
  });

  it('prefers liff.state over next', () => {
    expect(resolveLiffTarget({ query: { 'liff.state': '/a', next: '/b' } })).toBe('/a');
  });

  it('decodes URI-encoded query values', () => {
    expect(resolveLiffTarget({ query: { 'liff.state': '%2Fdriver%2Fdispatched%2Forder123' } }))
      .toBe('/driver/dispatched/order123');
  });

  it('takes first element when query value is array', () => {
    expect(resolveLiffTarget({ query: { 'liff.state': ['/home', '/admin'] } })).toBe('/home');
  });

  it('falls back to pathname when query is missing', () => {
    expect(resolveLiffTarget({ pathname: '/driver/dispatched/xyz' })).toBe('/driver/dispatched/xyz');
  });

  it('ignores pathname when it is root', () => {
    expect(resolveLiffTarget({ pathname: '/' })).toBe('');
  });

  it('rejects open-redirect attempt with scheme', () => {
    expect(resolveLiffTarget({ query: { 'liff.state': 'https://evil.com/path' } })).toBe('');
  });

  it('rejects open-redirect attempt with double slash', () => {
    expect(resolveLiffTarget({ query: { 'liff.state': '//evil.com/path' } })).toBe('');
  });

  it('rejects relative path without leading slash', () => {
    expect(resolveLiffTarget({ query: { 'liff.state': 'driver/dashboard' } })).toBe('');
  });

  it('returns empty when no inputs', () => {
    expect(resolveLiffTarget({})).toBe('');
  });

  it('tolerates malformed URI in query and falls back to pathname', () => {
    // 非法 URI encoding (%E0%A4 截斷) → decodeURIComponent throws → 試 pathname
    expect(resolveLiffTarget({ query: { 'liff.state': '%E0%A4' }, pathname: '/home' })).toBe('/home');
  });
});
