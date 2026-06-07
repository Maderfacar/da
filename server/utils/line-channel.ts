/**
 * LINE 多 channel 解析器（P29 起：passenger + driver 各自獨立 OA）
 *
 * 設計：
 *   - 兩個 OA channel 分別配 env var：
 *       passenger：NUXT_LINE_CHANNEL_SECRET_PASSENGER / _ACCESS_TOKEN_PASSENGER
 *       driver：   NUXT_LINE_CHANNEL_SECRET_DRIVER    / _ACCESS_TOKEN_DRIVER
 *   - P29 前的舊 `NUXT_LINE_CHANNEL_SECRET` / `_ACCESS_TOKEN` 維持作 passenger fallback
 *     避免部署過渡期推播壞掉。完成 Vercel env var 遷移後可移除 legacy fallback。
 *   - 兩個 channel 必須在 LINE Developer Console 設「same Provider + shared userId」，
 *     否則同一人在兩 OA 的 lineUid 不同 → 既有 Firestore data 對不上。
 *
 * 用法：
 *   const { secret, accessToken } = getLineChannel('driver');
 *   sendLinePush('driver', userId, msgs);
 */
import type { H3Event } from 'h3';
import { verifyLineSignature } from '@@/utils/line-signature';
import { handlePostbackEvent } from '@@/utils/line-postback-handlers';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { writeLineEventLog, type EventType, type HandlerResult } from '@@/utils/line-event-log';
import { writeLineApiError } from '@@/utils/line-api-error-log';
import { resolveUserLang, bindRichmenuForUser } from '@@/utils/line-richmenu-binding';
import type { Lang } from '@@/utils/user-lang';
import type { LineMessage } from '@@/utils/line-push';
import { migrateBotReplyDoc, buildWelcomeMessages } from '@@/utils/bot-reply-sequence';

export type LineClient = 'passenger' | 'driver';

interface LineChannelCreds {
  secret: string;
  accessToken: string;
}

export function getLineChannel(client: LineClient): LineChannelCreds {
  const config = useRuntimeConfig();
  if (client === 'driver') {
    return {
      // driver 沒設就回空字串，呼叫端會 short-circuit 不推播
      secret: config.lineChannelSecretDriver || '',
      accessToken: config.lineChannelAccessTokenDriver || '',
    };
  }
  // passenger：優先用 _PASSENGER 變數，沒設 fallback 到 legacy（過渡期相容）
  return {
    secret: config.lineChannelSecretPassenger || config.lineChannelSecret || '',
    accessToken: config.lineChannelAccessTokenPassenger || config.lineChannelAccessToken || '',
  };
}

// ── Webhook handler（passenger / driver 兩 endpoint 共用，差別只在 client 參數）─────
interface LineTextMessage {
  type: 'text';
  text: string;
}
interface LinePostbackPayload {
  data: string;
  params?: Record<string, string>;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source: { userId?: string; type: string };
  message?: LineTextMessage;
  postback?: LinePostbackPayload;
}
interface LineWebhookBody {
  events: LineEvent[];
}

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

async function _reply(
  accessToken: string,
  replyToken: string,
  messages: object[],
  ctx: { client: LineClient; targetUid: string | null },
) {
  try {
    await $fetch(LINE_REPLY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: { replyToken, messages },
    });
  } catch (err) {
    const e = err as { data?: unknown; statusCode?: number; message?: string };
    console.error('[line-webhook] reply failed:', e?.data ?? err);
    // P43 Phase 2：寫 error log（reply token TTL 1min，失敗常見於延遲處理 / 已 consumed）
    await writeLineApiError({
      channel: ctx.client,
      api: 'message/reply',
      method: 'POST',
      statusCode: e?.statusCode ?? 0,
      errorMessage: e?.message ?? 'reply failed',
      errorDetails: e?.data ?? null,
      context: { targetUid: ctx.targetUid },
    });
  }
}

/**
 * Bot 自動回覆 fallback 文案（P40 Phase 2：抽進 bot_replies collection 後仍保留作 fallback）
 *
 * 載入順序：
 *   1. doc 不存在 / 讀取失敗 → fallback hard-coded const（admin 還沒設過）
 *   2. doc.enabled === false → **null**（admin 主動停用 → 不回覆）
 *   3. doc.text 空 → fallback（admin 編過但沒填）
 *   4. 其他 → 用 doc.text
 */
