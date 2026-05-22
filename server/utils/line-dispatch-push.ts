/**
 * LINE push helpers — Phase 1E 訂單需求單 / 配對通知
 *
 * 設計：
 *   - hard-coded Flex template（不進 notification_templates；Phase 2 若要 admin 編輯化再說）
 *   - 全部 push 都用 sendLinePush（silent fail；errors 寫 line_api_errors）
 *   - 推播對象：driver 推 driver OA（沿用 P29 lineLiffIdDriver）；passenger 推 passenger OA
 *   - admin / driver UI 文案繁中（拍版 #16）；passenger 通知三語（lang 由呼叫端傳入）
 *
 * 4 個 push helper：
 *   1. pushOrderDispatchToDrivers(env, payload, drivers)   — 需求單推所有 driver
 *   2. pushOrderAssignedToPassenger(env, payload, lang)    — 配對成功 + 連車輛公開頁
 *   3. pushOrderAssignedToDriver(env, payload)             — 中選通知（繁中）
 *   4. pushOrderCancelledToBidders(env, payload, bidders)  — 取消通知（繁中文字）
 */
import { sendLinePush, sendLineMulticast, type LineMessage } from '@@/utils/line-push';
import type { Lang } from '@@/utils/i18n-message';

export interface DispatchedOrderSummary {
  orderId: string;
  pickupDateTime: string;
  pickupAddress: string;
  dropoffAddress: string;
  passengerCount: number;
  estimatedFare: number;
  /** 偏好標籤中文 chip list（admin/driver 端皆繁中顯示） */
  preferenceChips: string[];
}

export interface AssignedPassengerPayload {
  orderId: string;
  pickupDateTime: string;
  driverDisplayName: string;
  driverId: string;            // 去前綴 lineUid（給 /vehicles/{driverId} 連結）
}

export interface AssignedDriverPayload {
  orderId: string;
  pickupDateTime: string;
  pickupAddress: string;
  dropoffAddress: string;
  passengerCount: number;
}

export interface DispatchPushEnv {
  /** 司機 LIFF App ID（用於組需求單推播 CTA / 中選通知 CTA） */
  liffIdDriver: string;
  /** 乘客 LIFF App ID（用於組配對成功推播 CTA） */
  liffIdPassenger: string;
}

const _orderIdShort = (id: string): string => id.slice(0, 8).toUpperCase();

const _formatDateTime = (iso: string): string => {
  // YYYY-MM-DDTHH:mm[:ss][Z|+08:00] → 'MM/DD HH:mm'
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
};

/**
 * 組 LIFF URL（path-append）
 *
 * 機制：LIFF SDK 把 `liff.line.me/{liffId}{subPath}` 的 subPath append 到 LINE Console 設的
 * endpoint URL，再 redirect 到結果頁。本專案兩個 LIFF App 的 endpoint URL 已設成根路徑 `/`，
 * 所以 subPath（如 `/driver/dispatched/abc`）append 後直接是正確的 app 路由。
 *
 * 缺 LIFF ID 時 fallback 給 path（保險，dev 環境用）。
 */
const _buildLiffUrl = (liffId: string, subPath: string, fallback: string): string => {
  const normalized = subPath.startsWith('/') ? subPath : `/${subPath}`;
  if (!liffId) return fallback;
  return `https://liff.line.me/${liffId}${normalized}`;
};

