/**
 * GET /nuxt-api/admin/fare-rules
 *
 * 取得 Fare V2 車資進階規則（fare_rules/v1）。doc 不存在或格式錯 → 回 DEFAULT_FARE_RULES
 * 並標記 isDefault=true，讓 admin UI 一打開就有完整可編輯欄位。
 *
 * 權限：super level admin only。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import {
  validateFareRules,
  FARE_RULES_COLLECTION,
  FARE_RULES_DOC_ID,
} from '@@/utils/fare-rules-cache';
import { DEFAULT_FARE_RULES, type FareRules } from '~shared/pricing';

export interface FareRulesRes {
  rules: FareRules;
  updatedBy: string | null;
  updatedAt: string | null;
  /** true = 顯示的是預設值（doc 不存在或格式錯，尚未存過） */
  isDefault: boolean;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (auth.level !== 'super') {
    return forbiddenError({ zh_tw: '需要最高管理員權限', en: 'Super admin required', ja: 'スーパー管理者権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection(FARE_RULES_COLLECTION).doc(FARE_RULES_DOC_ID).get();

    if (!snap.exists) {
      return successResponse<FareRulesRes>({
        rules: DEFAULT_FARE_RULES,
        updatedBy: null,
        updatedAt: null,
        isDefault: true,
      });
    }

    const data = snap.data() ?? {};
    const parsed = validateFareRules(data);
    const updatedAtRaw = (data.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.();

    return successResponse<FareRulesRes>({
      rules: parsed.ok ? parsed.value : DEFAULT_FARE_RULES,
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
      updatedAt: updatedAtRaw ? updatedAtRaw.toISOString() : null,
      isDefault: !parsed.ok,
    });
  } catch (err) {
    console.error('[admin/fare-rules GET] failed:', err);
    return serverError();
  }
});
