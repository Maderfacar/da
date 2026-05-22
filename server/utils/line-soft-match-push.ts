/**
 * Phase 1F：Soft Match / 重新配對 LINE push helpers
 *
 * 設計（拍版）：
 *   - hard-coded Flex template（不進 notification_templates；Phase 2 可改）
 *   - passenger 推 passenger OA；driver 推 driver OA（沿用 1E getDispatchPushEnv）
 *   - 三語：passenger（zh_tw / en / ja）；driver deselect 通知繁中即可（拍版 #16 沿用）
 *   - postback data 格式：`passenger.softMatch.<decision>?orderId=<orderId>`
 *
 * 4 個 push helper：
 *   1. pushSoftMatchToPassenger(env, payload, lang)     — 配對成功但部分符合 → 3 選 1 Flex
 *   2. pushPassengerRematch(env, payload, lang)         — 訂單重新進入配對佇列
 *   3. pushDriverDeselected(env, payload)               — 原中選 driver 收 deselect 通知（繁中）
 */
import { sendLinePush, type LineMessage } from '@@/utils/line-push';
import type { Lang } from '@@/utils/i18n-message';
import type { DispatchPushEnv } from '@@/utils/line-dispatch-push';

export interface SoftMatchPassengerPayload {
  orderId: string;
  pickupDateTime: string;
  driverDisplayName: string;
  /** 去前綴 lineUid（連 /vehicles/{driverId}） */
  driverId: string;
  /** 完成趟數（snapshot；admin /bids 端讀同來源 drivers/{lineUid}.totalTrips） */
  completedOrders: number;
  /** 符合的偏好標籤中文名 */
  matchedTagNames: string[];
  /** 未符合的偏好標籤中文名 */
  unmatchedTagNames: string[];
  /** 乘客偏好總數（matchCount + unmatched）；給 subtitle 顯示「N 項中 M 項符合」 */
  preferenceCount: number;
  matchCount: number;
}

export interface PassengerRematchPayload {
  orderId: string;
  pickupDateTime: string;
}

export interface DriverDeselectedPayload {
  orderId: string;
  pickupDateTime: string;
}

const _orderIdShort = (id: string): string => id.slice(0, 8).toUpperCase();

const _formatDateTime = (iso: string): string => {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
};

/**
 * 組 LIFF URL（path-append）— 見 server/utils/line-dispatch-push.ts 同名 helper 註解。
 * 兩個 LIFF App 的 endpoint URL 已設成根路徑 `/`，subPath append 後直接是正確路由。
 */
const _buildLiffUrl = (liffId: string, subPath: string, fallback: string): string => {
  const normalized = subPath.startsWith('/') ? subPath : `/${subPath}`;
  if (!liffId) return fallback;
  return `https://liff.line.me/${liffId}${normalized}`;
};

// ── 三語文案表 ─────────────────────────────────────────────────────────
interface SoftMatchTexts {
  title: string;
  subtitle: (m: number, total: number) => string;
  driverLabel: string;
  pickupLabel: string;
  completedLabel: (n: number) => string;
  matchedHeader: string;
  unmatchedHeader: string;
  noneFallback: string;
  viewVehicle: string;
  btnAccept: string;
  btnWait: string;
  btnCancel: string;
  altText: string;
}

const SOFT_MATCH_TEXT: Record<Lang, SoftMatchTexts> = {
  zh_tw: {
    title: '⚠️ 配對部分符合',
    subtitle: (m, total) => `您勾選的 ${total} 項偏好中，${m} 項符合`,
    driverLabel: '司機',
    pickupLabel: '上車時間',
    completedLabel: (n) => `完成 ${n} 趟`,
    matchedHeader: '✓ 符合偏好',
    unmatchedHeader: '✗ 未符合',
    noneFallback: '無',
    viewVehicle: '查看車輛',
    btnAccept: '接受此車',
    btnWait: '等下一輪配對',
    btnCancel: '取消訂單',
    altText: '⚠️ 配對部分符合',
  },
  en: {
    title: '⚠️ Partial match',
    subtitle: (m, total) => `Matched ${m} of your ${total} preferences`,
    driverLabel: 'Driver',
    pickupLabel: 'Pickup',
    completedLabel: (n) => `${n} trips completed`,
    matchedHeader: '✓ Matched',
    unmatchedHeader: '✗ Not matched',
    noneFallback: 'None',
    viewVehicle: 'View vehicle',
    btnAccept: 'Accept this car',
    btnWait: 'Wait for next match',
    btnCancel: 'Cancel order',
    altText: '⚠️ Partial match',
  },
  ja: {
    title: '⚠️ 部分一致のマッチ',
    subtitle: (m, total) => `お選びの ${total} 項目のうち ${m} 項目が一致`,
    driverLabel: 'ドライバー',
    pickupLabel: '乗車時刻',
    completedLabel: (n) => `完了 ${n} 件`,
    matchedHeader: '✓ 一致',
    unmatchedHeader: '✗ 不一致',
    noneFallback: 'なし',
    viewVehicle: '車両を確認',
    btnAccept: 'この車両を承認',
    btnWait: '次の配車を待つ',
    btnCancel: '注文をキャンセル',
    altText: '⚠️ 部分一致のマッチ',
  },
};

