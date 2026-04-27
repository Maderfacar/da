import { verifyLineSignature } from '@@/utils/line-signature';

// LINE Webhook event 型別（僅使用到的欄位）
interface LineTextMessage {
  type: 'text';
  text: string;
}
interface LineEvent {
  type: string;
  replyToken?: string;
  source: { userId?: string; type: string };
  message?: LineTextMessage;
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
  }).catch((err) => console.error('[webhook] reply failed:', err));
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const { lineChannelSecret, lineChannelAccessToken } = config;

  // ── 1. 取得原始 body（簽名驗證需要原始字串）────────────────
  const rawBody = await readRawBody(event, 'utf8') ?? '';

  // ── 2. 驗證 LINE 簽名 ──────────────────────────────────────
  const signature = getHeader(event, 'x-line-signature') ?? '';
  if (lineChannelSecret && !verifyLineSignature(lineChannelSecret, rawBody, signature)) {
    setResponseStatus(event, 401);
    return { ok: false };
  }

  // ── 3. 解析事件 ────────────────────────────────────────────
  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    setResponseStatus(event, 400);
    return { ok: false };
  }

  // ── 4. 處理各類事件 ────────────────────────────────────────
  for (const ev of body.events ?? []) {

    // 加好友事件 → 發送歡迎訊息
    if (ev.type === 'follow' && ev.replyToken && lineChannelAccessToken) {
      await _reply(lineChannelAccessToken, ev.replyToken, [
        {
          type: 'text',
          text: '感謝您加入 DestinationAnywhere！\n\n✈ 專業機場接送服務，隨時為您出發。\n\n請透過 LINE LIFF 完成訂車預約，我們將盡快為您安排。',
        },
      ]);
    }

    // 文字訊息事件 → 自動回覆
    if (ev.type === 'message' && ev.message?.type === 'text' && ev.replyToken && lineChannelAccessToken) {
      await _reply(lineChannelAccessToken, ev.replyToken, [
        {
          type: 'text',
          text: '您好！感謝您的訊息。\n\n如需訂車或查詢行程，請點選下方選單或透過 LIFF 操作，我們的客服將盡快與您聯繫。',
        },
      ]);
    }
  }

  // LINE 要求回傳 HTTP 200
  return { ok: true };
});
