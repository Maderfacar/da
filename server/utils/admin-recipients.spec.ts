import { describe, it, expect } from 'vitest';
import { adminDocHasPermission } from './admin-recipients';

describe('adminDocHasPermission', () => {
  describe('level 預設（無 override）', () => {
    it('super 具 canManageOrders / canManageAdmins', () => {
      expect(adminDocHasPermission({ level: 'super' }, 'canManageOrders')).toBe(true);
      expect(adminDocHasPermission({ level: 'super' }, 'canManageAdmins')).toBe(true);
    });

    it('admin 具 canManageOrders 但不具 canManageAdmins', () => {
      expect(adminDocHasPermission({ level: 'admin' }, 'canManageOrders')).toBe(true);
      expect(adminDocHasPermission({ level: 'admin' }, 'canManageAdmins')).toBe(false);
    });

    it('assistant 具 canManageOrders 但不具 canManageDrivers', () => {
      expect(adminDocHasPermission({ level: 'assistant' }, 'canManageOrders')).toBe(true);
      expect(adminDocHasPermission({ level: 'assistant' }, 'canManageDrivers')).toBe(false);
    });
  });

  describe('permissions override', () => {
    it('override true 可開啟 level 預設沒有的權限', () => {
      expect(
        adminDocHasPermission(
          { level: 'assistant', permissions: { canManageDrivers: true } },
          'canManageDrivers',
        ),
      ).toBe(true);
    });

    it('override false 可關閉 level 預設有的權限', () => {
      expect(
        adminDocHasPermission(
          { level: 'assistant', permissions: { canManageOrders: false } },
          'canManageOrders',
        ),
      ).toBe(false);
    });

    it('override 只影響該權限，其他權限仍走 level 預設', () => {
      const data = { level: 'admin', permissions: { canManageOrders: false } };
      expect(adminDocHasPermission(data, 'canManageOrders')).toBe(false);
      expect(adminDocHasPermission(data, 'canBroadcast')).toBe(true);
    });
  });

  describe('level 缺失 / 非法', () => {
    it('level 缺失一律 false', () => {
      expect(adminDocHasPermission({}, 'canManageOrders')).toBe(false);
    });

    it('非法 level 一律 false', () => {
      expect(adminDocHasPermission({ level: 'guest' }, 'canManageOrders')).toBe(false);
    });

    it('level 缺失即使有 override true 仍 false', () => {
      expect(
        adminDocHasPermission({ permissions: { canManageOrders: true } }, 'canManageOrders'),
      ).toBe(false);
    });
  });
});
