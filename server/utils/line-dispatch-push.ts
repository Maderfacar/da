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
import type { Firestore } from 'firebase-admin/firestore';
import { sendLinePush, sendLineMulticast, type LineMessage } from '@@/utils/line-push';
import type { Lang } from '@@/utils/user-lang';
import { resolveTemplate, type TemplateContentFlex, type TemplateContentText } from '@@/utils/template-registry';
import { loadActiveDrivers } from '@@/utils/order-dispatch';
import type { DispatchLevel } from '~shared/types/dispatch-visibility';

export interface DispatchedOrderSummary {
  orderId: string;
  pickupDateTime: string;
  pickupAddress: string;
  dropoffAddress: string;
  passengerCount: number;
  /** Booking v2 批次 2：大人數（舊單呼叫端 fallback = passengerCount） */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數（舊單呼叫端 fallback = 0） */
  childCount?: number;
  estimatedFare: number;
  /** 偏好標籤中文 chip list（admin/driver 端皆繁中顯示） */
  preferenceChips: string[];
}

/**
 * Wave 2D：從 order doc 組 DispatchedOrderSummary。
 *
 * dispatch.post.ts / redispatch.post.ts 既有的 inline 組裝邏輯與這個函式同；
 * Wave 2D lazy check + manual downgrade 兩個新觸發點共用此 helper 避免漂移。
 */
export function buildDispatchedOrderSummary(
  orderId: string,
  data: Record<string, unknown>,
): DispatchedOrderSummary {
  const pickup = data.pickupLocation as { displayName?: string; address?: string } | undefined;
  const dropoff = data.dropoffLocation as { displayName?: string; address?: string } | undefined;
  const pref = data.preferences as { tagSnapshot?: Array<{ name?: { zh_tw?: string } }> } | undefined;
  const preferenceChips = Array.isArray(pref?.tagSnapshot)
    ? pref!.tagSnapshot!.map((t) => t?.name?.zh_tw ?? '').filter(Boolean)
    : [];
  const passengerCount = (data.passengerCount as number | undefined) ?? 1;
  return {
    orderId,
    pickupDateTime: (data.pickupDateTime as string) ?? '',
    pickupAddress: pickup?.displayName || pickup?.address || '',
    dropoffAddress: dropoff?.displayName || dropoff?.address || '',
    passengerCount,
    adultCount: (data.adultCount as number | undefined) ?? passengerCount,
    childCount: (data.childCount as number | undefined) ?? 0,
    estimatedFare: (data.estimatedFare as number | undefined) ?? 0,
    preferenceChips,
  };
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
  /** Booking v2 批次 2：大人數（舊單呼叫端 fallback = passengerCount） */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數（舊單呼叫端 fallback = 0） */
  childCount?: number;
}

export interface DispatchPushEnv {
  /** 司機 LIFF App ID（用於組需求單推播 CTA / 中選通知 CTA） */
  liffIdDriver: string;
  /** 乘客 LIFF App ID（用於組配對成功推播 CTA） */
  liffIdPassenger: string;
}

/**
 * F1 訂單派發 Flex 的可編輯外殼（W3 — line-template-expansion）
 *
 * Builder 接收後若欄位非空字串則覆蓋對應 hardcoded 文字；空字串 / undefined 則
 * 維持既有 hardcoded（繁中）。內部 list 渲染（人數摘要 / 車資 formatter）+ 按鈕
 * action（postback data / URI）一律鎖死。
 *
 * W3 caller 不傳此參數；W4 caller 從 `loadTemplate('dispatch.driver-pending')`
 * 取出 title 等欄位後傳入。
 */
export interface DispatchCustomLabels {
  title?: string;
  subtitle?: string;
  orderIdLabel?: string;
  dateLabel?: string;
  pickupLabel?: string;
  dropoffLabel?: string;
  paxLabel?: string;
  fareLabel?: string;
  ctaLabel?: string;
}

/**
 * F4 中選通知司機 Flex 的可編輯外殼（W4 — line-template-expansion）
 *
 * 與 DispatchCustomLabels 相同設計：override 字串非空才覆蓋；內部任務 URI
 * (`/driver/trip`)、人數摘要 formatter、orderShort / dateLine formatter 一律鎖死。
 */
export interface AssignedDriverCustomLabels {
  title?: string;
  orderIdLabel?: string;
  dateLabel?: string;
  pickupLabel?: string;
  dropoffLabel?: string;
  paxLabel?: string;
  noticeText?: string;
  ctaLabel?: string;
}

/**
 * F3 配對成功通知乘客 Flex 的可編輯外殼（W4 — line-template-expansion）
 *
 * 與 SoftMatchCustomLabels 相同設計：override 字串非空才覆蓋；內部車輛資訊 +
 * CTA URI (`/vehicles/{driverId}`) 一律鎖死。lang fallback 仍由 PASSENGER_ASSIGNED_TEXT
 * 處理（i18n 預設）。
 */
