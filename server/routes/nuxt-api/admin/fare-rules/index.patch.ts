/**
 * PATCH /nuxt-api/admin/fare-rules
 *
 * 全量更新 Fare V2 車資進階規則（fare_rules/v1）。admin UI 一次送整份 FareRules。
 *
 * 行為：
 *   - 嚴格驗證整份規則（validateFareRules）
 *   - set merge:false 全量覆寫（移除的 peakWindow / tier 會真的消失）
 *   - 寫 updatedBy / updatedAt
 *   - invalidate in-memory cache（下次估價立即生效）
 *   - audit log: fare_rules.update with { before, after }
 *
 * 權限：super level admin only。
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  validateFareRules,
  invalidateFareRulesCache,
  FARE_RULES_COLLECTION,
  FARE_RULES_DOC_ID,
} from '@@/utils/fare-rules-cache';
import type { FareRulesRes } from './index.get';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (auth.level !== 'super') {
    return forbiddenError({ zh_tw: '需要最高管理員權限', en: 'Super admin required', ja: 'スーパー管理者権限が必要です' });
  }

  const body = await readBody<unknown>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const parsed = validateFareRules(body);
  if (!parsed.ok) {
    return badRequestError({ zh_tw: parsed.error, en: parsed.error, ja: parsed.error });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection(FARE_RULES_COLLECTION).doc(FARE_RULES_DOC_ID);

    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? validateFareRules(beforeSnap.data()) : null;

    await ref.set(
      { ...parsed.value, updatedBy: auth.lineUid, updatedAt: FieldValue.serverTimestamp() },
      { merge: false },
    );
    invalidateFareRulesCache();

    await writeAuditLog({
      event,
      auth,
      action: 'fare_rules.update',
      targetType: 'fare_rules',
      targetId: FARE_RULES_DOC_ID,
      payload: {
        before: before?.ok ? before.value : null,
        after: parsed.value,
      },
    });

    const after = await ref.get();
    const updatedAtRaw = (after.data()?.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.();

    return successResponse<FareRulesRes>({
      rules: parsed.value,
      updatedBy: auth.lineUid,
      updatedAt: updatedAtRaw ? updatedAtRaw.toISOString() : new Date().toISOString(),
      isDefault: false,
    });
  } catch (err) {
    console.error('[admin/fare-rules PATCH] failed:', err);
    return serverError();
  }
});
