/**
 * Phase 1F：Soft Match / 重新配對 LINE push helpers
 *
 * 設計（拍版）：
 *   - hard-coded Flex template（不進 notification_templates；Phase 2 可改）
 *   - passenger 推 passenger OA；driver 推 driver OA（沿用 1E getDispatchPushEnv）
 *   - 三語：passenger（zh_tw / en / ja）；driver deselect 通知繁中即可（拍版 #16 沿用）
 *   - postback data 格式：`passenger.softMatch.<decision>?orderId=<orderId>`
 *
 * 3 個 push helper（W4 後 caller 統一帶 db）：
 *   1. pushSoftMatchToPassenger(db, lineUid, payload, env, lang)  — F5 軟配 hybrid Flex
 *   2. pushPassengerRematch(db, lineUid, payload, lang)           — F6 重新配對通知（純 Flex via buildTemplate）
 *   3. pushDriverDeselected(db, lineUid, payload)                 — T6 原中選 driver 文字通知
 */
import type { Firestore } from 'firebase-admin/firestore';
import { sendLinePush, type LineMessage } from '@@/utils/line-push';
import type { Lang } from '@@/utils/user-lang';
import type { DispatchPushEnv } from '@@/utils/line-dispatch-push';
import {
  buildTemplate,
  resolveTemplate,
  type TemplateContentFlex,
  type TemplateContentText,
} from '@@/utils/template-registry';

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

// REMATCH_TEXT 已隨 buildPassengerRematchFlex 拔除（W4）；多語 fallback 由
// resolveTemplate('softmatch.passenger-rematching', lang) 內部負責。

/**
 * F5 軟配 Flex 的可編輯外殼（W3 — line-template-expansion）
 *
 * Builder 接收後若欄位非空字串則覆蓋對應 i18n 文字；空字串 / undefined 則維持
 * 既有 `SOFT_MATCH_TEXT[lang]` 預設。✓/✗ list 渲染與 postback action data
 * （passenger.softMatch.accept/wait/cancel）一律鎖死。
 *
 * W3 caller 不傳此參數；W4 caller 從 `loadTemplate('softmatch.passenger-choose', lang)`
 * 取出 title 等欄位後傳入。
 */
export interface SoftMatchCustomLabels {
  title?: string;
  subtitle?: string;
  matchedHeader?: string;
  unmatchedHeader?: string;
  btnAcceptLabel?: string;
  btnWaitLabel?: string;
  btnCancelLabel?: string;
}

const _pickLabel = (override: string | undefined, fallback: string): string => {
  return typeof override === 'string' && override.length > 0 ? override : fallback;
};

// ── 1. Soft Match 3-button Flex（passenger）────────────────────────────────
export function buildSoftMatchPassengerFlex(
  payload: SoftMatchPassengerPayload,
  env: DispatchPushEnv,
  lang: Lang,
  customLabels?: SoftMatchCustomLabels,
): LineMessage {
  const t = SOFT_MATCH_TEXT[lang] ?? SOFT_MATCH_TEXT.zh_tw;
  const orderShort = _orderIdShort(payload.orderId);
  const dateLine = _formatDateTime(payload.pickupDateTime);

  const title = _pickLabel(customLabels?.title, t.title);
  const subtitle = _pickLabel(customLabels?.subtitle, t.subtitle(payload.matchCount, payload.preferenceCount));
  const matchedHeader = _pickLabel(customLabels?.matchedHeader, t.matchedHeader);
  const unmatchedHeader = _pickLabel(customLabels?.unmatchedHeader, t.unmatchedHeader);
  const btnAccept = _pickLabel(customLabels?.btnAcceptLabel, t.btnAccept);
  const btnWait = _pickLabel(customLabels?.btnWaitLabel, t.btnWait);
  const btnCancel = _pickLabel(customLabels?.btnCancelLabel, t.btnCancel);

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
        { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#D4860A' },
        { type: 'text', text: subtitle, size: 'sm', color: '#666666', wrap: true, margin: 'sm' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: `🔖 #${orderShort}`, size: 'sm', color: '#6B6560', margin: 'md' },
        { type: 'text', text: `🚗 ${t.driverLabel}：${payload.driverDisplayName}`, size: 'md', weight: 'bold', wrap: true, margin: 'sm' },
        { type: 'text', text: `📅 ${t.pickupLabel}：${dateLine}`, size: 'sm', margin: 'xs', color: '#333333' },
        { type: 'text', text: `✓ ${t.completedLabel(payload.completedOrders)}`, size: 'xs', color: '#666666', margin: 'xs' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: matchedHeader, size: 'sm', color: '#50C878', weight: 'bold', margin: 'md' },
        { type: 'text', text: matchedLine, size: 'xs', color: '#333333', wrap: true, margin: 'xs' },
        { type: 'text', text: unmatchedHeader, size: 'sm', color: '#D14343', weight: 'bold', margin: 'md' },
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
          action: { type: 'postback', label: btnAccept, data: `passenger.softMatch.accept?orderId=${payload.orderId}`, displayText: btnAccept },
        },
        {
          type: 'button',
          style: 'primary',
          color: '#D4860A',
          action: { type: 'postback', label: btnWait, data: `passenger.softMatch.wait?orderId=${payload.orderId}`, displayText: btnWait },
        },
        {
          type: 'button',
          style: 'secondary',
          action: { type: 'postback', label: btnCancel, data: `passenger.softMatch.cancel?orderId=${payload.orderId}`, displayText: btnCancel },
        },
      ],
    },
  };

  return { type: 'flex', altText: t.altText, contents: bubble };
}

