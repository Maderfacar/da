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
import { getAdminRecipients, getSuperAdminRecipients } from '@@/utils/admin-recipients';
import { getAdminNotifyText, type AdminNotifyKey, type AdminNotifyParams } from '@@/utils/admin-notify-message';

export interface NotifyAdminsOptions {
  /**
   * 收件對象。預設具 canManageOrders 的 admin（業務通知）。
   * 'super' 僅送 level=super —— 系統告警專用，理由見 getSuperAdminRecipients 註解
   * （每月推播額度按收件人計，告警不該與客人通知搶同一份預算）。
   */
  audience?: 'canManageOrders' | 'super';
}

/** 推播指定通知給 admin（passenger OA，per-admin lang） */
export async function notifyAdmins(
  db: Firestore,
  key: AdminNotifyKey,
  params: AdminNotifyParams,
  options: NotifyAdminsOptions = {},
): Promise<void> {
  const recipients = options.audience === 'super'
    ? await getSuperAdminRecipients(db)
    : await getAdminRecipients(db, 'canManageOrders');
  await Promise.allSettled(
    recipients.map(async (uid) => {
      const lang = await getUserLang(db, uid);
      const text = getAdminNotifyText(key, lang, params);
      await sendLinePush('passenger', uid, [{ type: 'text', text }]);
    }),
  );
}
