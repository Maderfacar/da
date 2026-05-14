/**
 * PUT /nuxt-api/admin/bot-replies/[key]
 *
 * 編輯 / 重置 bot reply 文案（P40 Phase 2）。
 *
 * Path param:
 *   key: 'passenger.follow' | 'passenger.text' | 'driver.follow' | 'driver.text'
 *
 * Body:
 *   text: string (1-500)
 *   enabled?: boolean (default true)
 *
 * 行為：upsert bot_replies/{key} doc。後續 LINE webhook follow/text 推送會優先讀此 doc。
 *
 * 權限：canBroadcast
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

const VALID_KEYS = new Set([
  'passenger.follow',
  'passenger.text',
  'driver.follow',
  'driver.text',
]);

const TEXT_MAX = 500;

interface PutBody {
  text?: unknown;
  enabled?: unknown;
}

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

  const key = getRouterParam(event, 'key') ?? '';
  if (!VALID_KEYS.has(key)) {
    return badRequestError({
      zh_tw: `replyKey 必須為：${[...VALID_KEYS].join(', ')}`,
      en: `replyKey must be one of ${[...VALID_KEYS].join(', ')}`,
      ja: `replyKey は次のいずれか：${[...VALID_KEYS].join(', ')}`,
    });
  }

  const body = await readBody<PutBody>(event);
  const rawText = body?.text;
  if (typeof rawText !== 'string') {
    return badRequestError({
      zh_tw: 'text 必須為字串',
      en: 'text must be a string',
      ja: 'text は文字列',
    });
  }
  const text = rawText.trim();
  if (text.length === 0 || text.length > TEXT_MAX) {
    return badRequestError({
      zh_tw: `text 必須為 1-${TEXT_MAX} 字`,
      en: `text must be 1-${TEXT_MAX} chars`,
      ja: `text は 1-${TEXT_MAX} 文字`,
    });
  }
  const enabled = body?.enabled === false ? false : true;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('bot_replies').doc(key);
    const before = await ref.get();
    await ref.set({
      text,
      enabled,
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await writeAuditLog({
      event,
      auth,
      action: 'line.bot_reply.update',
      targetType: 'bot_reply',
      targetId: key,
      payload: {
        before: before.exists ? before.data() : null,
        after: { text, enabled },
      },
    });

    return successResponse({ replyKey: key, updated: true });
  } catch (err) {
    console.error(`[admin/bot-replies PUT ${key}] failed:`, err);
    return serverError();
  }
});
