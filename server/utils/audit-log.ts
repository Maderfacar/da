/**
 * Admin Operation Audit Log（P25-2）
 *
 * 紀錄 admin 在後台的所有變更操作，方便事後追查「誰在何時做了什麼」。
 *
 * 設計（依 [docs/tasks.md](../../docs/tasks.md) P25-2 章節）：
 *   - collection: `audit_logs/{autoId}`，client 全禁讀寫（firestore.rules）
 *   - 失敗一律 silent log，不阻擋主流程（避免 audit 寫失敗讓業務操作失敗）
 *   - actorDisplayName 為「快照」— 從 admins doc 取，若無 fallback users.displayName，再 fallback lineUid
 *   - payload 內 SENSITIVE_KEYS 自動 mask 為 '[REDACTED]'（如 LINE token / password / pin）
 *   - 用 await（非 fire-and-forget）：Vercel serverless 會砍未完成 promise，
 *     await 多 ~100-200ms 但保證寫得到（與 flight.get.ts self-learning 同策略）
 *
 * 用法：
 *   import { writeAuditLog } from '@@/utils/audit-log';
 *   ...
 *   await writeAuditLog({
 *     event,
 *     auth,
 *     action: 'driver.approve',
 *     targetType: 'driver',
 *     targetId: uid,
 *     payload: { before: { approved: false }, after: { approved: true } },
 *   });
 */
import type { H3Event } from 'h3';
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import type { AuthOk } from '@@/utils/require-auth';

/**
 * Audit action 列舉（依 P25-2 spec）
 * - 命名規則：`{targetType}.{verb}`，方便依 prefix 篩選
 */
export type AuditAction =
  // driver / user
  | 'driver.approve'
  | 'driver.reject'
  | 'driver.unblock_cooldown'
  | 'driver.category_change'
  | 'driver.role_add'
  | 'driver.role_remove'
  // P26 driver profile editor
  | 'driver.self_profile_edit'     // driver 自編非證件欄位（phone 等）
  | 'driver.profile_edit'          // admin 編 driver 的 profile
  | 'driver.document_replace'      // driver 上傳新證件（pending 狀態）
  | 'driver.document_review'       // admin 核准 / 退回 pending 證件
  // admin
  | 'admin.add'
  | 'admin.remove'
  | 'admin.level_change'
  | 'admin.permissions_override'
  // order
  | 'order.assign'
  | 'order.status_change'
  | 'order.cancel_by_admin'
  | 'order.edit'
  // broadcast / notify
  | 'broadcast.send'
  | 'broadcast.notify_one'        // legacy（P37 前；passenger / driver 共用）
  | 'admin.notify_passenger'      // P37 Phase 4：點對點通知乘客
  | 'admin.notify_driver'         // P37 Phase 4：點對點通知司機
  // P37 announcement（取代 broadcast.* 的後續發展）
  | 'announcement.create'      // 建草稿
  | 'announcement.update'      // 編輯內容（不變動 status）
  | 'announcement.publish'     // draft → published 首發
  | 'announcement.republish'   // archived → published 重發
  | 'announcement.archive'     // 任意 → archived
  | 'announcement.delete'      // 刪除
  // LINE OA 管理（template 通用，P38 Phase 3）
  // 註：A1 legacy `notification_template.update` action 已在 P40 Phase 4 cleanup 移除（type union 不再 export）；
  // 既有歷史 audit_logs doc 內仍存該字串，UI 查詢可用 targetType='notification_template' 篩
  | 'line.template.update'    // admin 在 /admin/line-management Flex Templates tab 編輯
  | 'line.template.reset'     // admin 還原 registry default
  // P38 LINE OA 管理（richmenu）
  | 'line.richmenu.create'
  | 'line.richmenu.update'
  | 'line.richmenu.publish'
  | 'line.richmenu.unpublish'
  | 'line.richmenu.delete'
  | 'line.richmenu.sync'
  // P42 richmenu lang migration（一次性）
  | 'line.richmenu.migrate.lang'
  // P40 LINE OA 管理（bot replies）
  | 'line.bot_reply.update'
  // fleet
  | 'fleet.create'
  | 'fleet.update'
  | 'fleet.delete'
  // P42 user 自助設定
  | 'user.lang.update'
  // migration（P27 一次性）
  | 'migration.driver_application_move'
  // Legal pages（會員條款 / 隱私政策 admin 編輯）
  | 'legal_page.update'
  // Fare V2 車資進階規則（super admin 編輯）
  | 'fare_rules.update';

