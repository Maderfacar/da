import { describe, it, expect } from 'vitest';
import { shouldReportRolesLoadTimeout } from './roles-load-guard';

describe('shouldReportRolesLoadTimeout', () => {
  it('已登入但 roles 仍空 → 要記（真正的「角色載不到」）', () => {
    expect(shouldReportRolesLoadTimeout({ isSignIn: true, rolesCount: 0 })).toBe(true);
  });

  it('訪客（未登入）roles 本來就是空的 → 不記（2026-10-20 / 10-22 訪客開 /booking 誤報）', () => {
    expect(shouldReportRolesLoadTimeout({ isSignIn: false, rolesCount: 0 })).toBe(false);
  });

  it('roles 已就緒 → 不記', () => {
    expect(shouldReportRolesLoadTimeout({ isSignIn: true, rolesCount: 1 })).toBe(false);
  });
});