// ── 1. 需求單推播（給所有 active driver）──────────────────────────────────
export function buildDispatchFlex(
  payload: DispatchedOrderSummary,
  env: DispatchPushEnv,
): LineMessage {
  const subPath = `/driver/dispatched/${payload.orderId}`;
  const ctaUri = _buildLiffUrl(env.liffIdDriver, subPath, subPath);
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const bodyContents: Array<Record<string, unknown>> = [
    { type: 'text', text: '📦 新訂單派發', weight: 'bold', size: 'lg', color: '#D4860A' },
    { type: 'separator', margin: 'md' },
    { type: 'text', text: `🔖 #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'md' },
    { type: 'text', text: `📅 ${dateLine}`, size: 'md', wrap: true, margin: 'sm' },
    { type: 'text', text: `📍 ${payload.pickupAddress}`, size: 'sm', wrap: true, margin: 'sm', color: '#333333' },
    { type: 'text', text: `🏁 ${payload.dropoffAddress}`, size: 'sm', wrap: true, margin: 'xs', color: '#333333' },
    { type: 'text', text: `👥 ${payload.passengerCount} 人  💰 NT$ ${payload.estimatedFare.toLocaleString()}`, size: 'sm', margin: 'md', color: '#666666' },
  ];

  if (payload.preferenceChips.length > 0) {
    const chips = payload.preferenceChips.slice(0, 5).join('、');
    bodyContents.push({
      type: 'text',
      text: `🏷️ 乘客偏好：${chips}`,
      size: 'xs',
      wrap: true,
      margin: 'md',
      color: '#888888',
    });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#D4860A',
          action: { type: 'uri', label: '查看詳情並接單', uri: ctaUri },
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `📦 新訂單派發 #${orderShort}`,
    contents: bubble,
  };
}

/**
 * 推需求單給所有 active driver（multicast，自動分批）。
 * fire-and-forget；失敗紀錄在 line_api_errors。
 */
export async function pushOrderDispatchToDrivers(
  payload: DispatchedOrderSummary,
  env: DispatchPushEnv,
  driverLineUserIds: string[],
): Promise<{ sent: number; failed: number; total: number }> {
  const targets = driverLineUserIds.filter((id) => !!id);
  if (targets.length === 0) return { sent: 0, failed: 0, total: 0 };
  const flex = buildDispatchFlex(payload, env);
  const result = await sendLineMulticast('driver', targets, [flex]);
  return { ...result, total: targets.length };
}

// ── 2. 配對成功通知乘客 ───────────────────────────────────────────────
const PASSENGER_ASSIGNED_TEXT: Record<Lang, { header: string; matchedHeader: string; pickupLabel: string; viewVehicle: string; altText: string }> = {
  zh_tw: { header: '🎉 配對成功',     matchedHeader: '您的訂單已配對司機', pickupLabel: '上車時間', viewVehicle: '查看車輛資訊', altText: '🎉 配對成功' },
  en:    { header: '🎉 Driver matched', matchedHeader: 'A driver has been matched to your order', pickupLabel: 'Pickup', viewVehicle: 'View vehicle profile', altText: '🎉 Driver matched' },
  ja:    { header: '🎉 マッチング成立', matchedHeader: 'ドライバーが決定しました', pickupLabel: '乗車時刻', viewVehicle: '車両情報を確認', altText: '🎉 マッチング成立' },
};

export function buildAssignedPassengerFlex(
  payload: AssignedPassengerPayload,
  env: DispatchPushEnv,
  lang: Lang,
): LineMessage {
  const t = PASSENGER_ASSIGNED_TEXT[lang] ?? PASSENGER_ASSIGNED_TEXT.zh_tw;
  const subPath = `/vehicles/${payload.driverId}`;
  const ctaUri = _buildLiffUrl(env.liffIdPassenger, subPath, subPath);
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: t.header, weight: 'bold', size: 'lg', color: '#50C878' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: t.matchedHeader, size: 'sm', wrap: true, margin: 'md' },
        { type: 'text', text: `🔖 #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'sm' },
        { type: 'text', text: `🚗 ${payload.driverDisplayName}`, size: 'md', wrap: true, margin: 'sm', weight: 'bold' },
        { type: 'text', text: `📅 ${t.pickupLabel}：${dateLine}`, size: 'sm', wrap: true, margin: 'sm', color: '#333333' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#D4860A',
          action: { type: 'uri', label: t.viewVehicle, uri: ctaUri },
        },
      ],
    },
  };

  return { type: 'flex', altText: t.altText, contents: bubble };
}

export async function pushOrderAssignedToPassenger(
  passengerLineUserId: string,
  payload: AssignedPassengerPayload,
  env: DispatchPushEnv,
  lang: Lang,
): Promise<void> {
  if (!passengerLineUserId) return;
  const flex = buildAssignedPassengerFlex(payload, env, lang);
  await sendLinePush('passenger', passengerLineUserId, [flex]);
}

// ── 3. 中選通知司機（繁中） ───────────────────────────────────────────────
export function buildAssignedDriverFlex(
  payload: AssignedDriverPayload,
  env: DispatchPushEnv,
): LineMessage {
  const subPath = '/driver/trip';
  const ctaUri = _buildLiffUrl(env.liffIdDriver, subPath, subPath);
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '✅ 您已中選', weight: 'bold', size: 'lg', color: '#50C878' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: `🔖 #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'md' },
        { type: 'text', text: `📅 ${dateLine}`, size: 'md', wrap: true, margin: 'sm', weight: 'bold' },
        { type: 'text', text: `📍 ${payload.pickupAddress}`, size: 'sm', wrap: true, margin: 'sm' },
        { type: 'text', text: `🏁 ${payload.dropoffAddress}`, size: 'sm', wrap: true, margin: 'xs' },
        { type: 'text', text: `👥 ${payload.passengerCount} 人`, size: 'sm', margin: 'sm', color: '#666666' },
        { type: 'text', text: '請於上車時間前準時抵達。', size: 'sm', wrap: true, margin: 'md', color: '#D4860A' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#D4860A',
          action: { type: 'uri', label: '查看任務', uri: ctaUri },
        },
      ],
    },
  };

  return { type: 'flex', altText: `✅ 您已中選 #${orderShort}`, contents: bubble };
}

export async function pushOrderAssignedToDriver(
  driverLineUserId: string,
  payload: AssignedDriverPayload,
  env: DispatchPushEnv,
): Promise<void> {
  if (!driverLineUserId) return;
  const flex = buildAssignedDriverFlex(payload, env);
  await sendLinePush('driver', driverLineUserId, [flex]);
}

// ── 4. 取消通知 active bidders（簡單 text；繁中）─────────────────────────
export async function pushOrderCancelledToBidders(
  bidderLineUserIds: string[],
  payload: { orderId: string },
): Promise<{ sent: number; failed: number; total: number }> {
  const targets = bidderLineUserIds.filter((id) => !!id);
  if (targets.length === 0) return { sent: 0, failed: 0, total: 0 };
  const orderShort = _orderIdShort(payload.orderId);
  const text = `⚠️ 訂單已取消\n訂單 #${orderShort} 已取消，您的喊單已自動撤回。`;
  const result = await sendLineMulticast('driver', targets, [{ type: 'text', text }]);
  return { ...result, total: targets.length };
}

/** 從 runtimeConfig 組 DispatchPushEnv（給 endpoint 用） */
export function getDispatchPushEnv(): DispatchPushEnv {
  const config = useRuntimeConfig();
  return {
    liffIdDriver: (config.public as { lineLiffIdDriver?: string }).lineLiffIdDriver ?? '',
    liffIdPassenger: (config.public as { lineLiffIdPassenger?: string }).lineLiffIdPassenger ?? '',
  };
}
