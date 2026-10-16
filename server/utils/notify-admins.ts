/**
 * 管理員自動通知 — **改回 LINE 推播，且只推 super**（2026-10-17）
 *
 * 沿革：
 *   - 原本以 passenger OA 推給所有 canManageOrders admin（3 位）。一張訂單在乘客 OA
 *     產生 22 則推播，其中 18 則是 admin 內部通知，2026-08-24 把每月額度打爆。
 *   - 2026-08-25 改走 email 解決額度問題。
 *   - 2026-10-17 改回 LINE：營運者要在 LINE 上即時看到。額度問題改用「只推 super」解決
 *     —— 訂單量少的現階段只有營運者本人需要收，其他 admin 有後台可看。
 *     每次通知只扣 1 則，一張訂單約 6 則 admin 推播（原本 18 則）。
 *
 * 推播失敗時 sendLinePush 內建 email 備援（push-failure-email），額度用罄不會靜默消失。
 *
 * **呼叫端介面刻意不變**。`audience` 選項保留，但目前兩種值都只送 super。
 * 之後要恢復多位 admin 收通知，改 resolveRecipientUids 一處即可。
 *
 * 呼叫端務必 await（勿用 void fire-and-forget）：Vercel 回應送出後函式可能被凍結，
 * 背景推播會中途消失 —— 2026-10-17 午夜兩筆新訂單的通知就是這樣沒送到。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { sendLinePush } from '@@/utils/line-push';
import { getUserLang } from '@@/utils/user-lang';
import { getSuperAdminRecipients } from '@@/utils/admin-recipients';
import { getAdminNotifyText, type AdminNotifyKey, type AdminNotifyParams } from '@@/utils/admin-notify-message';

/**
 * 一次通知的結果。
 *
 * **為什麼要有回傳值**：呼叫端（告警去重）必須能分辨「發出去了」與「決定要發但沒發成」，
 * 否則一批沒送到的告警會被記成「已通知」而抑制 24 小時。
 *
 * 仍然**永不 throw**：業務呼叫端（訂單、司機申請）照舊可以忽略回傳值。
 */
export interface AdminNotifyResult {
  delivered: boolean;
  /** 未送達原因：無收件人 / 未設 API key / 推播失敗 */
  reason?: 'no-recipients' | 'no-key' | 'error';
}

export interface NotifyAdminsOptions {
  /**
   * 收件對象。'canManageOrders'（業務通知，預設）與 'super'（系統告警）。
   * 2026-10-17 起兩者都只送 level=super，見檔頭說明。
   */
  audience?: 'canManageOrders' | 'super';
}

/** 解析收件人 lineUid。目前一律只送 super（營運者本人）。 */
async function resolveRecipientUids(db: Firestore): Promise<string[]> {
  return getSuperAdminRecipients(db);
}

/** 對每位收件人各推一則文字訊息；全部送達才算 delivered。 */
async function pushTextToRecipients(
  db: Firestore,
  label: string,
  buildText: (uid: string) => Promise<string>,
): Promise<AdminNotifyResult> {
  try {
    const uids = await resolveRecipientUids(db);
    if (uids.length === 0) {
      // 大聲一點：沒有收件人等於通知完全消失，而這件事沒有任何其他徵兆
      console.warn(`[notify-admins] ${label} 無收件人 —— admins collection 沒有 level=super 的帳號`);
      return { delivered: false, reason: 'no-recipients' };
    }

    const settled = await Promise.allSettled(uids.map(async (uid) => {
      const text = await buildText(uid);
      return sendLinePush('passenger', uid, [{ type: 'text', text }]);
    }));

    const failed = settled.filter((r) => r.status === 'rejected' || !r.value);
    if (failed.length > 0) {
      console.warn(`[notify-admins] ${label} 未送達 ${failed.length}/${uids.length}`);
      return { delivered: false, reason: 'error' };
    }
    return { delivered: true };
  } catch (err) {
    console.error('[notify-admins] 通知失敗（silent）:', err);
    return { delivered: false, reason: 'error' };
  }
}

/** 推播指定模板通知給 admin（passenger OA，依收件人自己的語系） */
export async function notifyAdmins(
  db: Firestore,
  key: AdminNotifyKey,
  params: AdminNotifyParams,
  _options: NotifyAdminsOptions = {},
): Promise<AdminNotifyResult> {
  return pushTextToRecipients(db, key, async (uid) => {
    const lang = await getUserLang(db, uid);
    return getAdminNotifyText(key, lang, params);
  });
}

/**
 * 推播一則現成中文訊息給 admin（給不走 admin-notify-message 模板的呼叫端，
 * 例如司機證件 / 車輛 profile 待審核）。收件人規則與 notifyAdmins 相同。
 */
export async function notifyAdminsText(db: Firestore, text: string): Promise<AdminNotifyResult> {
  return pushTextToRecipients(db, text.split('\n')[0] ?? 'text', async () => text);
}
