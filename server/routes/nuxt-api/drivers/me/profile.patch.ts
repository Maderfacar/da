/**
 * PATCH /nuxt-api/drivers/me/profile
 * 司機自編 profile（P26 起 / 2026-05-27 擴充）
 *
 * 開放欄位（partial — 至少一個）：
 *   - driverName：聯絡姓名（≤40 字，非空）
 *   - phone：聯絡電話（台灣 09 開頭 10 碼）
 *   - plateNumber：車牌號碼（≤10 字，非空）
 *   - vehicleModel：車輛品牌與型號自由文字（≤80 字，非空）
 *
 * 不開放：bankCode / bankAccount（牽涉收款，要走另開申請流程）
 *
 * 寫入位置：
 *   - drivers.application.{driverName,phone,plateNumber,vehicleModel}
 *   - vehicleModel + driverName 同步寫 top-level：drivers.vehicleModel / drivers.displayName
 *     （admin 列表 + /orders/upcoming.driver / /orders/[id].driver 都讀 top-level）
 *
 * 認證：require driver self（caller 必須是該 driver 本人）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';

interface PatchBody {
  driverName?: string;
  phone?: string;
  plateNumber?: string;
  vehicleModel?: string;
}

const TW_MOBILE_RE = /^09\d{8}$/;
const NAME_MAX = 40;
const PLATE_MAX = 10;
const MODEL_MAX = 80;

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

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const hasAny =
    body.driverName !== undefined
    || body.phone !== undefined
    || body.plateNumber !== undefined
    || body.vehicleModel !== undefined;
  if (!hasAny) {
    return badRequestError({ zh_tw: '請提供至少一個更新欄位', en: 'Provide at least one update field', ja: '少なくとも 1 つの更新フィールドを指定してください' });
  }

  // ── 各欄位驗證 ────────────────────────────────────────────
  const cleaned: { driverName?: string; phone?: string; plateNumber?: string; vehicleModel?: string } = {};

  if (body.driverName !== undefined) {
    if (typeof body.driverName !== 'string') {
      return badRequestError({ zh_tw: '姓名必須是字串', en: 'driverName must be string', ja: '名前は文字列' });
    }
    const v = body.driverName.trim();
    if (v.length === 0 || v.length > NAME_MAX) {
      return badRequestError({ zh_tw: `姓名格式不正確（1-${NAME_MAX} 字）`, en: `Invalid driverName (1-${NAME_MAX} chars)`, ja: `名前の形式が不正（1-${NAME_MAX}文字）` });
    }
    cleaned.driverName = v;
  }

  if (body.phone !== undefined) {
    if (typeof body.phone !== 'string' || !TW_MOBILE_RE.test(body.phone)) {
      return badRequestError({ zh_tw: '電話格式不正確（需 09 開頭 10 碼）', en: 'Invalid phone format (must be 10-digit starting with 09)', ja: '電話番号の形式が正しくありません（09で始まる10桁）' });
    }
    cleaned.phone = body.phone;
  }

  if (body.plateNumber !== undefined) {
    if (typeof body.plateNumber !== 'string') {
      return badRequestError({ zh_tw: '車牌必須是字串', en: 'plateNumber must be string', ja: 'ナンバープレートは文字列' });
    }
    const v = body.plateNumber.trim().toUpperCase();
    if (v.length === 0 || v.length > PLATE_MAX) {
      return badRequestError({ zh_tw: `車牌格式不正確（1-${PLATE_MAX} 字）`, en: `Invalid plateNumber (1-${PLATE_MAX} chars)`, ja: `ナンバーの形式が不正（1-${PLATE_MAX}文字）` });
    }
    cleaned.plateNumber = v;
  }

  if (body.vehicleModel !== undefined) {
    if (typeof body.vehicleModel !== 'string') {
      return badRequestError({ zh_tw: '車型必須是字串', en: 'vehicleModel must be string', ja: '車種は文字列' });
    }
    const v = body.vehicleModel.trim();
    if (v.length === 0 || v.length > MODEL_MAX) {
      return badRequestError({ zh_tw: `車型格式不正確（1-${MODEL_MAX} 字）`, en: `Invalid vehicleModel (1-${MODEL_MAX} chars)`, ja: `車種の形式が不正（1-${MODEL_MAX}文字）` });
    }
    cleaned.vehicleModel = v;
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const driverData = driverSnap.data() ?? {};
    const app = (driverData.application as Record<string, unknown> | undefined) ?? {};

    const before = {
      driverName: (app.driverName as string | undefined) ?? null,
      phone: (app.phone as string | undefined) ?? null,
      plateNumber: (app.plateNumber as string | undefined) ?? null,
      vehicleModel: (app.vehicleModel as string | undefined) ?? null,
    };

    const update: Record<string, unknown> = {};
    if (cleaned.driverName !== undefined) {
      update['application.driverName'] = cleaned.driverName;
      // top-level displayName 也同步（admin 列表 + LINE push 觸發點都讀這欄）
      update.displayName = cleaned.driverName;
    }
    if (cleaned.phone !== undefined) {
      update['application.phone'] = cleaned.phone;
    }
    if (cleaned.plateNumber !== undefined) {
      update['application.plateNumber'] = cleaned.plateNumber;
    }
    if (cleaned.vehicleModel !== undefined) {
      update['application.vehicleModel'] = cleaned.vehicleModel;
      // top-level vehicleModel 同步（admin/drivers 列表 + /orders/upcoming.driver 都讀這欄）
      update.vehicleModel = cleaned.vehicleModel;
    }

    await driverRef.update(update);

    await writeAuditLog({
      event,
      auth,
      action: 'driver.self_profile_edit',
      targetType: 'driver',
      targetId: auth.lineUid,
      payload: { before, after: cleaned },
    });

    return successResponse({ uid: auth.lineUid, updated: true });
  } catch (err) {
    console.error('[drivers/me/profile.patch] Firestore update failed:', err);
    return serverError();
  }
});