export interface AssignedPassengerCustomLabels {
  title?: string;
  matchedHeader?: string;
  pickupLabel?: string;
  ctaLabel?: string;
}

const _orderIdShort = (id: string): string => id.slice(0, 8).toUpperCase();

/**
 * Booking v2 批次 2：人數摘要文字（含兒童才顯示「大人 X / 兒童 Y」，否則退回「N 人」）
 */
const _formatPaxSummary = (payload: { passengerCount: number; adultCount?: number; childCount?: number }): string => {
  const child = payload.childCount ?? 0;
  if (child > 0) {
    const adult = payload.adultCount ?? Math.max(1, payload.passengerCount - child);
    return `大人 ${adult} / 兒童 ${child}`;
  }
  return `${payload.passengerCount} 人`;
};

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
const _pickLabel = (override: string | undefined, fallback: string): string => {
  return typeof override === 'string' && override.length > 0 ? override : fallback;
};

export function buildDispatchFlex(
  payload: DispatchedOrderSummary,
  env: DispatchPushEnv,
  customLabels?: DispatchCustomLabels,
): LineMessage {
  const subPath = `/driver/dispatched/${payload.orderId}`;
  const ctaUri = _buildLiffUrl(env.liffIdDriver, subPath, subPath);
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const title = _pickLabel(customLabels?.title, '📦 新訂單派發');
  const subtitle = _pickLabel(customLabels?.subtitle, '');
  const orderIdLabel = _pickLabel(customLabels?.orderIdLabel, '🔖');
  const dateLabel = _pickLabel(customLabels?.dateLabel, '📅');
  const pickupLabel = _pickLabel(customLabels?.pickupLabel, '📍');
  const dropoffLabel = _pickLabel(customLabels?.dropoffLabel, '🏁');
  const paxLabel = _pickLabel(customLabels?.paxLabel, '👥');
  const fareLabel = _pickLabel(customLabels?.fareLabel, '💰 NT$');
  const ctaLabel = _pickLabel(customLabels?.ctaLabel, '查看詳情並接單');

  const bodyContents: Array<Record<string, unknown>> = [
    { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#D4860A' },
  ];
  if (subtitle) {
    bodyContents.push({ type: 'text', text: subtitle, size: 'sm', wrap: true, color: '#666666', margin: 'sm' });
  }
  bodyContents.push(
    { type: 'separator', margin: 'md' },
    { type: 'text', text: `${orderIdLabel} #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'md' },
    { type: 'text', text: `${dateLabel} ${dateLine}`, size: 'md', wrap: true, margin: 'sm' },
    { type: 'text', text: `${pickupLabel} ${payload.pickupAddress}`, size: 'sm', wrap: true, margin: 'sm', color: '#333333' },
    { type: 'text', text: `${dropoffLabel} ${payload.dropoffAddress}`, size: 'sm', wrap: true, margin: 'xs', color: '#333333' },
    { type: 'text', text: `${paxLabel} ${_formatPaxSummary(payload)}  ${fareLabel} ${payload.estimatedFare.toLocaleString()}`, size: 'sm', margin: 'md', color: '#666666' },
  );

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
          action: { type: 'uri', label: ctaLabel, uri: ctaUri },
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `${title} #${orderShort}`,
    contents: bubble,
  };
}

/**
 * Template → DispatchCustomLabels：只把 title / ctaButton.label 等可由 TemplateContentFlex
 * 直接表達的欄位傳給 builder；其他 label（orderId/date/pickup/...）目前仍由 builder 維持
 * 既有 hardcoded（Phase 2 條件區塊編輯器才會擴出可編 sub-label）。
 */
const _dispatchLabelsFromTemplate = (tpl: TemplateContentFlex): DispatchCustomLabels => ({
  title: tpl.title,
  ctaLabel: tpl.ctaButton?.label,
});

/**
 * 推需求單給所有 active driver（multicast，自動分批）。
 * fire-and-forget；失敗紀錄在 line_api_errors。
 *
 * W4：caller 必須帶 db，內部 resolveTemplate('dispatch.driver-pending') 取 admin 編輯版
 * （缺值退 registry default）後組 customLabels 餵 buildDispatchFlex。
 */
export async function pushOrderDispatchToDrivers(
  db: Firestore,
  payload: DispatchedOrderSummary,
  env: DispatchPushEnv,
  driverLineUserIds: string[],
): Promise<{ sent: number; failed: number; total: number }> {
  const targets = driverLineUserIds.filter((id) => !!id);
  if (targets.length === 0) return { sent: 0, failed: 0, total: 0 };
  const tpl = (await resolveTemplate(db, 'dispatch.driver-pending')) as TemplateContentFlex;
  const flex = buildDispatchFlex(payload, env, _dispatchLabelsFromTemplate(tpl));
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
  customLabels?: AssignedPassengerCustomLabels,
): LineMessage {
  const t = PASSENGER_ASSIGNED_TEXT[lang] ?? PASSENGER_ASSIGNED_TEXT.zh_tw;
  const subPath = `/vehicles/${payload.driverId}`;
  const ctaUri = _buildLiffUrl(env.liffIdPassenger, subPath, subPath);
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const title = _pickLabel(customLabels?.title, t.header);
  const matchedHeader = _pickLabel(customLabels?.matchedHeader, t.matchedHeader);
  const pickupLabel = _pickLabel(customLabels?.pickupLabel, t.pickupLabel);
  const ctaLabel = _pickLabel(customLabels?.ctaLabel, t.viewVehicle);

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#50C878' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: matchedHeader, size: 'sm', wrap: true, margin: 'md' },
        { type: 'text', text: `🔖 #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'sm' },
        { type: 'text', text: `🚗 ${payload.driverDisplayName}`, size: 'md', wrap: true, margin: 'sm', weight: 'bold' },
        { type: 'text', text: `📅 ${pickupLabel}：${dateLine}`, size: 'sm', wrap: true, margin: 'sm', color: '#333333' },
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
          action: { type: 'uri', label: ctaLabel, uri: ctaUri },
        },
      ],
    },
  };

  return { type: 'flex', altText: title, contents: bubble };
}

/**
 * Template → AssignedPassengerCustomLabels：只取 title / ctaButton.label（同 F1 設計）。
 */
const _assignedPassengerLabelsFromTemplate = (tpl: TemplateContentFlex): AssignedPassengerCustomLabels => ({
  title: tpl.title,
  ctaLabel: tpl.ctaButton?.label,
});

/**
 * W4：caller 必須帶 db + lang，內部 resolveTemplate('dispatch.passenger-matched', lang)
 * 取多語 admin 編輯版（缺值退 registry default 繁中）後組 customLabels。
 */
export async function pushOrderAssignedToPassenger(
  db: Firestore,
  passengerLineUserId: string,
  payload: AssignedPassengerPayload,
  env: DispatchPushEnv,
  lang: Lang,
): Promise<void> {
  if (!passengerLineUserId) return;
  const tpl = (await resolveTemplate(db, 'dispatch.passenger-matched', lang)) as TemplateContentFlex;
  const flex = buildAssignedPassengerFlex(payload, env, lang, _assignedPassengerLabelsFromTemplate(tpl));
  await sendLinePush('passenger', passengerLineUserId, [flex]);
}

// ── 3. 中選通知司機（繁中） ───────────────────────────────────────────────
export function buildAssignedDriverFlex(
  payload: AssignedDriverPayload,
  env: DispatchPushEnv,
  customLabels?: AssignedDriverCustomLabels,
): LineMessage {
  const subPath = '/driver/trip';
  const ctaUri = _buildLiffUrl(env.liffIdDriver, subPath, subPath);
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const title = _pickLabel(customLabels?.title, '✅ 您已中選');
  const orderIdLabel = _pickLabel(customLabels?.orderIdLabel, '🔖');
  const dateLabel = _pickLabel(customLabels?.dateLabel, '📅');
  const pickupLabel = _pickLabel(customLabels?.pickupLabel, '📍');
  const dropoffLabel = _pickLabel(customLabels?.dropoffLabel, '🏁');
  const paxLabel = _pickLabel(customLabels?.paxLabel, '👥');
  const noticeText = _pickLabel(customLabels?.noticeText, '請於上車時間前準時抵達。');
  const ctaLabel = _pickLabel(customLabels?.ctaLabel, '查看任務');

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#50C878' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: `${orderIdLabel} #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'md' },
        { type: 'text', text: `${dateLabel} ${dateLine}`, size: 'md', wrap: true, margin: 'sm', weight: 'bold' },
        { type: 'text', text: `${pickupLabel} ${payload.pickupAddress}`, size: 'sm', wrap: true, margin: 'sm' },
        { type: 'text', text: `${dropoffLabel} ${payload.dropoffAddress}`, size: 'sm', wrap: true, margin: 'xs' },
        { type: 'text', text: `${paxLabel} ${_formatPaxSummary(payload)}`, size: 'sm', margin: 'sm', color: '#666666' },
        { type: 'text', text: noticeText, size: 'sm', wrap: true, margin: 'md', color: '#D4860A' },
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
          action: { type: 'uri', label: ctaLabel, uri: ctaUri },
        },
      ],
    },
  };

  return { type: 'flex', altText: `${title} #${orderShort}`, contents: bubble };
}