const FOLLOW_MESSAGES: Record<LineClient, string> = {
  passenger: '感謝您加入 DestinationAnywhere！\n\n✈ 專業機場接送服務，隨時為您出發。\n\n請透過 LINE LIFF 完成訂車預約，我們將盡快為您安排。',
  driver: '感謝加入 DestinationAnywhere 司機端！\n\n✅ 之後新派單與訂單更新都會推播到此 LINE 帳號。\n\n請至 LIFF 完成上線並開始接單。',
};

const TEXT_REPLY_MESSAGES: Record<LineClient, string> = {
  passenger: '您好！感謝您的訊息。\n\n如需訂車或查詢行程，請點選下方選單或透過 LIFF 操作，我們的客服將盡快與您聯繫。',
  driver: '司機您好。\n\n本帳號用於派單通知；如需操作（接單 / 任務 / 個人資料），請至 LIFF 司機端。',
};

export type BotReplyType = 'follow' | 'text';

/**
 * 取得 Bot 自動回覆文案（P40 Phase 2 + P40-FU bugfix）
 *
 * - doc 不存在 / 讀取失敗 → 回 fallback hard-coded（admin 還沒設過）
 * - **doc.enabled === false → 回 null（admin 主動停用 — webhook 端應跳過 reply）**
 * - doc.text 空 → 回 fallback（admin 編過但沒填 text，視同未設）
 * - 其他 → 回 doc.text
 *
 * 行為差異（修 bug）：原版 enabled=false 仍回 fallback 字串，導致 admin 關閉啟用後 OA
 * 仍會回覆（fallback 也是字串，handler 拿到非空字串就 reply）。修正後 null = 不回覆。
 */
export async function loadBotReply(client: LineClient, type: BotReplyType): Promise<string | null> {
  const fallback = type === 'follow' ? FOLLOW_MESSAGES[client] : TEXT_REPLY_MESSAGES[client];
  try {
    const { firebaseServiceAccountJson } = useRuntimeConfig();
    if (!firebaseServiceAccountJson) return fallback;
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('bot_replies').doc(`${client}.${type}`).get();
    if (!snap.exists) return fallback;
    const d = snap.data();
    if (!d) return fallback;
    // admin 在 UI 明確設「停用」→ 完全不回覆（webhook 端會跳過 reply）
    if (d.enabled === false) return null;
    if (typeof d.text !== 'string' || d.text.length === 0) return fallback;
    return d.text;
  } catch (err) {
    console.warn(`[bot-reply] load ${client}.${type} failed:`, err);
    return fallback;
  }
}

/** Default fallback text（供 admin endpoint 預覽，無需打 Firestore） */
export function getBotReplyDefault(client: LineClient, type: BotReplyType): string {
  return type === 'follow' ? FOLLOW_MESSAGES[client] : TEXT_REPLY_MESSAGES[client];
}

/**
 * 載入 follow 歡迎序列，依 user lang 解出 LINE message array（2026-06-08）。
 *
 * 與 loadBotReply 的差異：
 *   - loadBotReply 回單則 text（給 .text 自動回覆用）
 *   - 本函式回 message array（給 .follow 用），支援多則 text/flex 混搭、3 語自動選
 *
 * 流程：
 *   1. 讀 bot_replies/{client}.follow doc（不存在 → fallback 包成單則 text）
 *   2. migrateBotReplyDoc 把舊 single-text 自動轉新 schema
 *   3. resolveUserLang 抓 user 偏好（新 user 無 doc → 'zh_tw'）
 *   4. buildWelcomeMessages 依 lang + enabled 篩出 LINE message array（最多 5 則）
 *
 * 回空陣列代表「不 reply」（admin 主動停用 / 全部 message disabled / 無內容可建）
 */
export async function loadFollowMessages(
  client: LineClient,
  lineUid: string | null,
): Promise<LineMessage[]> {
  try {
    const { firebaseServiceAccountJson } = useRuntimeConfig();
    if (!firebaseServiceAccountJson) {
      return [{ type: 'text', text: getBotReplyDefault(client, 'follow') }];
    }
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    const [snap, lang] = await Promise.all([
      db.collection('bot_replies').doc(`${client}.follow`).get(),
      lineUid ? resolveUserLang(db, lineUid) : Promise.resolve<Lang>('zh_tw'),
    ]);

    const fallback = getBotReplyDefault(client, 'follow');
    const seq = migrateBotReplyDoc(snap.exists ? snap.data() ?? null : null, fallback);
    return buildWelcomeMessages(seq, lang);
  } catch (err) {
    console.warn(`[follow-sequence] load ${client}.follow failed, fallback to single text:`, err);
    return [{ type: 'text', text: getBotReplyDefault(client, 'follow') }];
  }
}

