/**
 * 使用者語系（Lang）型別 + `getUserLang` helper。
 *
 * 從 i18n-message.ts 拆出（W4 — line-template-expansion）：原檔已隨 12 觸發點全部
 * 模板化後 delete，但 Lang type / getUserLang 仍被多處引用（push helpers、notify-admins、
 * line-richmenu-binding 等），故單獨保留於此。
 */
import type { Firestore } from 'firebase-admin/firestore';

export type Lang = 'zh_tw' | 'en' | 'ja';

const VALID_LANGS: Lang[] = ['zh_tw', 'en', 'ja'];

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
