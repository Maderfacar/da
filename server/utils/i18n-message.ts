/**
 * 訂單事件三語訊息表（P37 Phase 4）
 *
 * 對應 design.md §2.3 / §7（Brain AI 拍板 5 個觸發點：pending / confirmed / en_route / completed / cancelled）。
 * arrived_pickup **不推**（spec §8.7）— 避免乘客在現場等候時多一條訊息干擾。
 *
 * 設計：
 *   - 訊息表只負責「文字內容」；推送邏輯在呼叫端（fire-and-forget）
 *   - pending 帶富欄位（date / pickup / vehicle / fare / orderId），保持原本 UX
 *   - cancelled 帶 cancelReason（可選）
 *   - lang fallback 'zh_tw'
 */
import type { Firestore } from 'firebase-admin/firestore';

export type OrderMessageKey =
  | 'order.pending'
  | 'order.confirmed'
  | 'order.en_route'
  | 'order.completed'
  | 'order.cancelled';

export type Lang = 'zh_tw' | 'en' | 'ja';

const VALID_LANGS: Lang[] = ['zh_tw', 'en', 'ja'];

export interface OrderMessageParams {
  date?: string;
  pickup?: string;
  vehicle?: string;
  fare?: string;
  orderId?: string;
  cancelReason?: string;
}

type Builder = (params?: OrderMessageParams) => string;

const _joinLines = (lines: Array<string | false | null | undefined>): string =>
  lines.filter((l): l is string => typeof l === 'string' && l.length > 0).join('\n');

// ── 訊息表 ─────────────────────────────────────────────────
const MESSAGES: Record<OrderMessageKey, Record<Lang, Builder>> = {
  'order.pending': {
    zh_tw: (p) => _joinLines([
      '📝 訂單已建立',
      '您的訂單已送出，正在媒合司機。',
      p?.date    && `📅 ${p.date}`,
      p?.pickup  && `📍 ${p.pickup}`,
      p?.vehicle && `🚗 ${p.vehicle}`,
      p?.fare    && `💰 NT$ ${p.fare}`,
      p?.orderId && `🔖 ${p.orderId}`,
    ]),
    en: (p) => _joinLines([
      '📝 Order placed',
      'Your order has been received. Matching a driver now.',
      p?.date    && `📅 Pickup: ${p.date}`,
      p?.pickup  && `📍 From: ${p.pickup}`,
      p?.vehicle && `🚗 Vehicle: ${p.vehicle}`,
      p?.fare    && `💰 Fare: NT$ ${p.fare}`,
      p?.orderId && `🔖 Order: ${p.orderId}`,
    ]),
    ja: (p) => _joinLines([
      '📝 ご注文を受け付けました',
      'ドライバーをマッチング中です。',
      p?.date    && `📅 乗車日時：${p.date}`,
      p?.pickup  && `📍 乗車場所：${p.pickup}`,
      p?.vehicle && `🚗 車種：${p.vehicle}`,
      p?.fare    && `💰 料金：NT$ ${p.fare}`,
      p?.orderId && `🔖 注文番号：${p.orderId}`,
    ]),
  },
  'order.confirmed': {
    zh_tw: () => '✅ 司機已接單\n司機已接受您的訂單，準備前往接您。',
    en:    () => '✅ Driver assigned\nYour driver has accepted the order and will be heading your way.',
    ja:    () => '✅ ドライバー確定\nドライバーが受注し、間もなく出発します。',
  },
  'order.en_route': {
    zh_tw: () => '🚗 司機已出發\n司機正在前往上車點，請至約定地點等候。',
    en:    () => '🚗 Driver en route\nYour driver is on the way to the pickup point.',
    ja:    () => '🚗 ドライバー出発\nピックアップ場所へ向かっています。',
  },
  'order.completed': {
    zh_tw: () => '🎉 行程已完成\n感謝您搭乘 Destination Anywhere！期待再次為您服務。',
    en:    () => '🎉 Trip completed\nThank you for choosing Destination Anywhere. See you next time!',
    ja:    () => '🎉 ご乗車ありがとうございました\nまたのご利用をお待ちしております。',
  },
  'order.cancelled': {
    zh_tw: (p) => _joinLines([
      '⚠️ 訂單已取消',
      p?.cancelReason && `原因：${p.cancelReason}`,
      '如需協助請聯絡客服。',
    ]),
    en: (p) => _joinLines([
      '⚠️ Order cancelled',
      p?.cancelReason && `Reason: ${p.cancelReason}`,
      'Please contact support if you need help.',
    ]),
    ja: (p) => _joinLines([
      '⚠️ ご注文がキャンセルされました',
      p?.cancelReason && `理由：${p.cancelReason}`,
      'サポートが必要な場合はお問い合わせください。',
    ]),
  },
};

/** 取出對應語系訊息（缺值 fallback zh_tw） */
export function getOrderMessage(
  key: OrderMessageKey,
  lang: Lang | string | undefined,
  params?: OrderMessageParams,
): string {
  const safeLang: Lang = (typeof lang === 'string' && (VALID_LANGS as string[]).includes(lang))
    ? (lang as Lang)
    : 'zh_tw';
  return MESSAGES[key][safeLang](params);
}

/**
 * 讀 users/{lineUid}.lang，回傳合法 Lang；缺值 / 無此 user / 非合法 lang 一律回 'zh_tw'。
 *
 * 用於訂單事件推送前撈乘客語系偏好（fire-and-forget；錯誤吞掉回 fallback）。
 */
export async function getUserLang(db: Firestore, lineUid: string): Promise<Lang> {
  if (!lineUid) return 'zh_tw';
  try {
    const snap = await db.collection('users').doc(lineUid).get();
    if (!snap.exists) return 'zh_tw';
    const lang = snap.data()?.lang as string | undefined;
    if (lang && (VALID_LANGS as string[]).includes(lang)) return lang as Lang;
    return 'zh_tw';
  } catch {
    return 'zh_tw';
  }
}
