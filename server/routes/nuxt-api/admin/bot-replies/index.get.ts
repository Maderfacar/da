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
import { migrateBotReplyDoc, type WelcomeSequence } from '@@/utils/bot-reply-sequence';

const REPLY_KEYS: Array<{ key: string; client: LineClient; type: BotReplyType }> = [
  { key: 'passenger.follow', client: 'passenger', type: 'follow' },
  { key: 'passenger.text', client: 'passenger', type: 'text' },
  { key: 'driver.follow', client: 'driver', type: 'follow' },
  { key: 'driver.text', client: 'driver', type: 'text' },
];

interface BotReplyDoc {
  text?: string;
  enabled?: boolean;
  messages?: unknown[];
  updatedBy?: string;
  updatedAt?: FirebaseFirestore.Timestamp;
}

interface BotReplyItem {
  replyKey: string;
  client: LineClient;
  type: BotReplyType;
  text: string;
  enabled: boolean;
  isCustomized: boolean;
  defaultText: string;
  updatedBy: string;
  updatedAt: string | null;
  /** 僅 type='follow' 才有：歡迎序列（多則 text/flex 混搭，最多 5 則）。
   *  舊 doc 自動遷移為單則 text 訊息（三語都填同字串），UI 可開始編輯。 */
  welcomeSequence?: WelcomeSequence;
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
    const items: BotReplyItem[] = await Promise.all(REPLY_KEYS.map(async ({ key, client, type }) => {
      const defaultText = getBotReplyDefault(client, type);
      const snap = await db.collection('bot_replies').doc(key).get();
      const exists = snap.exists;
      const d = (exists ? (snap.data() ?? {}) : {}) as BotReplyDoc;

      const base: BotReplyItem = {
        replyKey: key,
        client,
        type,
        text: typeof d.text === 'string' && d.text.length > 0 ? d.text : defaultText,
        enabled: d.enabled !== false,
        isCustomized: exists,
        defaultText,
        updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : '',
        updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null,
      };

      // .follow 類：附 welcomeSequence（舊 doc 自動 migrate）
      if (type === 'follow') {
        base.welcomeSequence = migrateBotReplyDoc(exists ? d : null, defaultText);
      }

      return base;
    }));
    return successResponse({ items });
  } catch (err) {
    console.error('[admin/bot-replies GET] failed:', err);
    return serverError();
  }
});
