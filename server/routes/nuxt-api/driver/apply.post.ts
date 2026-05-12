/**
 * POST /nuxt-api/driver/apply
 * 司機申請送出
 *
 * P27（2026-05-12 起）：driverApplication 整包搬到 drivers/{lineUid}.application；
 * users/{lineUid} 不再寫 driverApplication 欄位。冷卻期檢查改讀 drivers.application.rejectedAt
 * （透過 readDriverApplication helper 統一讀新位置）。
 *
 * 流程：
 *   1. 驗證冷卻期（透過 helper 讀 drivers.application 拿 rejectedAt）
 *   2. 寫 users/{lineUid}：roles arrayUnion 'driver' + approved=false（**不再寫 driverApplication**）
 *   3. 寫 drivers/{lineUid}：含 application 完整資料 + top-level vehicleType / 統計初值（首次申請）
 *
 * 對應 docs/decision-log.md 2026/05/06 + 2026-05-12 P27 條目
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { readDriverApplication } from '@@/utils/driver-application';

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

    const isAdmin = auth.roles.includes('admin');
    if (!isAdmin && auth.lineUid !== body.lineUserId) {
      return forbiddenError({ zh_tw: '無權代他人申請', en: 'Cannot apply for other user', ja: '他人の申請はできません' });
    }

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
    const userRef = db.collection('users').doc(body.lineUserId);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      const userData = userSnap.data() ?? {};
      const roles = Array.isArray(userData.roles) ? userData.roles as string[] : [];
      const approved = userData.approved as boolean ?? false;

      if (roles.includes('driver') && approved) {
        return {
          data: {},
          status: { code: 409, message: { zh_tw: '您已是核准司機，無需重新申請', en: 'You are already an approved driver', ja: '既に承認済みドライバーです' } },
        };
      }

      // 冷卻檢查：讀 drivers/{uid}.application 取 rejectedAt
      const existingApp = await readDriverApplication(db, body.lineUserId);
      const rejectedAt = existingApp?.rejectedAt as { toMillis?: () => number } | string | null | undefined;
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

    // ── 1. 寫 users/{lineUid}：只動 roles + approved，不再含 driverApplication ──
    await userRef.set({
      roles: FieldValue.arrayUnion('driver'),
      approved: false,
    }, { merge: true });

    // ── 2. 寫 drivers/{lineUid}：含 application 完整資料 ──
    // - drivers doc 不存在 → 寫完整 defaults（首次申請）+ application
    // - drivers doc 已存在 → merge 身分 + 車型 + application（重複申請保留 admin 既設與歷史統計）
    const userData = userSnap.exists ? (userSnap.data() ?? {}) : {};
    const displayName = (userData.displayName as string) ?? body.driverName;
    const pictureUrl = (userData.pictureUrl as string) ?? '';

    const applicationPayload = {
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
    };

    const driverRef = db.collection('drivers').doc(body.lineUserId);
    const driverSnap = await driverRef.get();

    if (!driverSnap.exists) {
      await driverRef.set({
        lineUserId: body.lineUserId,
        displayName,
        pictureUrl,
        status: 'offline',
        location: null,
        totalTrips: 0,
        totalEarnings: 0,
        totalDistanceKm: 0,
        todayTrips: 0,
        todayEarnings: 0,
        driverCategory: '0',
        vehicleType: body.vehicleType,
        application: applicationPayload,
        createdAt: FieldValue.serverTimestamp(),
        lastActiveAt: FieldValue.serverTimestamp(),
      });
    } else {
      await driverRef.set({
        lineUserId: body.lineUserId,
        displayName,
        pictureUrl,
        vehicleType: body.vehicleType,
        application: applicationPayload,
        lastActiveAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return successResponse({
      applied: true,
      appliedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[driver/apply] failed:', err);
    return serverError({ zh_tw: '申請送出失敗', en: 'Failed to submit application', ja: '申請の送信に失敗しました' });
  }
});