export type AuditTargetType = 'driver' | 'admin' | 'order' | 'broadcast' | 'announcement' | 'fleet' | 'migration' | 'notification_template' | 'line_richmenu' | 'bot_reply' | 'user' | 'legal_page' | 'fare_rules';

interface WriteAuditLogInput {
  event: H3Event;
  auth: AuthOk;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  payload?: Record<string, unknown>;
}

/**
 * 敏感欄位 mask 清單（key 名稱比對；遞迴掃 payload 深度 ≤ 5）
 * - 避免把 LINE access token / Firebase token / password 等寫入 audit_logs
 */
const SENSITIVE_KEYS = new Set<string>([
  'accessToken',
  'apiToken',
  'authToken',
  'idToken',
  'refreshToken',
  'lineChannelAccessToken',
  'password',
  'pin',
  'creditCard',
  'cvv',
  'firebaseServiceAccountJson',
]);

const _maskPayload = (obj: unknown, depth = 0): unknown => {
  if (depth > 5) return '[depth-limit]';
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((v) => _maskPayload(v, depth + 1));
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = _maskPayload(v, depth + 1);
      }
    }
    return out;
  }
  return obj;
};

/**
 * 取 client IP：先看 x-forwarded-for（proxy chain，取第一個）、再 fallback x-real-ip
 */
const _getClientIp = (event: H3Event): string => {
  const xff = getHeader(event, 'x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return getHeader(event, 'x-real-ip') ?? '';
};

/**
 * 寫一筆 audit log。**永不 throw**，失敗 silent log。
 * 呼叫方應 `await` 以確保 Vercel serverless 不砍 promise。
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    const { firebaseServiceAccountJson } = useRuntimeConfig();
    if (!firebaseServiceAccountJson) {
      console.warn('[audit-log] firebase not configured, skip');
      return;
    }
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // 取 displayName 快照：admins → users → lineUid
    let actorDisplayName = input.auth.lineUid;
    try {
      const adminSnap = await db.collection('admins').doc(input.auth.lineUid).get();
      if (adminSnap.exists) {
        const adminName = adminSnap.data()?.displayName;
        if (typeof adminName === 'string' && adminName.length > 0) {
          actorDisplayName = adminName;
        }
      }
      if (actorDisplayName === input.auth.lineUid) {
        const userSnap = await db.collection('users').doc(input.auth.lineUid).get();
        if (userSnap.exists) {
          const userName = userSnap.data()?.displayName;
          if (typeof userName === 'string' && userName.length > 0) {
            actorDisplayName = userName;
          }
        }
      }
    } catch (err) {
      // 取 displayName 失敗不阻擋寫 audit log，actorDisplayName 維持 lineUid
      console.warn('[audit-log] displayName lookup failed:', err);
    }

    const maskedPayload = input.payload ? _maskPayload(input.payload) as Record<string, unknown> : {};

    await db.collection('audit_logs').add({
      actorUid: input.auth.lineUid,
      actorDisplayName,
      actorLevel: input.auth.level ?? 'unknown',
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: maskedPayload,
      ip: _getClientIp(input.event),
      userAgent: getHeader(input.event, 'user-agent') ?? '',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // 寫入失敗 silent — 業務主流程已成功，audit 失敗只記 console
    console.error('[audit-log] write failed (silent):', err);
  }
}
