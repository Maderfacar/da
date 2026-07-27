import { describe, it, expect } from 'vitest';
import { hasPermission, LEVEL_TABLE, type Permission } from './require-permission';
import type { AuthOk, AdminPermissions } from './require-auth';

// 測試用 AuthOk 建構子（只填 hasPermission 會用到的欄位）
function makeAuth(
  level: AuthOk['level'],
  opts: { roles?: AuthOk['roles']; permissions?: AdminPermissions } = {},
): AuthOk {
  return {
    ok: true,
    uid: 'line:Utest',
    lineUid: 'Utest',
    roles: opts.roles ?? ['admin'],
    approved: true,
    level,
    permissions: opts.permissions,
  };
}

describe('hasPermission — canManageFareRules（車資進階規則權限）', () => {
  it('super 預設可管理車資規則', () => {
    expect(hasPermission(makeAuth('super'), 'canManageFareRules')).toBe(true);
  });

  it('admin 預設不可管理車資規則', () => {
    expect(hasPermission(makeAuth('admin'), 'canManageFareRules')).toBe(false);
  });

  it('assistant 預設不可管理車資規則', () => {
    expect(hasPermission(makeAuth('assistant'), 'canManageFareRules')).toBe(false);
  });

  it('admin 經 override 勾選後可管理車資規則', () => {
    const auth = makeAuth('admin', { permissions: { canManageFareRules: true } });
    expect(hasPermission(auth, 'canManageFareRules')).toBe(true);
  });

  it('super 經 override 明確關閉後不可管理車資規則（override 優先於 level 預設）', () => {
    const auth = makeAuth('super', { permissions: { canManageFareRules: false } });
    expect(hasPermission(auth, 'canManageFareRules')).toBe(false);
  });

  it('非 admin role 一律 false', () => {
    const auth = makeAuth('super', { roles: ['passenger', 'driver'] });
    expect(hasPermission(auth, 'canManageFareRules')).toBe(false);
  });

  it('admin 但 level 缺失（migration 漏建）→ false', () => {
    const auth = makeAuth(undefined);
    expect(hasPermission(auth, 'canManageFareRules')).toBe(false);
  });
});

describe('LEVEL_TABLE — canManageFareRules 預設分佈', () => {
  it('僅 super 預設含 canManageFareRules', () => {
    expect(LEVEL_TABLE.super.has('canManageFareRules')).toBe(true);
    expect(LEVEL_TABLE.admin.has('canManageFareRules')).toBe(false);
    expect(LEVEL_TABLE.assistant.has('canManageFareRules')).toBe(false);
  });

  it('既有權限不受影響（回歸保護）', () => {
    const legacy: Permission[] = ['canManageDrivers', 'canManageOrders', 'canBroadcast', 'canViewFinance', 'canManageFleet'];
    for (const p of legacy) {
      expect(LEVEL_TABLE.admin.has(p)).toBe(true);
    }
    expect(LEVEL_TABLE.super.has('canManageAdmins')).toBe(true);
    expect(LEVEL_TABLE.admin.has('canManageAdmins')).toBe(false);
  });
});
