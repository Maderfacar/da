/**
 * 管理員自動通知 — 推播分派（admin-auto-notify-dashboard 變更）
 *
 * notifyAdmins 解析具 canManageOrders 的 admin 收件人後，依各 admin 自身 lang
 * 組對應語系文字，逐一以 passenger OA 推播（D3 拍板：per-admin lang）。
 *
 * 整體 fire-and-forget：呼叫端用 void 包起來，不阻塞主流程。
 *   - 收件人解析 / 推播任一失敗都不 rethrow（呼叫端另有 try/catch 保底）
 *   - 個別 admin 推播失敗由 sendLinePush 內部吞掉並寫 line_api_errors
 */
import type { Firestore } from 'firebase-admin/firestore';
import { sendLinePush } from '@@/utils/line-push';
import { getUserLang } from '@@/utils/user-lang';
import { getAdminRecipients } from '@@/utils/admin-recipients';
import { getAdminNotifyText, type AdminNotifyKey, type AdminNotifyParams } from '@@/utils/admin-notify-message';

/** 推播指定通知給所有具 canManageOrders 的 admin（passenger OA，per-admin lang） */
export async function notifyAdmins(
  db: Firestore,
  key: AdminNotifyKey,
  params: AdminNotifyParams,
): Promise<void> {
  const recipients = await getAdminRecipients(db, 'canManageOrders');
  await Promise.allSettled(
    recipients.map(async (uid) => {
      const lang = await getUserLang(db, uid);
      const text = getAdminNotifyText(key, lang, params);
      await sendLinePush('passenger', uid, [{ type: 'text', text }]);
    }),
  );
}