const REMATCH_TEXT: Record<Lang, { title: string; body: string; altText: string }> = {
  zh_tw: { title: '🔄 正在重新為您配對', body: '原車輛已撤回，正在尋找其他符合的司機', altText: '🔄 正在重新配對' },
  en:    { title: '🔄 Re-matching your order', body: 'The previous vehicle was withdrawn. Searching for another driver.', altText: '🔄 Re-matching' },
  ja:    { title: '🔄 再マッチング中', body: '以前の車両は取り下げられました。新しいドライバーを探しています。', altText: '🔄 再マッチング中' },
};

// ── 1. Soft Match 3-button Flex（passenger）────────────────────────────────
export function buildSoftMatchPassengerFlex(
  payload: SoftMatchPassengerPayload,
  env: DispatchPushEnv,
  lang: Lang,
): LineMessage {
  const t = SOFT_MATCH_TEXT[lang] ?? SOFT_MATCH_TEXT.zh_tw;
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const matchedLine = payload.matchedTagNames.length > 0
    ? payload.matchedTagNames.join('、')
    : t.noneFallback;
  const unmatchedLine = payload.unmatchedTagNames.length > 0
    ? payload.unmatchedTagNames.join('、')
    : t.noneFallback;

  const vehicleSubPath = `/vehicles/${payload.driverId}`;
  const vehicleUri = _buildLiffUrl(env.liffIdPassenger, vehicleSubPath, vehicleSubPath);

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: t.title, weight: 'bold', size: 'lg', color: '#D4860A' },
        { type: 'text', text: t.subtitle(payload.matchCount, payload.preferenceCount), size: 'sm', color: '#666666', wrap: true, margin: 'sm' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: `🔖 #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'md' },
        { type: 'text', text: `🚗 ${t.driverLabel}：${payload.driverDisplayName}`, size: 'md', weight: 'bold', wrap: true, margin: 'sm' },
        { type: 'text', text: `📅 ${t.pickupLabel}：${dateLine}`, size: 'sm', margin: 'xs', color: '#333333' },
        { type: 'text', text: `✓ ${t.completedLabel(payload.completedOrders)}`, size: 'xs', color: '#666666', margin: 'xs' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: t.matchedHeader, size: 'sm', color: '#50C878', weight: 'bold', margin: 'md' },
        { type: 'text', text: matchedLine, size: 'xs', color: '#333333', wrap: true, margin: 'xs' },
        { type: 'text', text: t.unmatchedHeader, size: 'sm', color: '#D14343', weight: 'bold', margin: 'md' },
        { type: 'text', text: unmatchedLine, size: 'xs', color: '#333333', wrap: true, margin: 'xs' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'link',
          height: 'sm',
          action: { type: 'uri', label: t.viewVehicle, uri: vehicleUri },
        },
        {
          type: 'button',
          style: 'primary',
          color: '#50C878',
          action: { type: 'postback', label: t.btnAccept, data: `passenger.softMatch.accept?orderId=${payload.orderId}`, displayText: t.btnAccept },
        },
        {
          type: 'button',
          style: 'primary',
          color: '#D4860A',
          action: { type: 'postback', label: t.btnWait, data: `passenger.softMatch.wait?orderId=${payload.orderId}`, displayText: t.btnWait },
        },
        {
          type: 'button',
          style: 'secondary',
          action: { type: 'postback', label: t.btnCancel, data: `passenger.softMatch.cancel?orderId=${payload.orderId}`, displayText: t.btnCancel },
        },
      ],
    },
  };

  return { type: 'flex', altText: t.altText, contents: bubble };
}

export async function pushSoftMatchToPassenger(
  passengerLineUid: string,
  payload: SoftMatchPassengerPayload,
  env: DispatchPushEnv,
  lang: Lang,
): Promise<void> {
  if (!passengerLineUid) return;
  const flex = buildSoftMatchPassengerFlex(payload, env, lang);
  await sendLinePush('passenger', passengerLineUid, [flex]);
}

// ── 2. 重新配對通知（passenger）─────────────────────────────────────────
export function buildPassengerRematchFlex(
  payload: PassengerRematchPayload,
  lang: Lang,
): LineMessage {
  const t = REMATCH_TEXT[lang] ?? REMATCH_TEXT.zh_tw;
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: t.title, weight: 'bold', size: 'lg', color: '#D4860A' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: `🔖 #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'md' },
        { type: 'text', text: t.body, size: 'sm', wrap: true, margin: 'sm' },
        { type: 'text', text: `📅 ${dateLine}`, size: 'sm', color: '#333333', margin: 'sm' },
      ],
    },
  };
  return { type: 'flex', altText: t.altText, contents: bubble };
}

export async function pushPassengerRematch(
  passengerLineUid: string,
  payload: PassengerRematchPayload,
  lang: Lang,
): Promise<void> {
  if (!passengerLineUid) return;
  const flex = buildPassengerRematchFlex(payload, lang);
  await sendLinePush('passenger', passengerLineUid, [flex]);
}

// ── 3. 原中選 driver 收 deselect 通知（繁中文字；簡單明確）─────────────────
export async function pushDriverDeselected(
  driverLineUserId: string,
  payload: DriverDeselectedPayload,
): Promise<void> {
  if (!driverLineUserId) return;
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);
  const text = `🔁 訂單已重新分派\n訂單 #${orderShort}（${dateLine}）已重新進入配對佇列，本次未繼續由您接單，請查看接單看板有無其他機會。`;
  await sendLinePush('driver', driverLineUserId, [{ type: 'text', text }]);
}
