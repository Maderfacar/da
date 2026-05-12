/**
 * POST /nuxt-api/admin/drivers/:uid/document-review
 * 管理員核准 / 退回司機 pending 證件（P26）
 *
 * 流程：
 *   - approve：documents.{docType} ← documentsPending.{docType}.url；刪除 documentsPending.{docType}
 *   - reject：documentsPending.{docType} = { url, uploadedAt, status: 'rejected', rejectedAt, rejectReason }
 *   - 寫 audit log driver.document_review
 *   - LINE 推播給該司機（駕照已通過 / 已退回原因）
 *
 * 認證：require admin + canManageDrivers
 *
 * Body:
 *   docType:  'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl'
 *   decision: 'approve' | 'reject'
 *   reason?:  reject 時必填，自由輸入
 *
 * 對應 docs/decision-log.md P26 條目
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { sendLinePush } from '@@/utils/line-push';

const ALLOWED_DOC_TYPES = ['licenseUrl', 'registrationUrl', 'insuranceUrl', 'goodCitizenUrl'] as const;
type DocType = typeof ALLOWED_DOC_TYPES[number];

const DOC_LABEL_ZH: Record<DocType, string> = {
  licenseUrl: '駕照',
  registrationUrl: '行照',
  insuranceUrl: '保險卡',
  goodCitizenUrl: '良民證',
};

interface PostBody {
  docType?: string;
  decision?: 'approve' | 'reject';
  reason?: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }
  if (!hasPermission(auth, 'canManageDrivers')) {
    return forbiddenError({ zh_tw: '需要司機管理權限', en: 'canManageDrivers required', ja: 'ドライバー管理権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  if (!body || !body.docType || !body.decision) {
    return badRequestError({ zh_tw: '請提供 docType 與 decision', en: 'docType and decision required', ja: 'docType と decision が必要です' });
  }
  if (!ALLOWED_DOC_TYPES.includes(body.docType as DocType)) {
    return badRequestError({ zh_tw: 'docType 無效', en: 'Invalid docType', ja: 'docType が無効です' });
  }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return badRequestError({ zh_tw: 'decision 需為 approve 或 reject', en: 'decision must be approve or reject', ja: 'decision は approve または reject' });
  }
  if (body.decision === 'reject' && (!body.reason || body.reason.trim().length === 0)) {
    return badRequestError({ zh_tw: '退回需提供原因', en: 'reason required for reject', ja: '却下には理由が必要です' });
  }

  const docType = body.docType as DocType;

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(uid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const application = driverSnap.data()?.application as {
      documents?: Record<string, string>;
      documentsPending?: Record<string, { url?: string; status?: string }>;
    } | undefined;
    const pendingEntry = application?.documentsPending?.[docType];
    if (!pendingEntry || !pendingEntry.url) {
      return notFoundError({ zh_tw: '無待審核證件', en: 'No pending document', ja: '審査待ちの書類がありません' });
    }

    const docLabel = DOC_LABEL_ZH[docType];

    if (body.decision === 'approve') {
      // 覆蓋 production 欄位、刪 pending entry
      await driverRef.update({
        [`application.documents.${docType}`]: pendingEntry.url,
        [`application.documentsPending.${docType}`]: FieldValue.delete(),
      });

      await writeAuditLog({
        event,
        auth,
        action: 'driver.document_review',
        targetType: 'driver',
        targetId: uid,
        payload: { docType, decision: 'approve', newUrl: pendingEntry.url },
      });

      // LINE 推給司機（用 driver channel）
      await sendLinePush('driver', uid, [{
        type: 'text',
        text: `✅ 證件審核通過\n您的「${docLabel}」已通過審核，新版證件已生效。`,
      }]);
    } else {
      // reject：標記 status + rejectedAt + rejectReason；保留 url / uploadedAt
      await driverRef.update({
        [`application.documentsPending.${docType}.status`]: 'rejected',
        [`application.documentsPending.${docType}.rejectedAt`]: FieldValue.serverTimestamp(),
        [`application.documentsPending.${docType}.rejectReason`]: body.reason!.trim(),
      });

      await writeAuditLog({
        event,
        auth,
        action: 'driver.document_review',
        targetType: 'driver',
        targetId: uid,
        payload: { docType, decision: 'reject', reason: body.reason!.trim() },
      });

      await sendLinePush('driver', uid, [{
        type: 'text',
        text: `⚠️ 證件審核未通過\n您的「${docLabel}」未通過審核。\n退回原因：${body.reason!.trim()}\n請重新上傳正確版本。`,
      }]);
    }

    return successResponse({ uid, docType, decision: body.decision });
  } catch (err) {
    console.error('[admin/drivers/[uid]/document-review] failed:', err);
    return serverError();
  }
});
