/**
 * LINE Postback Whitelist + Handlers（P38 Phase 1 framework + P40 Phase 1 填內容）
 *
 * 設計動機（Brain AI 拍板 Q3=3a + Q4=4a）：
 *   - admin 在 richmenu area / Flex CTA 編輯 postback action 時，data 必須來自 whitelist
 *   - postback 處理邏輯需 server code 實作；free-form data 沒對應 handler = 無效
 *   - 新增 entry 必須改本檔 + 部署（與 template-registry 同樣的「強耦合」設計）
 *
 * 用法：
 *   - admin UI 撈 `POSTBACK_WHITELIST` 給 admin 選 postback data（GET /admin/line-postback-whitelist）
 *   - LINE webhook 收到 postback event → 呼 `handlePostbackEvent(ctx)`
 *
 * LIFF URL 取值（P40 Q1=1a，「先檢查既有 env var」精神實作）：
 *   - 既有 runtimeConfig.public.lineLiffIdPassenger / lineLiffIdDriver 已支援雙 LIFF app
 *   - getLiffUrl 直接基於 LIFF ID 組 https://liff.line.me/{liffId}{path}，不新增冗餘 env var
 *   - LIFF SDK 把 path 帶到 endpoint URL；endpoint 既有路由可解析
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
 * 組 LIFF URL（內部 helper）
 *
 * 機制：LIFF SDK 解析 `https://liff.line.me/{liffId}{subPath}` 後 redirect 到 endpoint
 * 並把 subPath 附加（endpoint 端 Nuxt router 解析）。雙 LIFF app 場景由 liffId 自然分流。
 *
 * 缺 LIFF ID 時 fallback 給 path（保險，dev 環境用）。
 */
function _getLiffUrl(client: LineClient, subPath: string): string {
  const config = useRuntimeConfig();
  const liffId = client === 'driver'
    ? config.public.lineLiffIdDriver
    : config.public.lineLiffIdPassenger;
  const normalized = subPath.startsWith('/') ? subPath : `/${subPath}`;
  if (!liffId) return normalized;
  return `https://liff.line.me/${liffId}${normalized}`;
}

/**
 * 組客服回覆訊息（CONTACT_SUPPORT 用）
 *
 * 取 runtimeConfig.public.customerServicePhone / customerServiceHours 附加；
 * 都沒設則只回固定一句訊息。
 */
function _buildSupportReply(): string {
  const config = useRuntimeConfig();
  const phone = config.public.customerServicePhone || '';
  const hours = config.public.customerServiceHours || '';
  const lines: string[] = ['您好！如需協助請於 OA 內留言，我們將盡快回覆。'];
  if (phone) lines.push(`☎ 客服專線：${phone}`);
  if (hours) lines.push(`🕒 服務時段：${hours}`);
  return lines.join('\n');
}

/**
 * Postback whitelist（P40 Phase 1 填入 8 個常用 entry）
 *
 * Passenger：OPEN_BOOKING / OPEN_NOTIFICATIONS / CONTACT_SUPPORT / MY_TRIP
 * Driver：   OPEN_DASHBOARD / PENDING_LIST / MY_PROFILE / TRIP_GPS
 */
export const POSTBACK_WHITELIST: PostbackEntry[] = [
  // ── Passenger OA ─────────────────────────────────────
  {
    data: 'OPEN_BOOKING',
    label: '開啟訂車 LIFF',
    channel: 'passenger',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `請點此開啟訂車：${_getLiffUrl('passenger', '/booking')}`,
      }],
    }),
  },
  {
    data: 'OPEN_NOTIFICATIONS',
    label: '開啟通知中心',
    channel: 'passenger',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `查看最新消息：${_getLiffUrl('passenger', '/notifications')}`,
      }],
    }),
  },
  {
    data: 'MY_TRIP',
    label: '我的行程',
    channel: 'passenger',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `查看您的行程：${_getLiffUrl('passenger', '/orders')}`,
      }],
    }),
  },
  {
    data: 'CONTACT_SUPPORT',
    label: '聯絡客服',
    channel: 'both',
    handler: async () => ({
      replyMessages: [{ type: 'text', text: _buildSupportReply() }],
    }),
  },

  // ── Driver OA ────────────────────────────────────────
  {
    data: 'OPEN_DASHBOARD',
    label: '司機儀表板',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `司機儀表板：${_getLiffUrl('driver', '/driver/dashboard')}`,
      }],
    }),
  },
  {
    data: 'PENDING_LIST',
    label: '搶單列表',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `查看可接訂單：${_getLiffUrl('driver', '/driver/pending')}`,
      }],
    }),
  },
  {
    data: 'MY_PROFILE',
    label: '司機個人頁',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `個人資料：${_getLiffUrl('driver', '/driver/profile')}`,
      }],
    }),
  },
  {
    data: 'TRIP_GPS',
    label: '任務 GPS',
    channel: 'driver',
    handler: async () => ({
      replyMessages: [{
        type: 'text',
        text: `任務 GPS 導航：${_getLiffUrl('driver', '/driver/trip')}`,
      }],
    }),
  },
];

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
