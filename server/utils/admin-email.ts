/**
 * Admin 通知的 email 收件人解析 — 純函式
 *
 * 為什麼 admin 通知要離開 LINE：一張訂單在乘客 OA 會產生 22 則推播，其中 18 則
 * （82%）是發給 3 位 admin 的內部通知 —— 每次訂單狀態變更都推 3 則，而 admin
 * 本來就有後台可看。LINE 每月額度按人頭計，這結構讓乘客 OA 一個月撐不到 10 張訂單。
 * 把 admin 通知移到 email（免費、無實質上限），乘客 OA 只留給客人的 4 則。
 *
 * 收件人來源有兩個，合併去重：
 *   1. `admins/{uid}.email` —— 逐位 admin 自己的信箱，帶各自語系（精確）
 *   2. 環境變數 NUXT_ADMIN_EMAIL_TO —— 逗號分隔清單（不需改 Firestore 就能加人）
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { Lang } from '@@/utils/user-lang';
import type { Permission } from '@@/utils/require-permission';
import { getAdminRecipients } from '@@/utils/admin-recipients';
import { sendEmail } from '@@/utils/email-send';

export interface EmailRecipient {
  email: string;
  lang: Lang;
}

export interface LangGroup {
  lang: Lang;
  emails: string[];
}

const DEFAULT_LANG: Lang = 'zh_tw';

/**
 * 基本 email 格式判定。刻意寬鬆（不追求 RFC 完整）：
 * 目的是擋掉「這不是信箱」這種明顯錯字，避免一個錯字讓整批寄送失敗。
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value.trim());
}

/**
 * 解析逗號 / 分號 / 換行分隔的 email 清單。
 * 環境變數是人手貼上的，很少乾淨 —— 容忍空白與混用分隔符，並去重（不分大小寫）。
 */
export function parseEmailList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n\r]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || !isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/**
 * 合併「admins doc 的 email」與「環境變數清單」。
 * 同一地址兩邊都有時保留 admins doc 的語系 —— 那份比環境變數精確。
 */
export function mergeRecipients(
  fromAdmins: ReadonlyArray<{ email: string; lang: Lang }>,
  fromEnv: ReadonlyArray<string>,
): EmailRecipient[] {
  const map = new Map<string, EmailRecipient>();
  for (const r of fromAdmins) {
    const email = (r.email ?? '').trim().toLowerCase();
    if (!email || !isValidEmail(email) || map.has(email)) continue;
    map.set(email, { email, lang: r.lang ?? DEFAULT_LANG });
  }
  for (const raw of fromEnv) {
    const email = raw.trim().toLowerCase();
    if (!email || !isValidEmail(email) || map.has(email)) continue;
    map.set(email, { email, lang: DEFAULT_LANG });
  }
  return [...map.values()];
}

/**
 * 依語系分組：一種語系寄一封，內文才會是收件人看得懂的語言。
 * 維持首次出現的語系順序，讓輸出可預期（測試與 log 都好讀）。
 */
export function groupByLang(recipients: ReadonlyArray<EmailRecipient>): LangGroup[] {
  const order: Lang[] = [];
  const map = new Map<Lang, string[]>();
  for (const r of recipients) {
    if (!map.has(r.lang)) {
      map.set(r.lang, []);
      order.push(r.lang);
    }
    map.get(r.lang)!.push(r.email);
  }
  return order.map((lang) => ({ lang, emails: map.get(lang)! }));
}

/**
 * 寄一封自訂內容的 admin 通知信（給不走 admin-notify-message 模板的呼叫端，
 * 例如司機證件 / 車輛 profile 待審核）。
 *
 * 與 notifyAdmins 的差別：那支吃模板 key + 多語系；這支吃現成字串（既有呼叫端
 * 本來就自己組好中文訊息）。收件人解析與去重邏輯共用。
 *
 * **永不 throw**。無收件人時 warn —— 通知靜默消失不可以沒有痕跡。
 */
export async function sendAdminEmail(
  db: Firestore,
  permission: Permission,
  subject: string,
  text: string,
): Promise<void> {
  try {
    const uids = await getAdminRecipients(db, permission);
    const fromAdmins = await Promise.all(uids.map(async (uid) => {
      try {
        const snap = await db.collection('admins').doc(uid).get();
        return { email: (snap.data() as { email?: string } | undefined)?.email ?? '', lang: DEFAULT_LANG };
      } catch {
        return { email: '', lang: DEFAULT_LANG };
      }
    }));
    const fromEnv = parseEmailList(
      (useRuntimeConfig() as { adminEmailTo?: string }).adminEmailTo || process.env.NUXT_ADMIN_EMAIL_TO,
    );
    const recipients = mergeRecipients(fromAdmins, fromEnv);
    if (recipients.length === 0) {
      console.warn(`[admin-email] 「${subject}」無 email 收件人 —— 請設 NUXT_ADMIN_EMAIL_TO 或補 admins/{uid}.email`);
      return;
    }
    await sendEmail(subject, text, recipients.map((r) => r.email));
  } catch (err) {
    console.error('[admin-email] 寄送失敗（silent）:', err);
  }
}
