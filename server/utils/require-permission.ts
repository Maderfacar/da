/**
 * Server-side admin 權限判斷 helper（P18 引入）
 *
 * 與 require-auth 分離：
 *   - require-auth：身分驗證（roles 判斷三端入口）
 *   - require-permission：admin 端內部細粒度操作授權
 *
 * 用法：
 *   import { hasPermission } from '@@/utils/require-permission';
 *   const auth = await getAuthFromEvent(event);
 *   if (!auth.ok) return authFailResponse(auth);
 *   if (!hasPermission(auth, 'canManageAdmins')) {
 *     return forbiddenError({ zh_tw: '權限不足', en: '...', ja: '...' });
 *   }
 *
 * 第一版：依 admins/{lineUid}.level 對應寫死 LEVEL_TABLE；
 *        admins.permissions 為 optional override（單一權限可細粒度開關）。
 *
 * 對應 docs/decision-log.md P18 條目。
 */
import type { AuthOk } from '@@/utils/require-auth';

export type Permission =
  | 'canManageAdmins'
  | 'canManageDrivers'
  | 'canManageOrders'
  | 'canBroadcast'
  | 'canViewFinance'
  | 'canManageFleet';

type AdminLevel = NonNullable<AuthOk['level']>;

/**
 * level → 預設權限對應表
 * - super：全部
 * - admin：除 canManageAdmins 外全部
 * - assistant：僅 canManageOrders、canBroadcast
 */
export const LEVEL_TABLE: Record<AdminLevel, ReadonlySet<Permission>> = {
  super: new Set<Permission>([
    'canManageAdmins',
    'canManageDrivers',
    'canManageOrders',
    'canBroadcast',
    'canViewFinance',
    'canManageFleet',
  ]),
  admin: new Set<Permission>([
    'canManageDrivers',
    'canManageOrders',
    'canBroadcast',
    'canViewFinance',
    'canManageFleet',
  ]),
  assistant: new Set<Permission>([
    'canManageOrders',
    'canBroadcast',
  ]),
};

/**
 * 判斷 caller 是否有指定權限。
 *
 * 優先順序：
 *   1. 非 admin role → 一律 false
 *   2. admin 但 level 缺失（admins doc 不存在 / 格式錯）→ 一律 false（migration 漏建會被擋）
 *   3. admins.permissions[perm] 已寫入 boolean → 用該值（細粒度 override）
 *   4. 其他 → 對 LEVEL_TABLE[level] 查表
 */
export function hasPermission(auth: AuthOk, perm: Permission): boolean {
  if (!auth.roles.includes('admin') || !auth.level) return false;

  const override = auth.permissions?.[perm];
  if (typeof override === 'boolean') return override;

  return LEVEL_TABLE[auth.level].has(perm);
}
