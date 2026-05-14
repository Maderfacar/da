/**
 * PATCH /nuxt-api/admin/announcements/[id]
 *
 * 編輯 / 變更 status（含 publish / archive）。
 *
 * Body（**任意子集**）：
 *   {
 *     // 內容欄位（draft / published / archived 都可改）
 *     title?: string
 *     body?: string
 *     coverImageUrl?: string | null
 *     ctaButton?: { label, url } | null
 *     targetType?: ...
 *     targetOrderId?: string | null
 *     channels?: { line, inApp }
 *
 *     // 狀態變更（任意循環：draft ↔ published ↔ archived）
 *     status?: 'draft' | 'published' | 'archived'
 *   }
 *
 * LINE push 觸發判定（依 design.md §8.6）：
 *   - oldStatus !== 'published' && newStatus === 'published' → 推
 *     - draft → published：audit `announcement.publish`
 *     - archived → published：audit `announcement.republish`
 *   - 其他狀態變化 / 純編輯 → 不推 LINE
 *
 * P37 Phase 4：實推 LINE（取代 Phase 2 stub）
 *   - 撈 audience（target='order' → 訂單 owner；其餘 → users where roles）
 *   - 依 target 分流 OA：passenger / driver；'all' 則 driver role 走 driver OA、其餘 passenger OA
 *   - 有 coverImageUrl/ctaButton → Flex Message；否則 text fallback
 *   - sendLineMulticast 批次推（每 500 / call）
 *
 * 副作用：
 *   - audit log（依 status 變化或編輯動作）
 *   - 觸發 publish 時：rate-limit 10/hr/admin
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog, type AuditAction } from '@@/utils/audit-log';
import { checkRateLimit, rateLimitedResponse } from '@@/utils/rate-limit';
import {
  validateAnnouncementBody,
  sanitizeBody,
  type AnnouncementWriteInput,
  type AnnouncementStatus,
} from '@@/utils/announcement';
import { sendLineMulticast, type LineMessage } from '@@/utils/line-push';
import { buildAnnouncementFlex } from '@@/utils/announcement-flex';
import type { LineClient } from '@@/utils/line-channel';

interface PatchBody extends AnnouncementWriteInput {
  status?: AnnouncementStatus;
}

const VALID_STATUS: AnnouncementStatus[] = ['draft', 'published', 'archived'];

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: 'id 缺失', en: 'id is required', ja: 'id が必要です' });
  }

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  if (body.status !== undefined && !VALID_STATUS.includes(body.status)) {
    return badRequestError({ zh_tw: 'status 參數錯誤', en: 'Invalid status', ja: 'status が無効' });
  }

  // 內容欄位（不含 status）驗證
  const validateErr = validateAnnouncementBody(body, /* requireAll */ false);
  if (validateErr) {
    return badRequestError({ zh_tw: validateErr, en: validateErr, ja: validateErr });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('announcements').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '公告不存在', en: 'Announcement not found', ja: 'お知らせが見つかりません' });
    }
    const existing = snap.data() ?? {};
    const oldStatus = existing.status as AnnouncementStatus;
    const newStatus: AnnouncementStatus = body.status ?? oldStatus;

    // ── publish 觸發前先檢查 rate-limit ───────────────────
    const isPublishing = oldStatus !== 'published' && newStatus === 'published';
    if (isPublishing) {
      try {
        const limit = await checkRateLimit(db, {
          key: `announcement-publish:uid:${auth.lineUid}`,
          windowSec: 3600,
          max: 10,
        });
        if (!limit.ok) {
          setResponseHeader(event, 'Retry-After', limit.retryAfter ?? 3600);
          return rateLimitedResponse(limit.retryAfter ?? 3600);
        }
      } catch {
        // rate-limit fail-open
      }
    }

    // ── 組裝 update payload ─────────────────────────────
    const update: Record<string, unknown> = {};
    if (body.title !== undefined) update.title = body.title.trim();
    if (body.body !== undefined) update.body = sanitizeBody(body.body);
    if (body.coverImageUrl !== undefined) update.coverImageUrl = body.coverImageUrl;
    if (body.ctaButton !== undefined) update.ctaButton = body.ctaButton;
    if (body.targetType !== undefined) {
      update.targetType = body.targetType;
      update.targetOrderId = body.targetType === 'order' ? (body.targetOrderId ?? null) : null;
    }
    if (body.channels !== undefined) update.channels = body.channels;

    if (body.status !== undefined && body.status !== oldStatus) {
      update.status = body.status;
      if (body.status === 'published') {
        update.publishedAt = FieldValue.serverTimestamp();
      }
      if (body.status === 'archived') {
        update.archivedAt = FieldValue.serverTimestamp();
      }
    }

    // ── Publish 額外動作：撈 targets + push LINE + 寫 pushStats ──────────────
    // P37 Phase 4：取代 Phase 2 留的 stub；inline 處理 role-aware OA 分流 + Flex 組裝。
    if (isPublishing) {
      const mergedTargetType = (body.targetType ?? existing.targetType) as 'all' | 'passenger' | 'driver' | 'order';
      const mergedTargetOrderId = (body.targetOrderId !== undefined
        ? body.targetOrderId
        : existing.targetOrderId) as string | null;
      const mergedChannels = (body.channels ?? existing.channels) as { line: boolean; inApp: boolean };
      const mergedTitle = (body.title ?? existing.title) as string;
      const mergedBody = (body.body ?? existing.body) as string;
      const mergedCover = (body.coverImageUrl !== undefined
        ? body.coverImageUrl
        : existing.coverImageUrl) as string | null;
      const mergedCta = (body.ctaButton !== undefined
        ? body.ctaButton
        : existing.ctaButton) as { label: string; url: string } | null;

      interface PushTarget { lineUserId: string; client: LineClient }
      const targets: PushTarget[] = [];

      if (mergedTargetType === 'order') {
        if (mergedTargetOrderId) {
          const orderSnap = await db.collection('orders').doc(mergedTargetOrderId).get();
          if (orderSnap.exists) {
            const ownerLineUid = orderSnap.data()?.userId as string | undefined;
            if (ownerLineUid) targets.push({ lineUserId: ownerLineUid, client: 'passenger' });
          }
        }
      } else {
        let q = db.collection('users') as FirebaseFirestore.Query;
        if (mergedTargetType !== 'all') {
          q = q.where('roles', 'array-contains', mergedTargetType);
        }
        const usersSnap = await q.get();
        usersSnap.docs.forEach((doc) => {
          const data = doc.data();
          const lineUserId = data.lineUserId as string | undefined;
          if (!lineUserId) return;
          const roles: string[] = Array.isArray(data.roles) ? data.roles : [];
          let client: LineClient;
          if (mergedTargetType === 'driver') client = 'driver';
          else if (mergedTargetType === 'passenger') client = 'passenger';
          else client = roles.includes('driver') ? 'driver' : 'passenger'; // 'all'
          targets.push({ lineUserId, client });
        });
      }

      let sentCount = 0;
      let failedCount = 0;

      if (mergedChannels.line && targets.length > 0) {
        // 有 coverImageUrl 或 ctaButton → Flex；否則 text fallback
        const hasRichContent = !!mergedCover || !!mergedCta;
        const flexMsg: LineMessage = hasRichContent
          ? buildAnnouncementFlex({
            title: mergedTitle,
            body: mergedBody,
            coverImageUrl: mergedCover,
            ctaButton: mergedCta,
          })
          : {
            type: 'text',
            text: [`📢 ${mergedTitle}`, '', mergedBody.replace(/<[^>]+>/g, '').slice(0, 1000)].join('\n'),
          };

        const passengerIds = targets.filter((t) => t.client === 'passenger').map((t) => t.lineUserId);
        const driverIds    = targets.filter((t) => t.client === 'driver').map((t) => t.lineUserId);

        const [pRes, dRes] = await Promise.all([
          passengerIds.length > 0 ? sendLineMulticast('passenger', passengerIds, [flexMsg]) : Promise.resolve({ sent: 0, failed: 0 }),
          driverIds.length > 0    ? sendLineMulticast('driver',    driverIds,    [flexMsg]) : Promise.resolve({ sent: 0, failed: 0 }),
        ]);
        sentCount = pRes.sent + dRes.sent;
        failedCount = pRes.failed + dRes.failed;
      }

      update.pushStats = {
        targetCount: targets.length,
        sentCount,
        failedCount,
      };
    }

    if (Object.keys(update).length === 0) {
      return badRequestError({ zh_tw: '沒有可更新的欄位', en: 'No fields to update', ja: '更新するフィールドがありません' });
    }

    await ref.update(update);

    // ── Audit log ────────────────────────────────────────
    const auditActions: Array<{ action: AuditAction; payload: Record<string, unknown> }> = [];

    if (isPublishing) {
      auditActions.push({
        action: oldStatus === 'archived' ? 'announcement.republish' : 'announcement.publish',
        payload: {
          from: oldStatus,
          targetCount: (update.pushStats as { targetCount: number }).targetCount,
          channels: update.channels ?? existing.channels,
        },
      });
    } else if (body.status === 'archived' && oldStatus !== 'archived') {
      auditActions.push({ action: 'announcement.archive', payload: { from: oldStatus } });
    } else if (body.status === 'draft' && oldStatus !== 'draft') {
      auditActions.push({ action: 'announcement.update', payload: { from: oldStatus, to: 'draft' } });
    }

    // 內容欄位編輯（不管 status 是否變化，只要有內容欄位 → 寫 update audit）
    const contentEdited = ['title', 'body', 'coverImageUrl', 'ctaButton', 'targetType', 'channels']
      .some((k) => k in update);
    if (contentEdited && !isPublishing) {
      // publish 已有自己的 audit；單純編輯才寫 update
      auditActions.push({
        action: 'announcement.update',
        payload: {
          fields: Object.keys(update).filter((k) => k !== 'publishedAt' && k !== 'archivedAt' && k !== 'pushStats'),
        },
      });
    }

    for (const a of auditActions) {
      await writeAuditLog({
        event,
        auth,
        action: a.action,
        targetType: 'announcement',
        targetId: id,
        payload: a.payload,
      });
    }

    return successResponse({ id, updated: true, newStatus });
  } catch (err) {
    console.error('[admin/announcements/[id] PATCH] failed:', err);
    return serverError();
  }
});
