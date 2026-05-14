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

async function _reply(accessToken: string, replyToken: string, messages: object[]) {
  await $fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: { replyToken, messages },
  }).catch((err) => console.error('[line-webhook] reply failed:', err));
}

const FOLLOW_MESSAGES: Record<LineClient, string> = {
  passenger: '感謝您加入 DestinationAnywhere！\n\n✈ 專業機場接送服務，隨時為您出發。\n\n請透過 LINE LIFF 完成訂車預約，我們將盡快為您安排。',
  driver: '感謝加入 DestinationAnywhere 司機端！\n\n✅ 之後新派單與訂單更新都會推播到此 LINE 帳號。\n\n請至 LIFF 完成上線並開始接單。',
};

const TEXT_REPLY_MESSAGES: Record<LineClient, string> = {
  passenger: '您好！感謝您的訊息。\n\n如需訂車或查詢行程，請點選下方選單或透過 LIFF 操作，我們的客服將盡快與您聯繫。',
  driver: '司機您好。\n\n本帳號用於派單通知；如需操作（接單 / 任務 / 個人資料），請至 LIFF 司機端。',
};

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
    if (ev.type === 'follow' && ev.replyToken && accessToken) {
      await _reply(accessToken, ev.replyToken, [{ type: 'text', text: FOLLOW_MESSAGES[client] }]);
    }
    if (ev.type === 'message' && ev.message?.type === 'text' && ev.replyToken && accessToken) {
      await _reply(accessToken, ev.replyToken, [{ type: 'text', text: TEXT_REPLY_MESSAGES[client] }]);
    }
    // P38 Phase 1：postback event 走 whitelist handler；無 handler 或 handler 不回 → 靜默
    if (ev.type === 'postback' && ev.postback?.data && ev.source.userId && accessToken) {
      const result = await handlePostbackEvent({
        client,
        lineUid: ev.source.userId,
        data: ev.postback.data,
      });
      if (result?.replyMessages && ev.replyToken) {
        await _reply(accessToken, ev.replyToken, result.replyMessages);
      }
    }
  }

  return { ok: true };
}