/**
 * Template → AssignedDriverCustomLabels：只取 title / ctaButton.label（同 F1 設計）。
 */
const _assignedDriverLabelsFromTemplate = (tpl: TemplateContentFlex): AssignedDriverCustomLabels => ({
  title: tpl.title,
  ctaLabel: tpl.ctaButton?.label,
});

/**
 * W4：caller 必須帶 db，內部 resolveTemplate('dispatch.driver-selected') 取 admin 編輯版
 * （single 繁中）後組 customLabels 餵 buildAssignedDriverFlex。
 */
export async function pushOrderAssignedToDriver(
  db: Firestore,
  driverLineUserId: string,
  payload: AssignedDriverPayload,
  env: DispatchPushEnv,
): Promise<void> {
  if (!driverLineUserId) return;
  const tpl = (await resolveTemplate(db, 'dispatch.driver-selected')) as TemplateContentFlex;
  const flex = buildAssignedDriverFlex(payload, env, _assignedDriverLabelsFromTemplate(tpl));
  await sendLinePush('driver', driverLineUserId, [flex]);
}

// ── 4. 取消通知 active bidders（純文字 multicast；繁中）─────────────────────
/**
 * W4：caller 必須帶 db，內部 resolveTemplate('driver.order-cancelled-bidders') 取 admin 編輯版
 * （Text 模板，placeholder {orderId}），失敗退 registry default 後 multicast。
 */
