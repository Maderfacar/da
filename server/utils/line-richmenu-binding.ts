/**
 * LINE Richmenu Per-User Binding Helper（P42 Phase 1）
 *
 * 對應 [openspec/changes/2026-05-15-line-oa-p42-multilang-richmenu/design.md](../../openspec/changes/2026-05-15-line-oa-p42-multilang-richmenu/design.md) §2。
 *
 * 三個 public function：
 *   - resolveUserLang(db, lineUid, eventLang?)：解析 user 偏好 lang（Q3=3b 純讀 users.lang）
 *   - loadActiveRichmenuForLang(db, channel, lang)：找該 channel × lang active doc（Q5=5a fallback chain）
 *   - bindRichmenuForUser(db, client, lineUid, lang)：對 user 綁該 lang 對應 richmenu（fail-open）
 *
 * 使用場景：
 *   - webhook follow event（[line-channel.ts](./line-channel.ts) `handleLineWebhook`）
 *   - PATCH /api/self/lang 觸發 re-bind（Phase 2）
 *   - publish 流程 batch re-bind（Phase 4）
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { LineClient } from '@@/utils/line-channel';
import { getUserLang, type Lang } from '@@/utils/user-lang';
import {
  linkRichmenuToUser,
  unlinkRichmenuFromUser,
} from '@@/utils/line-richmenu';
import type { LineRichmenuDoc } from '@@/utils/line-richmenu-doc';

/**
 * Q5=5a 拍板：每 lang 找不到 active doc 時的 fallback 順序。
 *
 * 設計原則：永遠把當前 lang 放第一個；其餘以 zh_tw 優先（與 i18n locale default 一致）。
 */
const FALLBACK_CHAIN: Record<Lang, Lang[]> = {
  zh_tw: ['zh_tw', 'en', 'ja'],
  en: ['en', 'zh_tw', 'ja'],
  ja: ['ja', 'zh_tw', 'en'],
};

/**
 * 解析 user 偏好 lang（Q3=3b 拍板：純讀 users/{lineUid}.lang）。
 *
 * - 缺值 / 無此 user / 非合法 lang → fallback 'zh_tw'
 * - `eventLang` 參數保留給未來 Q3=3c 切換情境使用（目前忽略）
 */
export async function resolveUserLang(
  db: Firestore,
  lineUid: string,
  _eventLang?: string,
): Promise<Lang> {
  return getUserLang(db, lineUid);
}

/**
 * 找該 channel × lang 對應的 active richmenu doc。
 *
 * 若該 lang 沒有 active doc → 依 FALLBACK_CHAIN 順序找其他 lang；全鏈空 → return null。
 *
 * 用 limit(1) + .docs[0] 取單筆（同 channel × lang × status='active' 設計上 ≤ 1）。
 */
export async function loadActiveRichmenuForLang(
  db: Firestore,
  channel: LineClient,
  lang: Lang,
): Promise<(LineRichmenuDoc & { id: string }) | null> {
  const chain = FALLBACK_CHAIN[lang] ?? FALLBACK_CHAIN.zh_tw;
  for (const tryLang of chain) {
    const snap = await db.collection('line_richmenus')
      .where('channel', '==', channel)
      .where('lang', '==', tryLang)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { ...(doc.data() as LineRichmenuDoc), id: doc.id };
    }
  }
  return null;
}

export interface BindResult {
  ok: boolean;
  richMenuId: string | null;
  /** 實際綁定使用的 lang（可能因 fallback 不是 user 原 lang） */
  usedLang: Lang | null;
  /** 失敗時填入 error message（成功為 null） */
  error: string | null;
}

/**
 * 對 user 綁該 lang 對應 richmenu。
 *
 * 行為：
 *   1. loadActiveRichmenuForLang 找該 lang 對應 active doc（含 fallback chain）
 *   2. 若找到且有 lineRichMenuId → linkRichmenuToUser
 *   3. 若全鏈空 / lineRichMenuId 為 null → unlinkRichmenuFromUser（讓 user 看 LINE default）
 *   4. 失敗（LINE API throw）→ return ok=false 但不 re-throw（fail-open；P43 error log 已自動寫）
 *
 * 用 fire-and-forget 場景（webhook follow）：caller 應自包 IIFE 並 catch；本 fn 內部 try/catch 已 swallow
 */
export async function bindRichmenuForUser(
  db: Firestore,
  client: LineClient,
  lineUid: string,
  lang: Lang,
): Promise<BindResult> {
  let richmenu: (LineRichmenuDoc & { id: string }) | null = null;
  try {
    richmenu = await loadActiveRichmenuForLang(db, client, lang);
  } catch (err) {
    return {
      ok: false,
      richMenuId: null,
      usedLang: null,
      error: `loadActiveRichmenuForLang failed: ${(err as Error).message}`,
    };
  }

  if (!richmenu?.lineRichMenuId) {
    try {
      await unlinkRichmenuFromUser(client, lineUid);
    } catch (err) {
      console.warn('[richmenu-binding] unlink failed (silent):', (err as Error).message);
    }
    return { ok: true, richMenuId: null, usedLang: null, error: null };
  }

  try {
    await linkRichmenuToUser(client, lineUid, richmenu.lineRichMenuId);
    return {
      ok: true,
      richMenuId: richmenu.lineRichMenuId,
      usedLang: richmenu.lang,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      richMenuId: null,
      usedLang: null,
      error: (err as Error).message ?? 'linkRichmenuToUser failed',
    };
  }
}
