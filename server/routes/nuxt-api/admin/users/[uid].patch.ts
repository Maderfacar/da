/**
 * PATCH /nuxt-api/admin/users/:uid
 * 管理員更新使用者 role 或 approved 狀態
 *
 * Body: { role?: string; approved?: boolean }
 * 用途：
 *   - 設定 role: 'admin' → 加入管理員白名單
 *   - 設定 role: 'passenger' → 移除管理員/司機身份
 *   - 設定 approved: true → 核准司機
 *   - 設定 approved: false → 停用司機
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
  }

  const body = await readBody<{ role?: string; approved?: boolean }>(event).catch(() => null);
  if (!body || (body.role === undefined && body.approved === undefined)) {
    return badRequestError({ zh_tw: '請提供 role 或 approved 欄位', en: 'Provide role or approved field', ja: 'roleまたはapprovedを指定してください' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      // 使用者不在 Firestore 中 → 允許新增（管理員手動加入白名單情境）
      const newData: Record<string, unknown> = {
        role: body.role ?? 'admin',
        approved: body.approved ?? true,
        createdAt: new Date(),
      };
      await ref.set(newData, { merge: true });
      return successResponse({ uid, ...newData });
    }

    const update: Record<string, unknown> = {};
    if (body.role !== undefined) update.role = body.role;
    if (body.approved !== undefined) update.approved = body.approved;

    await ref.update(update);
    return successResponse({ uid, ...update });
  } catch (err) {
    console.error('[admin/users.patch] Firestore update failed:', err);
    return serverError();
  }
});
