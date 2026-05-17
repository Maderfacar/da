/**
 * admin 推播收件人解析（admin-auto-notify-dashboard 變更）
 *
 * 與 require-permission.ts 的差異：
 *   - hasPermission(auth, perm)：吃 AuthOk，判定「目前登入者」的權限
 *   - adminDocHasPermission(data, perm)：吃單筆 admins doc data，供逐筆掃描收件人
 *
 * 用途：解析所有具指定權限的 admin lineUid，作為自動通知推播目標。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { LEVEL_TABLE, type Permission } from '@@/utils/require-permission';

type AdminLevel = 'super' | 'admin' | 'assistant';

interface AdminDocData {
  level?: string;
  permissions?: Record<string, boolean> | null;
}

/**
 * 依 admin doc 的 level + permissions override 判定單一權限。
 * 邏輯與 require-permission.ts 的 hasPermission 完全對齊：
 *   1. level 缺失 / 非法 → false
 *   2. permissions[perm] 已寫 boolean → 用該 override
 *   3. 其他 → 查 LEVEL_TABLE[level]
 */
export function adminDocHasPermission(data: AdminDocData, perm: Permission): boolean {
  const level = data.level as AdminLevel | undefined;
  if (!level || !(level in LEVEL_TABLE)) return false;

  const override = data.permissions?.[perm];
  if (typeof override === 'boolean') return override;

  return LEVEL_TABLE[level].has(perm);
}

/**
 * 回傳所有具指定權限的 admin lineUid（= admins collection 的 doc id）。
 *
 * 直接 .get() 全表後在記憶體 filter：admins 是極小集合（個位數～數十筆），
 * 且 permissions override「優先於 level 預設」的邏輯無法用單一 Firestore where 表達。
 */
export async function getAdminRecipients(db: Firestore, perm: Permission): Promise<string[]> {
  const snap = await db.collection('admins').get();
  return snap.docs
    .filter((d) => adminDocHasPermission(d.data() as AdminDocData, perm))
    .map((d) => d.id);
}
