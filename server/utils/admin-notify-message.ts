/**
 * 管理員自動通知 — 三語訊息表（admin-auto-notify-dashboard 變更）
 *
 * 對齊既有 i18n-message.ts 的設計：
 *   - 訊息表只負責「文字內容」；推送在 notify-admins.ts（fire-and-forget）
 *   - admin 通知是內部維運訊息，不走 notification-templates 模板編輯器，文案 hard-code
 *   - lang fallback 'zh_tw'
 *
 * D3 拍板：依各 admin 自身 lang 推對應語系文字，取不到 → zh_tw。
 */
import type { Lang } from '@@/utils/user-lang';

export type AdminNotifyKey =
  | 'adminNotify.orderCreated'
  | 'adminNotify.orderStatusChanged'
  | 'adminNotify.driverApplied';

const VALID_LANGS: Lang[] = ['zh_tw', 'en', 'ja'];

export interface AdminNotifyParams {
  orderId?: string;
  date?: string;
  pickup?: string;
  fromStatus?: string;
  toStatus?: string;
  driverName?: string;
  vehicleType?: string;
}

// ── 訂單狀態三語名稱（orders/[orderId].patch.ts 的 7 個狀態）─────────
const ORDER_STATUS_NAMES: Record<string, Record<Lang, string>> = {
  pending:        { zh_tw: '待處理',   en: 'Pending',        ja: '保留中' },
  confirmed:      { zh_tw: '已接單',   en: 'Confirmed',      ja: '受注済み' },
  en_route:       { zh_tw: '司機出發', en: 'En route',       ja: '出発済み' },
  arrived_pickup: { zh_tw: '已到上車點', en: 'Arrived',      ja: '到着済み' },
  in_transit:     { zh_tw: '行程中',   en: 'In transit',     ja: '運行中' },
  completed:      { zh_tw: '已完成',   en: 'Completed',      ja: '完了' },
  cancelled:      { zh_tw: '已取消',   en: 'Cancelled',      ja: 'キャンセル' },
};

/** 訂單狀態 → 指定語系名稱；未知狀態回原字串 */
export function getOrderStatusName(status: string | undefined, lang: Lang): string {
  if (!status) return '';
  return ORDER_STATUS_NAMES[status]?.[lang] ?? status;
}

// 使用者輸入（上車地址 / 司機姓名）嵌入 LINE 文字前先淨化：
// 移除 ASCII 控制字元（< 0x20、0x7F）與零寬字元（0x200B-0x200D、0xFEFF），
// 避免特製字串污染 admin 收到的通知，並截斷長度。
const _SANITIZE_MAX = 100;
function sanitizeText(raw: string | undefined): string {
  if (!raw) return '';
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f;
    const isZeroWidth = (code >= 0x200b && code <= 0x200d) || code === 0xfeff;
    if (!isControl && !isZeroWidth) out += ch;
  }
  return out.trim().slice(0, _SANITIZE_MAX);
}

type Builder = (p: AdminNotifyParams, lang: Lang) => string;

const MESSAGES: Record<AdminNotifyKey, Record<Lang, Builder>> = {
  'adminNotify.orderCreated': {
    zh_tw: (p) => `🆕 新訂單 ${p.orderId}｜${p.date}｜${p.pickup}`,
    en:    (p) => `🆕 New order ${p.orderId} | ${p.date} | ${p.pickup}`,
    ja:    (p) => `🆕 新規予約 ${p.orderId}｜${p.date}｜${p.pickup}`,
  },
  'adminNotify.orderStatusChanged': {
    zh_tw: (p, l) => `🔄 訂單 ${p.orderId} 狀態：${getOrderStatusName(p.fromStatus, l)} → ${getOrderStatusName(p.toStatus, l)}`,
    en:    (p, l) => `🔄 Order ${p.orderId} status: ${getOrderStatusName(p.fromStatus, l)} → ${getOrderStatusName(p.toStatus, l)}`,
    ja:    (p, l) => `🔄 予約 ${p.orderId} ステータス：${getOrderStatusName(p.fromStatus, l)} → ${getOrderStatusName(p.toStatus, l)}`,
  },
  'adminNotify.driverApplied': {
    zh_tw: (p) => `🧑‍✈️ 司機申請待審：${p.driverName}｜${p.vehicleType}`,
    en:    (p) => `🧑‍✈️ Driver application pending: ${p.driverName} | ${p.vehicleType}`,
    ja:    (p) => `🧑‍✈️ ドライバー申請（審査待ち）：${p.driverName}｜${p.vehicleType}`,
  },
};

/**
 * 取對應語系的 admin 通知文字（lang 非法 / 缺值 fallback zh_tw）。
 * pickup / driverName 為使用者輸入，組字前先 sanitizeText 淨化。
 */
export function getAdminNotifyText(
  key: AdminNotifyKey,
  lang: Lang | string | undefined,
  params: AdminNotifyParams,
): string {
  const safeLang: Lang = (typeof lang === 'string' && (VALID_LANGS as string[]).includes(lang))
    ? (lang as Lang)
    : 'zh_tw';
  const safeParams: AdminNotifyParams = {
    ...params,
    pickup: sanitizeText(params.pickup),
    driverName: sanitizeText(params.driverName),
  };
  return MESSAGES[key][safeLang](safeParams, safeLang);
}
