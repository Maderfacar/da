/**
 * LINE Postback Whitelist + Handlers（P38 Phase 1）
 *
 * 設計動機（Brain AI 拍板 Q3=3a + Q4=4a）：
 *   - admin 在 richmenu area / Flex CTA 編輯 postback action 時，data 必須來自 whitelist
 *   - postback 處理邏輯需 server code 實作；free-form data 沒對應 handler = 無效
 *   - 新增 entry 必須改本檔 + 部署（與 template-registry 同樣的「強耦合」設計）
 *
 * 用法：
 *   - admin UI（Phase 2）撈 `POSTBACK_WHITELIST` 給 admin 選 postback data
 *   - LINE webhook 收到 postback event → 呼 `handlePostbackEvent(ctx)`
 *
 * 第一版（Phase 1）：framework + 空 whitelist。Phase 2 richmenu UI 上線前依設計
 * 填入 passenger / driver 共 4-8 個常用 action（OPEN_BOOKING / CONTACT_SUPPORT / ...）。
 */
import type { LineClient } from '@@/utils/line-channel';

export interface PostbackContext {
  client: LineClient;
  /** user 的 LINE userId（事件 source.userId） */
  lineUid: string;
  /** postback.data 原樣 */
  data: string;
}

export type PostbackHandler = (ctx: PostbackContext) => Promise<{
  /** 若回傳此欄位 → 呼叫端用 reply token 推給 user（LINE event reply）；不回則靜默 */
  replyMessages?: object[];
} | undefined>;

export interface PostbackEntry {
  /** Postback data；第一版用 exact match */
  data: string;
  /** Admin UI 顯示用標籤 */
  label: string;
  /** 適用 channel；'both' = 雙 OA 都可用 */
  channel: LineClient | 'both';
  /** 處理函式 */
  handler: PostbackHandler;
}

/**
 * Postback whitelist（Phase 1：空，Phase 2 設計確認後填入）
 *
 * 預計加入：
 *   - passenger: OPEN_BOOKING / OPEN_NOTIFICATIONS / CONTACT_SUPPORT / MY_TRIP
 *   - driver: OPEN_DASHBOARD / PENDING_LIST / MY_PROFILE / TRIP_GPS
 */
export const POSTBACK_WHITELIST: PostbackEntry[] = [];

/** 從 whitelist 找對應 entry；data 不在 whitelist 或 channel 不符 → null */
export function findPostbackHandler(client: LineClient, data: string): PostbackEntry | null {
  return POSTBACK_WHITELIST.find(
    (e) => e.data === data && (e.channel === 'both' || e.channel === client),
  ) ?? null;
}

/** 列 admin UI 用的 whitelist（依 channel 過濾） */
export function listPostbackWhitelist(client: LineClient): Array<{ data: string; label: string }> {
  return POSTBACK_WHITELIST
    .filter((e) => e.channel === 'both' || e.channel === client)
    .map((e) => ({ data: e.data, label: e.label }));
}

/**
 * 處理 webhook postback event
 *
 * @returns 若 handler 回傳 replyMessages → 由呼叫端 reply；無 handler 或 handler 不回 → null
 */
export async function handlePostbackEvent(
  ctx: PostbackContext,
): Promise<{ replyMessages: object[] } | null> {
  const entry = findPostbackHandler(ctx.client, ctx.data);
  if (!entry) {
    console.warn(`[postback] no handler for ${ctx.client}/${ctx.data} (uid=${ctx.lineUid})`);
    return null;
  }
  try {
    const res = await entry.handler(ctx);
    if (res?.replyMessages && res.replyMessages.length > 0) {
      return { replyMessages: res.replyMessages };
    }
    return null;
  } catch (err) {
    console.error(`[postback] handler ${entry.data} failed:`, err);
    return null;
  }
}
