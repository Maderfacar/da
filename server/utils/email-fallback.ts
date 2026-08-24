/**
 * LINE 推播失敗時的 email 備援 — 純函式部分
 *
 * 背景：2026-08-24 乘客 OA 打到每月推播上限（429），客人的訂單通知與 admin 告警
 * 一併發不出去，而失敗是靜默的。決定不做「全面改寄 email」而做「失敗才寄」——
 * 下個月額度重置後自動恢復走 LINE，不需要再改一次程式，也不會忘記切回來。
 *
 * ⚠️ 這封信的定位要分清楚：
 *   - 收件人是 admin 的訊息 → 這封信**等於**原訊息，功能等價
 *   - 收件人是客人 / 司機的訊息 → 這封信只是「未送達通知」。
 *     我們沒有客人的 email，寄給管理者不等於客人收到，仍需人工補。
 *   信件內文因此一律附上「原本要送給誰」與「原文全文」。
 */
import { formatTaipei } from '@@/utils/login-health';
import type { LineMessage } from '@@/utils/line-push';

/**
 * 每日寄信上限。額度用罄時**每一次推播都會失敗**，若不設上限，
 * 一天可能寄出數百封 —— 既洗版又會把 email 服務的免費額度也一起燒掉。
 * 超過上限後停寄（當日剩餘失敗仍寫入 line_api_errors，不會遺失）。
 */
export const EMAIL_DAILY_CAP = 40;

export interface EmailQuotaState {
  dayKey: string;
  count: number;
}

export interface EmailQuotaDecision {
  send: boolean;
  nextState: EmailQuotaState;
  /** 這是今天最後一封（下一封起將被擋）—— 供信件內文提醒 */
  isLastBeforeCap: boolean;
}

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 以台北時區的日期作為計數分界（與人看報表的直覺一致）。 */
export function dayKeyTaipei(now: number): string {
  const t = new Date(now + TAIPEI_OFFSET_MS);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/**
 * 判定今天還能不能再寄一封。
 * 狀態毀損一律當作 0（照寄）—— 與去重同一原則：不因狀態壞掉而靜音。
 */
export function decideEmailQuota(
  prev: EmailQuotaState | null | undefined,
  now: number,
  cap: number = EMAIL_DAILY_CAP,
): EmailQuotaDecision {
  const today = dayKeyTaipei(now);
  const sameDay = prev?.dayKey === today;
  const rawCount = sameDay ? prev?.count : 0;
  const count = typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 0;

  if (count >= cap) return { send: false, nextState: { dayKey: today, count }, isLastBeforeCap: false };
  const next = count + 1;
  return { send: true, nextState: { dayKey: today, count: next }, isLastBeforeCap: next >= cap };
}

export interface FallbackEmailInput {
  channel: 'passenger' | 'driver';
  targetUid: string;
  statusCode: number;
  errorDetails?: unknown;
  messages: ReadonlyArray<LineMessage>;
  at: number;
  /** 今天最後一封時附註提醒 */
  isLastBeforeCap?: boolean;
}

export interface FallbackEmail {
  subject: string;
  text: string;
}

/** flex 只取 altText —— 整包 contents 可能數 KB，塞進信裡沒有可讀性。 */
function messageToText(m: LineMessage): string {
  return m.type === 'flex' ? `[Flex] ${m.altText}` : m.text;
}

/** 組出備援信。內文必須能取代原訊息，因此附上原文全文。 */
export function buildFallbackEmail(input: FallbackEmailInput): FallbackEmail {
  const when = formatTaipei(input.at);
  const body = input.messages.map(messageToText).join('\n---\n');
  const details = typeof input.errorDetails === 'string'
    ? input.errorDetails
    : JSON.stringify(input.errorDetails ?? null);

  const lines = [
    `LINE 推播未送達（${input.channel} OA）`,
    '',
    `時間    ：${when}（台北）`,
    `原收件人：${input.targetUid}`,
    `錯誤    ：HTTP ${input.statusCode} ${details ?? ''}`.trim(),
    '',
    '── 原訊息全文 ──',
    body,
    '',
  ];

  if (input.statusCode === 429) {
    lines.push('※ 429 = 該 OA 當月推播額度已用罄。若原收件人是客人或司機，此信只是通知，對方並未收到，需人工補。');
  }
  if (input.isLastBeforeCap) {
    lines.push('※ 已達今日備援信上限，後續失敗將不再寄信（仍會寫入 line_api_errors）。');
  }

  return {
    subject: `[DA] LINE 推播未送達 ${input.statusCode} — ${input.channel}`,
    text: lines.join('\n'),
  };
}
