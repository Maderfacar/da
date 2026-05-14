/**
 * LINE push helper（P29 起：依 client 選對應 OA 的 access token）
 *
 * P37 Phase 4：
 *   - LineMessage 擴為 union（text / flex），支援公告 Flex Message
 *   - 新增 sendLineMulticast：批次推（最多 500 / call），公告 publish 用
 *
 * 用法：
 *   await sendLinePush('passenger', lineUserId, [{ type: 'text', text: '...' }]);
 *   await sendLinePush('passenger', lineUserId, [{ type: 'flex', altText: '...', contents: {...} }]);
 *   await sendLineMulticast('passenger', lineUserIds, [msg]);
 */
import { getLineChannel, type LineClient } from '@@/utils/line-channel';
import { writeLineApiError } from '@@/utils/line-api-error-log';

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: object };

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';

/** 單推（1 個 user） */
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
  try {
    await $fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: { to, messages },
    });
  } catch (err) {
    const e = err as { data?: unknown; statusCode?: number; message?: string };
    console.error(`[line-push] ${client} push failed:`, e?.data ?? e);
    // P43 Phase 2：寫 error log（不 rethrow — sendLinePush 既有契約為 silent fail）
    await writeLineApiError({
      channel: client,
      api: 'message/push',
      method: 'POST',
      statusCode: e?.statusCode ?? 0,
      errorMessage: e?.message ?? 'push failed',
      errorDetails: e?.data ?? null,
      context: { targetUid: to },
    });
  }
}

/**
 * 批次推（LINE multicast：1 call 推給最多 500 個 user）
 *
 * 自動切批：超過 500 個 to 會分多次 call。
 * fire-and-forget 思維：任一批失敗不阻塞其他批，最後回傳 { sent, failed }。
 *
 * 注意：multicast 不可推到「同一 user」多次（LINE side 會 dedupe），且 to 不可有重複。
 */
export async function sendLineMulticast(
  client: LineClient,
  toList: string[],
  messages: LineMessage[],
): Promise<{ sent: number; failed: number }> {
  const unique = Array.from(new Set(toList.filter((id) => !!id)));
  if (unique.length === 0) return { sent: 0, failed: 0 };

  const { accessToken } = getLineChannel(client);
  if (!accessToken) {
    console.warn(`[line-multicast] ${client} accessToken 未設定，skip ${unique.length} targets`);
    return { sent: 0, failed: unique.length };
  }

  const BATCH = 500;
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH) {
    batches.push(unique.slice(i, i + BATCH));
  }

  let sent = 0;
  let failed = 0;
  for (const batch of batches) {
    try {
      await $fetch(LINE_MULTICAST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: { to: batch, messages },
      });
      sent += batch.length;
    } catch (err) {
      failed += batch.length;
      const e = err as { data?: unknown; statusCode?: number; message?: string };
      console.error(`[line-multicast] ${client} batch failed (size=${batch.length}):`, e?.data ?? err);
      // P43 Phase 2：寫 error log（batch 統一一筆，含 size 標示）
      await writeLineApiError({
        channel: client,
        api: 'message/multicast',
        method: 'POST',
        statusCode: e?.statusCode ?? 0,
        errorMessage: `multicast batch failed (size=${batch.length}): ${e?.message ?? 'unknown'}`,
        errorDetails: e?.data ?? null,
      });
    }
  }
  return { sent, failed };
}
