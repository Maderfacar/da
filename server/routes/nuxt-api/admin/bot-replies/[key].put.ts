/**
 * PUT /nuxt-api/admin/bot-replies/[key]
 *
 * 編輯 bot reply（P40 Phase 2，2026-06-08 升級為支援 welcome sequence）。
 *
 * Path param：
 *   key: 'passenger.follow' | 'passenger.text' | 'driver.follow' | 'driver.text'
 *
 * Body 規格（依 key 分流）：
 *   - .follow：{ enabled?: boolean, messages: WelcomeMessage[] }（1-5 則 text/flex 混搭）
 *   - .text：  { enabled?: boolean, text: string (1-500) }
 *
 * .follow doc 寫入時會 FieldValue.delete() 移除舊 `text` 欄位避免 schema 混淆；
 * .text doc 維持單則 text，不寫 messages。
 *
 * 權限：canBroadcast
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { validateWelcomeSequence } from '@@/utils/bot-reply-sequence';

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
  messages?: unknown;
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
  const isFollow = key.endsWith('.follow');

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('bot_replies').doc(key);
    const before = await ref.get();
    const beforeData = before.exists ? before.data() : null;

    if (isFollow) {
      // ── follow：歡迎序列（messages 陣列）──────────
      const r = validateWelcomeSequence(body);
      if (!r.ok || !r.value) {
        return badRequestError({
          zh_tw: r.error ?? 'messages 驗證失敗',
          en: r.error ?? 'messages validation failed',
          ja: r.error ?? 'messages 検証失敗',
        });
      }
      await ref.set({
        enabled: r.value.enabled,
        messages: r.value.messages,
        // 清掉 legacy text 欄位（避免新舊 schema 共存）
        text: FieldValue.delete(),
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
          schema: 'welcome-sequence',
          before: beforeData,
          after: { enabled: r.value.enabled, messageCount: r.value.messages.length },
        },
      });

      return successResponse({ replyKey: key, updated: true, messageCount: r.value.messages.length });
    }

    // ── text：單則純文字回覆 ───────────────────────
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
        schema: 'single-text',
        before: beforeData,
        after: { text, enabled },
      },
    });

    return successResponse({ replyKey: key, updated: true });
  } catch (err) {
    console.error(`[admin/bot-replies PUT ${key}] failed:`, err);
    return serverError();
  }
});
