/**
 * GET /nuxt-api/admin/line-api-errors
 *
 * 列 LINE API error log（P43 Phase 2）。
 *
 * Query:
 *   channel: 'passenger' | 'driver' | 'unknown'（必填）
 *   api?: 'message/push' | 'message/reply' | 'richmenu' | ...（可選，client post-filter）
 *   limit?: 1-100（default=50，Q8=8a）
 *
 * 回 { items: ApiErrorDto[] } — createdAt DESC
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

interface ApiErrorDoc {
  channel: 'passenger' | 'driver' | 'unknown';
  api: string;
  method: 'GET' | 'POST' | 'DELETE';
  statusCode: number;
  errorMessage: string;
  errorDetails: string | null;
  context: {
    targetUid: string | null;
    richMenuId: string | null;
    orderId: string | null;
  };
  createdAt: FirebaseFirestore.Timestamp;
}

const VALID_CHANNELS = new Set<string>(['passenger', 'driver', 'unknown']);

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({
      zh_tw: '需要廣播權限',
      en: 'canBroadcast required',
      ja: 'ブロードキャスト権限が必要です',
    });
  }

  const query = getQuery(event);
  const channelRaw = typeof query.channel === 'string' ? query.channel : '';
  if (!VALID_CHANNELS.has(channelRaw)) {
    return badRequestError({
      zh_tw: 'channel 必須為 passenger / driver / unknown',
      en: 'channel must be passenger / driver / unknown',
      ja: 'channel は passenger / driver / unknown',
    });
  }
  const channel = channelRaw as 'passenger' | 'driver' | 'unknown';

  let limit = Number(query.limit ?? 50);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  const apiFilter = typeof query.api === 'string' && query.api.length > 0 ? query.api : null;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db
      .collection('line_api_errors')
      .where('channel', '==', channel)
      .orderBy('createdAt', 'desc')
      .limit(limit * 2)
      .get();

    const items = snap.docs
      .map((d) => {
        const data = d.data() as ApiErrorDoc;
        return {
          id: d.id,
          channel: data.channel,
          api: data.api,
          method: data.method,
          statusCode: data.statusCode,
          errorMessage: data.errorMessage,
          errorDetails: data.errorDetails,
          context: data.context,
          createdAt: data.createdAt?.toDate().toISOString() ?? null,
        };
      })
      .filter((item) => {
        if (apiFilter && !item.api.includes(apiFilter)) return false;
        return true;
      })
      .slice(0, limit);

    return successResponse({ items });
  } catch (err) {
    console.error('[admin/line-api-errors GET] failed:', err);
    return serverError();
  }
});
