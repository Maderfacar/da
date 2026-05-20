/**
 * PATCH /nuxt-api/drivers/me/vehicle-profile
 * 司機編輯 vehicleProfilePending（草稿；不直接覆蓋 current vehicleProfile）— Phase 1B
 *
 * 流程：
 *   1. driver 提供 photos / tags（partial）
 *   2. 驗證：呼叫 validateVehicleProfileShape + tagIndex
 *   3. 寫入：drivers/{lineUid}.vehicleProfilePending = { ...existing, ...input, status: 'draft' }
 *      - 若先前 status='rejected'，patch 後自動回 'draft'（允許基於 reject 內容續編）
 *      - status='pending_review' 時不可再編（須 admin 審完才能再改）
 *   4. 不寫 audit log（草稿頻繁變動會炸 log 量；送審/退回時才寫）
 *
 * 認證：require driver self
 *
 * Body: { photos?: string[]; tags?: string[] }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { buildTagIndex } from '@@/utils/vehicle-profile';
import { validateVehicleProfileShape } from '~shared/vehicleProfile';

interface PatchBody {
  photos?: unknown;
  tags?: unknown;
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

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }
  if (body.photos === undefined && body.tags === undefined) {
    return badRequestError({ zh_tw: '請至少提供 photos 或 tags', en: 'photos or tags required', ja: 'photos または tags が必要です' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);

    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const data = driverSnap.data() ?? {};
    const existingPending = data.vehicleProfilePending as
      | { status?: string; photos?: string[]; tags?: string[] }
      | null
      | undefined;
    const existingCurrent = data.vehicleProfile as
      | { photos?: string[]; tags?: string[] }
      | null
      | undefined;

    // pending_review 不可改
    if (existingPending?.status === 'pending_review') {
      return badRequestError({
        zh_tw: '草稿審核中，無法編輯，請先撤回送審',
        en: 'Pending review, cannot edit; withdraw first',
        ja: '審査中のため編集不可。先に撤回してください',
      });
    }

    // 合併輸入：以 existingPending 為基礎，沒 pending 時用 existingCurrent 為基礎
    const base = existingPending ?? existingCurrent ?? {};
    const nextPhotos = body.photos !== undefined ? body.photos : (base.photos ?? []);
    const nextTags = body.tags !== undefined ? body.tags : (base.tags ?? []);

    // 驗證
    const index = await buildTagIndex(db);
    const lookupIndex = new Map(
      Array.from(index.entries()).map(([id, e]) => [id, { group: e.group, scope: e.scope }]),
    );
    const errs = validateVehicleProfileShape(
      { photos: nextPhotos, tags: nextTags },
      { tagIndex: lookupIndex },
    );
    if (errs.length > 0) {
      const summary = errs.map((e) => `${e.field}:${e.code}`).join(', ');
      return badRequestError({
        zh_tw: `欄位驗證失敗：${summary}`,
        en: `Validation failed: ${summary}`,
        ja: `バリデーションエラー：${summary}`,
      });
    }

    const nextPending = {
      photos: nextPhotos as string[],
      tags: nextTags as string[],
      status: 'draft' as const,
      updatedAt: FieldValue.serverTimestamp(),
      submittedAt: null,
      rejectedAt: null,
      rejectReason: null,
      reviewedBy: null,
    };

    await driverRef.update({ vehicleProfilePending: nextPending });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[drivers/me/vehicle-profile.patch] failed:', err);
    return serverError();
  }
});
