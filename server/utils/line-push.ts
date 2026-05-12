/**
 * LINE push helper（P29 起：依 client 選對應 OA 的 access token）
 *
 * 用法：
 *   await sendLinePush('passenger', lineUserId, [{ type: 'text', text: '...' }]);
 *   await sendLinePush('driver',    lineUserId, [{ type: 'text', text: '...' }]);
 */
import { getLineChannel, type LineClient } from '@@/utils/line-channel';

interface LineMessage {
  type: 'text';
  text: string;
}

export async function sendLinePush(
  client: LineClient,
  to: string,
  messages: LineMessage[],
): Promise<void> {
  if (!to) return;
  const { accessToken } = getLineChannel(client);
  if (!accessToken) {
    console.warn(`[line-push] ${client} accessToken 未設定，skip push to ${to}`);
    return;
  }
  await $fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: { to, messages },
  }).catch((err) => {
    console.error(`[line-push] ${client} push failed:`, err?.data ?? err);
  });
}