/**
 * 處理 LINE webhook 事件（passenger / driver endpoint 共用此 handler，只差 client）
 *
 * - 驗 x-line-signature 簽名（用對應 channel secret）
 * - follow 事件：回歡迎訊息（不同 client 不同文案）
 * - text message 事件：回自動回覆（不同 client 不同文案）
 * - LINE 要求 HTTP 200，因此即使忽略事件也回 ok
 */
export async function handleLineWebhook(event: H3Event, client: LineClient): Promise<{ ok: boolean }> {
  const { secret, accessToken } = getLineChannel(client);

  const rawBody = await readRawBody(event, 'utf8') ?? '';

  const signature = getHeader(event, 'x-line-signature') ?? '';
  if (secret && !verifyLineSignature(secret, rawBody, signature)) {
    setResponseStatus(event, 401);
    return { ok: false };
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    setResponseStatus(event, 400);
    return { ok: false };
  }

  for (const ev of body.events ?? []) {
    // P43 Phase 1：每個 event 都寫 event log（fire-and-forget；簡單 schema）
    const eventType: EventType = _normalizeEventType(ev.type);
    let handlerResult: HandlerResult = 'ignored';
    let postbackData: string | null = null;
    let messageText: string | null = null;

    const replyCtx = { client, targetUid: ev.source.userId ?? null };

    if (ev.type === 'follow' && ev.replyToken && accessToken) {
      // 2026-06-08：follow event 改 push welcome sequence（多則 text/flex 混搭，依 user lang）
      const messages = await loadFollowMessages(client, ev.source.userId ?? null);
      if (messages.length === 0) {
        // admin 主動停用整段 sequence / 全部 message disabled / 無內容 → 不回覆
        handlerResult = 'ignored';
      } else {
        await _reply(accessToken, ev.replyToken, messages, replyCtx);
        handlerResult = 'replied';
      }
    } else if (ev.type === 'follow') {
      handlerResult = 'no_handler';  // 無 replyToken 或 accessToken
    }

    // P42 Phase 1：follow event 內 per-user 綁 lang 對應 richmenu（fire-and-forget；不阻塞 webhook 200 回應）
    if (ev.type === 'follow' && ev.source.userId) {
      const targetUid = ev.source.userId;
      void (async () => {
        try {
          const { firebaseServiceAccountJson } = useRuntimeConfig();
          if (!firebaseServiceAccountJson) return;
          const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
          const lang = await resolveUserLang(db, targetUid);
          await bindRichmenuForUser(db, client, targetUid, lang);
        } catch (err) {
          console.warn('[follow-bind-richmenu] failed (silent):', (err as Error).message);
        }
      })();
    }

    if (ev.type === 'message' && ev.message?.type === 'text' && ev.replyToken && accessToken) {
      messageText = ev.message.text;
      const text = await loadBotReply(client, 'text');
      if (text === null) {
        // admin 在 bot_replies 設 enabled=false → 主動停用，不回覆
        handlerResult = 'ignored';
      } else {
        await _reply(accessToken, ev.replyToken, [{ type: 'text', text }], replyCtx);
        handlerResult = 'replied';
      }
    } else if (ev.type === 'message' && ev.message?.type === 'text') {
      messageText = ev.message.text;
      handlerResult = 'no_handler';
    }

    // P38 Phase 1：postback event 走 whitelist handler；無 handler 或 handler 不回 → 靜默
    if (ev.type === 'postback' && ev.postback?.data && ev.source.userId && accessToken) {
      postbackData = ev.postback.data;
      try {
        const result = await handlePostbackEvent({
          client,
          lineUid: ev.source.userId,
          data: ev.postback.data,
        });
        if (result?.replyMessages && ev.replyToken) {
          await _reply(accessToken, ev.replyToken, result.replyMessages, replyCtx);
          handlerResult = 'replied';
        } else {
          handlerResult = 'no_handler';
        }
      } catch (err) {
        console.error('[line-webhook] postback handler failed:', err);
        handlerResult = 'handler_failed';
      }
    } else if (ev.type === 'postback' && ev.postback?.data) {
      postbackData = ev.postback.data;
      handlerResult = 'no_handler';
    }

    writeLineEventLog({
      channel: client,
      eventType,
      lineUid: ev.source.userId ?? null,
      postbackData,
      messageText,
      handlerResult,
    });
  }

  return { ok: true };
}

const KNOWN_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  'follow', 'unfollow', 'message', 'postback', 'beacon', 'memberJoined', 'memberLeft',
]);

function _normalizeEventType(type: string): EventType {
  return KNOWN_EVENT_TYPES.has(type as EventType) ? (type as EventType) : 'unknown';
}
