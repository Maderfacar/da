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
import { FieldValue } from 'firebase-admin/firestore';
import type { LineClient } from '@@/utils/line-channel';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { acceptSoftMatch, declineSoftMatch, rematchOrder } from '@@/utils/order-soft-match';
import { DispatchGuardError, loadActiveDrivers } from '@@/utils/order-dispatch';
import {
  pushOrderDispatchToDrivers,
  getDispatchPushEnv,
} from '@@/utils/line-dispatch-push';
import { pushDriverDeselected, pushPassengerRematch } from '@@/utils/line-soft-match-push';
import { buildTagIndex } from '@@/utils/vehicle-profile';
import { getUserLang } from '@@/utils/i18n-message';
import type { AuditAction } from '@@/utils/audit-log';

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
 * Phase 1F：動態 postback 處理器（prefix-based）— 與 whitelist exact-match 並存。
 *
 * 用於 LINE Flex 帶 query 的 postback data（如 `passenger.softMatch.accept?orderId=XXX`）。
 * findPostbackHandler 先比 exact whitelist，再試 PREFIX_HANDLERS；都沒有才回 null。
 *
 * 與 whitelist 區別：
 *   - whitelist 是 admin 在 UI 下拉可選的 button data（受控、可被 audit）
 *   - PREFIX_HANDLERS 是 server 內部 push 出去的 Flex 自帶 postback（admin 不能編）
 */
interface PrefixHandlerEntry {
  /** 必須命中的前綴；data 可以是 `prefix?key=val` 形式 */
  prefix: string;
  channel: LineClient | 'both';
  handler: PostbackHandler;
}

/**
 * 組 LIFF URL（內部 helper）
 *
 * P19-fix（Phase 1G hotfix）：subPath 改走 `?next=` query 由 `_InitLiffFlow` 解析後
 * navigate。原本 path-append 寫法會把 subPath 拼到 LINE Console 設的 endpoint URL 後面
 * （司機=/driver/dashboard、乘客=/home），造成 /driver/dashboard/foo 404。
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
  return `https://liff.line.me/${liffId}?next=${encodeURIComponent(normalized)}`;
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

/**
 * Phase 1F：parse Soft Match postback data
 *
 * Data 格式：`passenger.softMatch.<decision>?orderId=<orderId>`
 * 回傳 `{ decision, orderId }` 或 null（格式不對）。
 */
function _parseSoftMatchData(data: string): { decision: 'accept' | 'wait' | 'cancel'; orderId: string } | null {
  const m = data.match(/^passenger\.softMatch\.(accept|wait|cancel)\?orderId=([^&]+)$/);
  if (!m) return null;
  return { decision: m[1] as 'accept' | 'wait' | 'cancel', orderId: m[2] };
}

/**
 * Phase 1F：postback 內部直接呼叫 utility（不走 HTTP self-call，
 * 因 server self-call 無法帶 cookie / auth header；改用 db handle 直接讀寫 + transaction 守則）。
 *
 * Handler 內 owner check：source.userId 對齊 orders/{orderId}.userId 或 .lineUserId。
 */