export async function pushOrderCancelledToBidders(
  db: Firestore,
  bidderLineUserIds: string[],
  payload: { orderId: string },
): Promise<{ sent: number; failed: number; total: number }> {
  const targets = bidderLineUserIds.filter((id) => !!id);
  if (targets.length === 0) return { sent: 0, failed: 0, total: 0 };
  const orderShort = _orderIdShort(payload.orderId);
  const tpl = (await resolveTemplate(db, 'driver.order-cancelled-bidders')) as TemplateContentText;
  const text = tpl.body.replace(/\{orderId\}/g, orderShort);
  const result = await sendLineMulticast('driver', targets, [{ type: 'text', text }]);
  return { ...result, total: targets.length };
}

/**
 * Wave 2B+2C：分級派單 multicast helper。
 *
 * 載入 driverCategory >= level 的 approved driver → resolveTemplate('dispatch.driver-pending')
 * → 渲染 + multicast。封裝給 dispatch.post.ts / redispatch.post.ts 用。
 *
 * 注意：currentLevel='0' 等價於不過濾，會推給全 approved driver（含 NOVICE）。
 */
export async function multicastByLevel(
  db: Firestore,
  payload: DispatchedOrderSummary,
  env: DispatchPushEnv,
  minCategory: DispatchLevel,
): Promise<{ sent: number; failed: number; total: number }> {
  const drivers = await loadActiveDrivers(db, { minCategory });
  const lineUserIds = drivers.map((d) => d.lineUserId).filter(Boolean);
  return await pushOrderDispatchToDrivers(db, payload, env, lineUserIds);
}

/**
 * Wave 2D：分級派單「降級」multicast helper。
 *
 * 用 `dispatch.level-down` template（與首發的 `dispatch.driver-pending` 區分），
 * 推給 driverCategory >= newLevel 的 approved driver。
 *
 * 觸發時機：
 *  1. driver GET /dispatched-orders 時 lazy check 偵測超時 → 自動降級
 *  2. admin 在 /admin/orders 點「⬇️ 立即降級」/「🔓 全開放」
 *
 * 注意：所有原本已看得到的高等級 driver 也會收到（multicast by min 不排除高等級）；
 * Brain AI 拍板可接受小幅噪音換實作簡單。
 */
export async function multicastLevelDown(
  db: Firestore,
  payload: DispatchedOrderSummary,
  env: DispatchPushEnv,
  newLevel: DispatchLevel,
): Promise<{ sent: number; failed: number; total: number }> {
  const drivers = await loadActiveDrivers(db, { minCategory: newLevel });
  const lineUserIds = drivers.map((d) => d.lineUserId).filter(Boolean);
  if (lineUserIds.length === 0) return { sent: 0, failed: 0, total: 0 };
  const tpl = (await resolveTemplate(db, 'dispatch.level-down')) as TemplateContentFlex;
  const flex = buildDispatchFlex(payload, env, _dispatchLabelsFromTemplate(tpl));
  const result = await sendLineMulticast('driver', lineUserIds, [flex]);
  return { ...result, total: lineUserIds.length };
}

/** 從 runtimeConfig 組 DispatchPushEnv（給 endpoint 用） */
export function getDispatchPushEnv(): DispatchPushEnv {
  const config = useRuntimeConfig();
  return {
    liffIdDriver: (config.public as { lineLiffIdDriver?: string }).lineLiffIdDriver ?? '',
    liffIdPassenger: (config.public as { lineLiffIdPassenger?: string }).lineLiffIdPassenger ?? '',
  };
}
