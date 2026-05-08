/**
 * POST /nuxt-api/driver/apply
 * 司機申請送出：寫入 driverApplication + arrayUnion('driver') + approved=false
 *
 * 流程：
 *   1. 驗證使用者是否在冷卻期（rejectedAt 在 24h 內 → 拒絕）
 *   2. 寫入 users/{lineUserId}.driverApplication 完整申請資料
 *   3. roles arrayUnion 'driver'（保留現有 passenger / admin 等其他身分）
 *   4. approved 設為 false 等待 admin 審核
 *   5. 設 driverCategory: '0' 預設搶單排序權重
 *
 * 業務規則：
 *   - 已是 approved driver → 拒絕（不需重新申請）
 *   - 被拒絕後 24h 內 → 回 403 含 cooldownUntil
 *   - 圖片需先透過 /nuxt-api/driver/upload 上傳取得 4 個 signed URL
 *
 * 對應 docs/decision-log.md 2026/05/06 司機申請流程設計
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

interface ApplyBody {
  lineUserId: string;
  driverName: string;
  phone: string;
  plateNumber: string;
  vehicleType: 'sedan' | 'mpv' | 'suv' | 'van';
  bankCode: string;
  bankAccount: string;
  documents: {
    licenseUrl: string;
    registrationUrl: string;
    insuranceUrl: string;
    goodCitizenUrl: string;
  };
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小時

export default defineEventHandler(async (event) => {
  try {
    // P14：必須登入；申請只能申請自己（admin 例外）
    const auth = await getAuthFromEvent(event);
    if (!auth.ok) return authFailResponse(auth);

    const config = useRuntimeConfig();
    if (!config.firebaseServiceAccountJson) {
      return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
    }

    const body = await readBody<ApplyBody>(event).catch(() => null);
    if (!body) {
      return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
    }

    // P14：caller 必須是 lineUserId 本人，或具 admin 身分（admin 代他人提交）
    const isAdmin = auth.roles.includes('admin');
    if (!isAdmin && auth.lineUid !== body.lineUserId) {
      return forbiddenError({ zh_tw: '無權代他人申請', en: 'Cannot apply for other user', ja: '他人の申請はできません' });
    }

    // 必填驗證
    const requiredFields: (keyof ApplyBody)[] = [
      'lineUserId', 'driverName', 'phone', 'plateNumber',
      'vehicleType', 'bankCode', 'bankAccount', 'documents',
    ];
    const missingTop = requiredFields.filter((k) => !body[k]);
    if (missingTop.length > 0) {
      return badRequestError({ zh_tw: `欄位缺失：${missingTop.join(', ')}`, en: `Missing fields: ${missingTop.join(', ')}`, ja: `不足: ${missingTop.join(', ')}` });
    }

    const docs = body.documents;
    const requiredDocs: (keyof ApplyBody['documents'])[] = ['licenseUrl', 'registrationUrl', 'insuranceUrl', 'goodCitizenUrl'];
    const missingDocs = requiredDocs.filter((k) => !docs[k]);
    if (missingDocs.length > 0) {
      return badRequestError({ zh_tw: `證件圖片缺失：${missingDocs.join(', ')}`, en: `Missing documents: ${missingDocs.join(', ')}`, ja: `証明書画像不足: ${missingDocs.join(', ')}` });
    }

    if (!['sedan', 'mpv', 'suv', 'van'].includes(body.vehicleType)) {
      return badRequestError({ zh_tw: '車型無效', en: 'Invalid vehicle type', ja: '車種が無効です' });
    }

    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const docRef = db.collection('users').doc(body.lineUserId);
    const snap = await docRef.get();

    if (snap.exists) {
      const data = snap.data() ?? {};
      const roles = Array.isArray(data.roles) ? data.roles as string[] : [];
      const approved = data.approved as boolean ?? false;

      // 已是 approved driver → 拒絕重複申請
      if (roles.includes('driver') && approved) {
        return {
          data: {},
          status: { code: 409, message: { zh_tw: '您已是核准司機，無需重新申請', en: 'You are already an approved driver', ja: '既に承認済みドライバーです' } },
        };
      }

      // 冷卻檢查：rejectedAt 在 24h 內 → 拒絕
      const application = data.driverApplication as Record<string, unknown> | undefined;
      const rejectedAt = application?.rejectedAt as { toMillis?: () => number } | string | null | undefined;
      const rejectedMs = typeof rejectedAt === 'string'
        ? new Date(rejectedAt).getTime()
        : rejectedAt?.toMillis?.() ?? 0;
      if (rejectedMs > 0 && Date.now() - rejectedMs < COOLDOWN_MS) {
        const cooldownUntil = new Date(rejectedMs + COOLDOWN_MS).toISOString();
        return {
          data: { cooldownUntil },
          status: { code: 403, message: { zh_tw: '申請冷卻中，請稍後再試', en: 'Application cooldown active', ja: '申請のクールダウン中です' } },
        };
      }
    }

    // 寫入 driverApplication + roles arrayUnion('driver') + approved=false + driverCategory
    await docRef.set({
      roles: FieldValue.arrayUnion('driver'),
      approved: false,
      driverCategory: '0',
      driverApplication: {
        driverName: body.driverName,
        phone: body.phone,
        plateNumber: body.plateNumber,
        vehicleType: body.vehicleType,
        bankCode: body.bankCode,
        bankAccount: body.bankAccount,
        documents: {
          licenseUrl: docs.licenseUrl,
          registrationUrl: docs.registrationUrl,
          insuranceUrl: docs.insuranceUrl,
          goodCitizenUrl: docs.goodCitizenUrl,
        },
        appliedAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        rejectedAt: null,
        rejectReason: null,
      },
    }, { merge: true });

    return successResponse({
      applied: true,
      appliedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[driver/apply] failed:', err);
    return serverError({ zh_tw: '申請送出失敗', en: 'Failed to submit application', ja: '申請の送信に失敗しました' });
  }
});
