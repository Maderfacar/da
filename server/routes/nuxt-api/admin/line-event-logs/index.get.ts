/**
 * GET /nuxt-api/admin/line-event-logs
 *
 * 列 webhook event log（P43 Phase 1）。
 *
 * Query:
 *   channel: 'passenger' | 'driver'（必填，配合 Firestore composite index）
 *   eventType?: 'follow' | 'unfollow' | 'message' | 'postback' | 'beacon' | ...（可選，client-side filter；不在 server filter 避免 index 爆炸）
 *   handlerResult?: 'replied' | 'ignored' | 'handler_failed' | 'no_handler'（同上）
 *   limit?: 1-100（default=50，Q8=8a）
 *
 * 回 { items: EventLogDto[] } — createdAt DESC
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { validateChannel } from '@@/utils/line-richmenu-doc';
import type { EventType, HandlerResult } from '@@/utils/line-event-log';

interface EventLogDoc {
  channel: 'passenger' | 'driver';
  eventType: EventType;
  lineUid: string | null;
  postbackData: string | null;
  messageText: string | null;
  handlerResult: HandlerResult;
  createdAt: FirebaseFirestore.Timestamp;
}

const VALID_EVENT_TYPES = new Set<string>([
  'follow', 'unfollow', 'message', 'postback', 'beacon', 'memberJoined', 'memberLeft', 'unknown',
]);
const VALID_HANDLER_RESULTS = new Set<string>([
  'replied', 'ignored', 'handler_failed', 'no_handler',
]);

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
  const channelRes = validateChannel(query.channel);
  if (!channelRes.ok) {
    return badRequestError({
      zh_tw: channelRes.error,
      en: 'channel must be passenger or driver',
      ja: 'channel は passenger または driver',
    });
  }

  let limit = Number(query.limit ?? 50);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  const eventTypeFilter = typeof query.eventType === 'string' && VALID_EVENT_TYPES.has(query.eventType)
    ? query.eventType
    : null;
  const handlerResultFilter = typeof query.handlerResult === 'string' && VALID_HANDLER_RESULTS.has(query.handlerResult)
    ? query.handlerResult
    : null;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db
      .collection('line_event_logs')
      .where('channel', '==', channelRes.value)
      .orderBy('createdAt', 'desc')
      .limit(limit * 2)  // 預撈 2x，給 client-side filter 留 buffer
      .get();

    const items = snap.docs
      .map((d) => {
        const data = d.data() as EventLogDoc;
        return {
          id: d.id,
          channel: data.channel,
          eventType: data.eventType,
          lineUid: data.lineUid,
          postbackData: data.postbackData,
          messageText: data.messageText,
          handlerResult: data.handlerResult,
          createdAt: data.createdAt?.toDate().toISOString() ?? null,
        };
      })
      .filter((item) => {
        if (eventTypeFilter && item.eventType !== eventTypeFilter) return false;
        if (handlerResultFilter && item.handlerResult !== handlerResultFilter) return false;
        return true;
      })
      .slice(0, limit);

    return successResponse({ items });
  } catch (err) {
    console.error('[admin/line-event-logs GET] failed:', err);
    return serverError();
  }
});
