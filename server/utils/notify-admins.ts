/**
 * 管理員自動通知 — **改走 email**（2026-08-25）
 *
 * 原本以 passenger OA 逐一 LINE 推播。實測一張訂單在乘客 OA 產生 22 則推播，
 * 其中 18 則（82%）是這裡發給 3 位 admin 的內部通知 —— 每次訂單狀態變更都推 3 則。
 * LINE 每月額度按人頭計，2026-08-24 因此被打爆，連客人的訂單通知一起發不出去。
 * admin 本來就有後台可看，這些通知移到 email（免費、無實質上限），
 * 把 LINE 額度整份留給客人與司機。
 *
 * **呼叫端介面刻意不變** —— 4 個 call site 一行都不用動。
 *
 * 整體 fire-and-forget：呼叫端用 void 包起來，不阻塞主流程；任一步失敗都不 rethrow。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { sendEmail } from '@@/utils/email-send';
import { getAdminRecipients, getSuperAdminRecipients } from '@@/utils/admin-recipients';
import {
  parseEmailList,
  mergeRecipients,
  groupByLang,
} from '@@/utils/admin-email';
import { getAdminNotifyText, type AdminNotifyKey, type AdminNotifyParams } from '@@/utils/admin-notify-message';
import type { Lang } from '@@/utils/user-lang';

const VALID_LANGS = ['zh_tw', 'en', 'ja'];

/**
 * 一次通知的結果。
 *
 * **為什麼要有回傳值**：呼叫端（告警去重）必須能分辨「發出去了」與「決定要發但沒發成」。
 * 這支原本回 void 並吞掉所有失敗，於是 alert-auth-health 只能憑「決定要發」就寫入去重狀態
 * —— email 管道未設定時，一批告警會被記成「已通知」而抑制 24 小時，收訊者從頭到尾沒看到，
 * 管道修好後也不會補發。
 *
 * 仍然**永不 throw**：業務呼叫端（訂單、司機申請）照舊可以忽略回傳值。
 */
export interface AdminNotifyResult {
  delivered: boolean;
  /** 未送達原因：無收件人 / 未設 API key / 寄送失敗 */
  reason?: 'no-recipients' | 'no-key' | 'error';
}

export interface NotifyAdminsOptions {
  /**
   * 收件對象。預設具 canManageOrders 的 admin（業務通知）。
   * 'super' 僅送 level=super —— 系統告警專用。
   */
  audience?: 'canManageOrders' | 'super';
}

/** 讀出目標 admin 的 email 與語系（email 欄位缺失者自動略過）。 */
async function loadAdminEmails(
  db: Firestore,
  audience: NotifyAdminsOptions['audience'],
): Promise<{ email: string; lang: Lang }[]> {
  const uids = audience === 'super'
    ? await getSuperAdminRecipients(db)
    : await getAdminRecipients(db, 'canManageOrders');
  const rows = await Promise.all(uids.map(async (uid) => {
    try {
      const snap = await db.collection('admins').doc(uid).get();
      const data = snap.data() as { email?: string; lang?: string } | undefined;
      const rawLang = data?.lang;
      const lang: Lang = typeof rawLang === 'string' && VALID_LANGS.includes(rawLang) ? (rawLang as Lang) : 'zh_tw';
      return { email: data?.email ?? '', lang };
    } catch {
      return { email: '', lang: 'zh_tw' as Lang };
    }
  }));
  return rows;
}

/** 推播指定通知給 admin（email，per-recipient lang） */
export async function notifyAdmins(
  db: Firestore,
  key: AdminNotifyKey,
  params: AdminNotifyParams,
  options: NotifyAdminsOptions = {},
): Promise<AdminNotifyResult> {
  try {
    const fromAdmins = await loadAdminEmails(db, options.audience);
    const fromEnv = parseEmailList(
      (useRuntimeConfig() as { adminEmailTo?: string }).adminEmailTo || process.env.NUXT_ADMIN_EMAIL_TO,
    );
    const recipients = mergeRecipients(fromAdmins, fromEnv);

    if (recipients.length === 0) {
      // 大聲一點：沒有收件人等於通知完全消失，而這件事沒有任何其他徵兆
      console.warn(`[notify-admins] ${key} 無 email 收件人 —— 請設 NUXT_ADMIN_EMAIL_TO 或補 admins/{uid}.email`);
      return { delivered: false, reason: 'no-recipients' };
    }

    const settled = await Promise.allSettled(
      groupByLang(recipients).map(async (group) => {
        const text = getAdminNotifyText(key, group.lang, params);
        // 主旨取內文第一行：LINE 訊息本來就沒有主旨，第一行是最接近標題的東西
        const subject = `[DA] ${text.split('\n')[0]?.slice(0, 78) || key}`;
        return sendEmail(subject, text, group.emails);
      }),
    );

    // 一組語系一封信。任一封沒寄出就不算送達 —— 呼叫端據此決定要不要重試。
    let reason: AdminNotifyResult['reason'] | undefined;
    for (const r of settled) {
      if (r.status === 'rejected') {
        console.error(`[notify-admins] ${key} 寄送拋錯:`, r.reason);
        reason = reason ?? 'error';
        continue;
      }
      if (!r.value.sent) reason = reason ?? (r.value.reason === 'no-key' ? 'no-key' : 'error');
    }
    if (reason) {
      console.warn(`[notify-admins] ${key} 未送達（${reason}）`);
      return { delivered: false, reason };
    }
    return { delivered: true };
  } catch (err) {
    console.error('[notify-admins] 通知失敗（silent）:', err);
    return { delivered: false, reason: 'error' };
  }
}
