/**
 * POST /nuxt-api/drivers/me/document-replace
 * 司機自上傳新證件（pending 狀態）— P26
 *
 * 流程：
 *   1. driver 先用 POST /nuxt-api/driver/upload 拿 signed URL
 *   2. 把 (docType, url) 送到本端點
 *   3. 寫入 drivers/{lineUid}.application.documentsPending.{docType} = { url, uploadedAt, status: 'pending' }
 *   4. **不立即覆蓋** documents.{docType}（admin 核准後才覆蓋）
 *   5. 寫 audit log driver.document_replace
 *   6. LINE 推播所有 super admins（提示有 pending 待審）
 *
 * 認證：require driver self
 *
 * Body:
 *   docType: 'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl'
 *   url:     從 driver/upload 拿到的 signed URL
 *
 * 對應 docs/decision-log.md P26 條目
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
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
  url?: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  if (!body || !body.docType || !body.url) {
    return badRequestError({ zh_tw: '請提供 docType 與 url', en: 'docType and url required', ja: 'docType と url が必要です' });
  }

  if (!ALLOWED_DOC_TYPES.includes(body.docType as DocType)) {
    return badRequestError({ zh_tw: 'docType 無效', en: 'Invalid docType', ja: 'docType が無効です' });
  }

  // url 必須是 driver/upload 產的 GCS signed URL，避免外部 URL forge
  if (!body.url.startsWith('https://storage.googleapis.com/')) {
    return badRequestError({ zh_tw: 'url 必須來自上傳端點', en: 'url must be from upload endpoint', ja: 'url はアップロードエンドポイントから取得する必要があります' });
  }

  const docType = body.docType as DocType;

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const application = driverSnap.data()?.application as { documents?: Record<string, string> } | undefined;
    const oldUrl = application?.documents?.[docType] ?? '';

    // 寫 pending（無論前狀態為 pending 或 rejected 都覆蓋；status 重設為 pending，清掉 rejectedAt/rejectReason）
    await driverRef.update({
      [`application.documentsPending.${docType}`]: {
        url: body.url,
        uploadedAt: FieldValue.serverTimestamp(),
        status: 'pending',
      },
    });

    await writeAuditLog({
      event,
      auth,
      action: 'driver.document_replace',
      targetType: 'driver',
      targetId: auth.lineUid,
      payload: { docType, oldUrl, pendingUrl: body.url },
    });

    // LINE 推播給所有 super admins（fire & await，失敗 silent）
    try {
      const adminsSnap = await db.collection('admins').where('level', '==', 'super').get();
      const driverName = (application as { driverName?: string } | undefined)?.driverName ?? auth.lineUid.slice(0, 8);
      const docLabel = DOC_LABEL_ZH[docType];
      const message = `🔔 司機證件待審核\n司機：${driverName}\n證件：${docLabel}\n請至 admin 後台 /admin/drivers 處理`;
      await Promise.all(
        adminsSnap.docs.map((adminDoc) =>
          sendLinePush('passenger', adminDoc.id, [{ type: 'text', text: message }]),
        ),
      );
    } catch (err) {
      console.error('[drivers/me/document-replace] notify super admins failed:', err);
    }

    return successResponse({ docType, status: 'pending' });
  } catch (err) {
    console.error('[drivers/me/document-replace] Firestore update failed:', err);
    return serverError();
  }
});