const PREFIX_HANDLERS: PrefixHandlerEntry[] = [
  {
    prefix: 'passenger.softMatch.',
    channel: 'passenger',
    handler: async (ctx) => {
      const parsed = _parseSoftMatchData(ctx.data);
      if (!parsed) {
        console.warn('[postback] passenger.softMatch invalid data:', ctx.data);
        return { replyMessages: [{ type: 'text', text: '⚠️ 操作失敗，連結格式錯誤' }] };
      }
      const { decision, orderId } = parsed;
      const { firebaseServiceAccountJson } = useRuntimeConfig();
      if (!firebaseServiceAccountJson) {
        return { replyMessages: [{ type: 'text', text: '⚠️ 系統未設定 Firebase' }] };
      }
      const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

      // 守 owner：order.lineUserId / userId 必須對齊 source.userId
      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        return { replyMessages: [{ type: 'text', text: '⚠️ 找不到對應訂單' }] };
      }
      const orderData = orderSnap.data() ?? {};
      const orderUserId = (orderData.userId as string | undefined) ?? '';
      const orderLineUserId = (orderData.lineUserId as string | undefined) ?? '';
      if (orderUserId !== ctx.lineUid && orderLineUserId !== ctx.lineUid) {
        return { replyMessages: [{ type: 'text', text: '⚠️ 無權操作此訂單' }] };
      }
      // 守 confirmationStatus='pending'
      if (orderData.passengerConfirmationStatus !== 'pending') {
        return { replyMessages: [{ type: 'text', text: '⚠️ 本次選擇已逾時或已處理' }] };
      }

      const env = getDispatchPushEnv();
      const pickupDateTime = (orderData.pickupDateTime as string) ?? '';
      const pickupAddress = (orderData.pickupLocation?.displayName as string) || (orderData.pickupLocation?.address as string) || '';
      const dropoffAddress = (orderData.dropoffLocation?.displayName as string) || (orderData.dropoffLocation?.address as string) || '';
      const passengerCount = (orderData.passengerCount as number) ?? 1;
      const estimatedFare = (orderData.estimatedFare as number) ?? 0;
      const passengerLineUid = orderLineUserId || orderUserId;

      try {
        if (decision === 'accept') {
          await acceptSoftMatch(db, orderId);
          await _writeSoftMatchAudit(db, orderId, 'accept', ctx.lineUid, null);
          return { replyMessages: [{ type: 'text', text: '✅ 已接受配對，行程即將開始' }] };
        }

        if (decision === 'wait') {
          const { prevDriverLineUid, reMatchRound } = await rematchOrder(db, orderId, 'rematched_by_passenger');
          // 撈原 driver / 偏好 chip
          const [prevDriverSnap, tagIdx] = await Promise.all([
            db.collection('users').doc(prevDriverLineUid).get(),
            buildTagIndex(db),
          ]);
          const prevDriverLineUserId = (prevDriverSnap.exists ? (prevDriverSnap.data()?.lineUserId as string | undefined) : undefined) ?? prevDriverLineUid;
          const preferences = orderData.preferences as { tagIds?: unknown } | undefined;
          const preferenceTagIds: string[] = Array.isArray(preferences?.tagIds) ? (preferences!.tagIds as string[]) : [];
          const preferenceChips = preferenceTagIds
            .map((id) => tagIdx.get(id)?.nameZh ?? '')
            .filter((s) => s.length > 0);

          void (async () => {
            try { await pushDriverDeselected(prevDriverLineUserId, { orderId, pickupDateTime }); } catch (err) { console.error('[postback wait] deselect push:', err); }
          })();
          void (async () => {
            try {
              const drivers = await loadActiveDrivers(db);
              await pushOrderDispatchToDrivers({
                orderId, pickupDateTime, pickupAddress, dropoffAddress, passengerCount, estimatedFare, preferenceChips,
              }, env, drivers.map((d) => d.lineUserId));
            } catch (err) { console.error('[postback wait] dispatch push:', err); }
          })();
          void (async () => {
            try {
              const lang = await getUserLang(db, passengerLineUid);
              await pushPassengerRematch(passengerLineUid, { orderId, pickupDateTime }, lang);
            } catch (err) { console.error('[postback wait] passenger push:', err); }
          })();
          await _writeSoftMatchAudit(db, orderId, 'wait', ctx.lineUid, { reMatchRound, prevDriverId: prevDriverLineUid });
          return { replyMessages: [{ type: 'text', text: '🔄 已重新進入配對佇列，將盡快為您找新車輛' }] };
        }

        // decision === 'cancel'
        const { prevDriverLineUid } = await declineSoftMatch(db, orderId, 'passenger_soft_match_declined');
        void (async () => {
          try {
            if (!prevDriverLineUid) return;
            const prevDriverSnap = await db.collection('users').doc(prevDriverLineUid).get();
            const prevDriverLineUserId = (prevDriverSnap.exists ? (prevDriverSnap.data()?.lineUserId as string | undefined) : undefined) ?? prevDriverLineUid;
            await pushDriverDeselected(prevDriverLineUserId, { orderId, pickupDateTime });
          } catch (err) { console.error('[postback cancel] deselect push:', err); }
        })();
        await _writeSoftMatchAudit(db, orderId, 'cancel', ctx.lineUid, { prevDriverId: prevDriverLineUid });
        return { replyMessages: [{ type: 'text', text: '🚫 訂單已取消' }] };
      } catch (err) {
        if (err instanceof DispatchGuardError) {
          if (err.code === 'invalid_status') {
            return { replyMessages: [{ type: 'text', text: '⚠️ 訂單狀態已變動，無法執行此操作' }] };
          }
          if (err.code === 'order_not_found') {
            return { replyMessages: [{ type: 'text', text: '⚠️ 找不到對應訂單' }] };
          }
        }
        console.error('[postback soft-match] failed:', err);
        return { replyMessages: [{ type: 'text', text: '⚠️ 系統錯誤，請聯絡客服' }] };
      }
    },
  },
];

/** Phase 1F：postback handler 內寫 audit log（actor 直接用 lineUid，無 auth.level） */
async function _writeSoftMatchAudit(
  _db: FirebaseFirestore.Firestore,
  orderId: string,
  decision: 'accept' | 'wait' | 'cancel',
  lineUid: string,
  extra: Record<string, unknown> | null,
): Promise<void> {
  try {
    // 不走 writeAuditLog（需 H3Event + AuthOk）；直接寫 audit_logs collection
    await _db.collection('audit_logs').add({
      actorUid: lineUid,
      actorDisplayName: lineUid,
      actorLevel: 'passenger',
      action: 'order.soft_match_response' satisfies AuditAction,
      targetType: 'order',
      targetId: orderId,
      payload: { decision, source: 'line_postback', ...(extra ?? {}) },
      ip: '',
      userAgent: 'line-webhook',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[postback] write audit failed (silent):', err);
  }
}

/** 從 whitelist 找對應 entry；data 不在 whitelist 或 channel 不符 → null */
export function findPostbackHandler(client: LineClient, data: string): PostbackEntry | null {
  const exact = POSTBACK_WHITELIST.find(
    (e) => e.data === data && (e.channel === 'both' || e.channel === client),
  );
  if (exact) return exact;
  // Phase 1F：prefix-based handler（如 soft-match）
  const prefix = PREFIX_HANDLERS.find(
    (p) => data.startsWith(p.prefix) && (p.channel === 'both' || p.channel === client),
  );
  if (prefix) {
    return { data, label: prefix.prefix, channel: prefix.channel, handler: prefix.handler };
  }
  return null;
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
