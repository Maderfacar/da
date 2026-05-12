/**
 * PATCH /nuxt-api/drivers/:id/status — P25-1 司機上下線切換 + online 段結算
 *
 * 用途：driver 自己（或 admin 代操作）切換 status：online / offline。
 *   - online ↔ offline：用本 endpoint
 *   - online ↔ busy：由 orders/[orderId].patch.ts 五階段觸發（en_route → busy / completed → online），
 *     client 不直接打本端點
 *
 * 邏輯（由 composeStatusTransitionPatch 整合）：
 *   1. 跨日歸零（共用 todayResetAt）
 *   2. 結算當前 online 段（若有）
 *   3. 視 newStatus 決定 currentOnlineSessionStartAt
 *
 * Body:
 *   status: 'online' | 'offline'  — busy 不接受（避免 client 偽造佔位）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { composeStatusTransitionPatch, type DriverStatsDoc } from '@@/utils/driver-stats';

interface PatchBody {
  status?: 'online' | 'offline';
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: '缺少司機 ID', en: 'Missing driver ID', ja: 'ドライバー ID が不足しています' });
  }

  const idAsLineUid = id.startsWith('line:') ? id.slice(5) : id;
  const isAdmin = auth.roles.includes('admin');
  const isSelf = auth.uid === id || auth.lineUid === idAsLineUid;
  if (!isAdmin && !isSelf) {
    return forbiddenError({ zh_tw: '無權修改他人狀態', en: 'Cannot modify other driver status', ja: '他人の状態は変更できません' });
  }

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body?.status || (body.status !== 'online' && body.status !== 'offline')) {
    return badRequestError({ zh_tw: 'status 僅接受 online / offline', en: 'status must be online or offline', ja: 'status は online または offline のみ' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('drivers').doc(idAsLineUid);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const data = snap.data() as DriverStatsDoc;

    // busy 中不允許直接切 offline / online（必須先把訂單跑完 → orders endpoint 自動切回 online）
    if (data.status === 'busy') {
      return badRequestError({
        zh_tw: '任務中無法切換上下線，請先完成或取消訂單',
        en: 'Cannot change status while busy; complete or cancel the active order first',
        ja: 'busy 中は変更できません。先に注文を完了またはキャンセルしてください',
      });
    }

    const patch = composeStatusTransitionPatch(data, body.status);
    patch.lastActiveAt = FieldValue.serverTimestamp();

    await ref.set(patch, { merge: true });

    return successResponse({ id: idAsLineUid, status: body.status });
  } catch (err) {
    console.error('[drivers/status.patch] failed:', err);
    return serverError();
  }
});
