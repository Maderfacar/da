/**
 * PATCH /nuxt-api/self/lang
 *
 * User 自助切換語系（P42 Phase 2）— passenger / driver / admin 通用。
 *
 * Body：
 *   lang: 'zh_tw' | 'en' | 'ja'
 *
 * 行為：
 *   1. 驗 lang（與 line_richmenus 用同一 RICHMENU_VALID_LANGS）
 *   2. 取 prev lang（給 audit log 比對 + 容錯 noop 場景）
 *   3. update users/{auth.lineUid}.lang（merge 寫入；不破壞既有 displayName / lineUserId / lastSeenAt）
 *   4. 依 auth.roles 推 channels：含 passenger → 'passenger'，含 driver → 'driver'；
 *      對每個 channel 呼 `bindRichmenuForUser`（fail-open；失敗計入回傳 rebinds[i].result）
 *   5. audit log `user.lang.update`（含 prev / new + per channel rebind 結果）
 *
 * 認證：登入 user（任意 role 皆可）
 *
 * Re-bind 失敗策略：
 *   - bindRichmenuForUser 內部 catch 不 throw（fail-open）
 *   - LINE API 錯誤已透過 errorContext 寫入 line_api_errors（P43 Phase 2）
 *   - 用戶在前端看到「語系已切換成功；圖文選單可能延遲更新」是預期行為
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import { validateLang } from '@@/utils/line-richmenu-doc';
import type { LineClient } from '@@/utils/line-channel';
import { bindRichmenuForUser, type BindResult } from '@@/utils/line-richmenu-binding';

interface PatchBody {
  lang?: string;
}

interface RebindEntry {
  channel: LineClient;
  ok: boolean;
  usedLang: string | null;
  richMenuId: string | null;
  error: string | null;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const langRes = validateLang(body.lang);
  if (!langRes.ok) {
    return badRequestError({
      zh_tw: langRes.error,
      en: 'lang must be zh_tw / en / ja',
      ja: 'lang は zh_tw / en / ja',
    });
  }
  const lang = langRes.value;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    const userRef = db.collection('users').doc(auth.lineUid);
    const userSnap = await userRef.get();
    const prevLang = userSnap.exists ? ((userSnap.data()?.lang as string | undefined) ?? null) : null;

    await userRef.set({ lang }, { merge: true });

    // 依 roles 推 channels；passenger / driver 都有則兩個 channel 都重綁
    const clients: LineClient[] = [];
    if (auth.roles.includes('passenger')) clients.push('passenger');
    if (auth.roles.includes('driver')) clients.push('driver');

    const rebinds: RebindEntry[] = [];
    for (const channel of clients) {
      const result: BindResult = await bindRichmenuForUser(db, channel, auth.lineUid, lang);
      rebinds.push({
        channel,
        ok: result.ok,
        usedLang: result.usedLang,
        richMenuId: result.richMenuId,
        error: result.error,
      });
    }

    await writeAuditLog({
      event,
      auth,
      action: 'user.lang.update',
      targetType: 'user',
      targetId: auth.lineUid,
      payload: { prevLang, newLang: lang, rebinds },
    });

    return successResponse({ lang, rebinds });
  } catch (err) {
    console.error('[self/lang PATCH] failed:', err);
    return serverError();
  }
});