/**
 * Template → SoftMatchCustomLabels：F5 hybrid 模板對映。
 *
 * title 可由 TemplateContentFlex.title 直接表達；其他 header/btn label 目前仍由
 * SOFT_MATCH_TEXT[lang] 維持既有 i18n（Phase 2 條件區塊編輯器才會擴出個別 label）。
 */
const _softMatchLabelsFromTemplate = (tpl: TemplateContentFlex): SoftMatchCustomLabels => ({
  title: tpl.title,
});

/**
 * W4：caller 必須帶 db + lang，內部 resolveTemplate('softmatch.passenger-choose', lang)
 * 取多語 admin 編輯版（缺值退 registry default 繁中）後組 customLabels。
 */
export async function pushSoftMatchToPassenger(
  db: Firestore,
  passengerLineUid: string,
  payload: SoftMatchPassengerPayload,
  env: DispatchPushEnv,
  lang: Lang,
): Promise<void> {
  if (!passengerLineUid) return;
  const tpl = (await resolveTemplate(db, 'softmatch.passenger-choose', lang)) as TemplateContentFlex;
  const flex = buildSoftMatchPassengerFlex(payload, env, lang, _softMatchLabelsFromTemplate(tpl));
  await sendLinePush('passenger', passengerLineUid, [flex]);
}

// ── 2. 重新配對通知（passenger）─────────────────────────────────────────
/**
 * W4：buildPassengerRematchFlex 已拔除，改走 template-registry buildTemplate dispatcher。
 *
 * `softmatch.passenger-rematching` 為 pure Flex（無 CTA / 動態 list）；template.title +
 * placeholder 替換 body（{orderId}、{date}）後由 buildTemplateFlex 渲染。caller 必須帶 db。
 *
 * REMATCH_TEXT 多語表已隨之拔除（同 i18n-message.ts 拔除策略）；多語 fallback 由
 * resolveTemplate(..., lang) 內部負責（找不到 lang 退 zh_tw）。
 */
export async function pushPassengerRematch(
  db: Firestore,
  passengerLineUid: string,
  payload: PassengerRematchPayload,
  lang: Lang,
): Promise<void> {
  if (!passengerLineUid) return;
  const tpl = await resolveTemplate(db, 'softmatch.passenger-rematching', lang);
  const params: Record<string, string> = {
    orderId: _orderIdShort(payload.orderId),
    date: _formatDateTime(payload.pickupDateTime),
  };
  const msg = buildTemplate(tpl, params, 'flex');
  if (msg) await sendLinePush('passenger', passengerLineUid, [msg]);
}

// ── 3. 原中選 driver 收 deselect 通知（純文字模板；T6）──────────────────────
/**
 * W4：改走 driver.softmatch-rejected 純文字模板；caller 必須帶 db。
 * Builder 已轉到 template-registry buildTemplateText 走 placeholder 替換。
 */
export async function pushDriverDeselected(
  db: Firestore,
  driverLineUserId: string,
  payload: DriverDeselectedPayload,
): Promise<void> {
  if (!driverLineUserId) return;
  const tpl = (await resolveTemplate(db, 'driver.softmatch-rejected')) as TemplateContentText;
  const params: Record<string, string> = {
    orderId: _orderIdShort(payload.orderId),
  };
  // 模板 placeholder 不含 dateLine；保留 PassengerRematchPayload-like 介面以利 caller 不變
  void payload.pickupDateTime;
  const msg = buildTemplate(tpl, params, 'text');
  if (msg) await sendLinePush('driver', driverLineUserId, [msg]);
}
