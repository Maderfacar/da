/**
 * GET /nuxt-api/admin/bot-replies
 *
 * 列出 4 個 bot reply key（passenger.follow / passenger.text / driver.follow / driver.text）。
 *
 * 每筆回：
 *   - replyKey + client + type
 *   - text（current；doc 不存在則 fallback hard-coded default）
 *   - enabled（doc 不存在預設 true）
 *   - isCustomized（doc 是否存在）
 *   - defaultText（系統預設，admin 對照用）
 *   - updatedBy / updatedAt
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { getBotReplyDefault, type LineClient, type BotReplyType } from '@@/utils/line-channel';

const REPLY_KEYS: Array<{ key: string; client: LineClient; type: BotReplyType }> = [
  { key: 'passenger.follow', client: 'passenger', type: 'follow' },
  { key: 'passenger.text', client: 'passenger', type: 'text' },
  { key: 'driver.follow', client: 'driver', type: 'follow' },
  { key: 'driver.text', client: 'driver', type: 'text' },
];

interface BotReplyDoc {
  text?: string;
  enabled?: boolean;
  updatedBy?: string;
  updatedAt?: FirebaseFirestore.Timestamp;
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

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const items = await Promise.all(REPLY_KEYS.map(async ({ key, client, type }) => {
      const defaultText = getBotReplyDefault(client, type);
      const snap = await db.collection('bot_replies').doc(key).get();
      if (!snap.exists) {
        return {
          replyKey: key,
          client,
          type,
          text: defaultText,
          enabled: true,
          isCustomized: false,
          defaultText,
          updatedBy: '',
          updatedAt: null as string | null,
        };
      }
      const d = (snap.data() ?? {}) as BotReplyDoc;
      return {
        replyKey: key,
        client,
        type,
        text: typeof d.text === 'string' && d.text.length > 0 ? d.text : defaultText,
        enabled: d.enabled !== false,
        isCustomized: true,
        defaultText,
        updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : '',
        updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null,
      };
    }));
    return successResponse({ items });
  } catch (err) {
    console.error('[admin/bot-replies GET] failed:', err);
    return serverError();
  }
});
