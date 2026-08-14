/**
 * 由 session cookie 解析身分（認證根治 Phase 0）。
 * 供 session-check 端點與其他「只認 cookie」場景使用；與 require-auth 共用 resolveIdentity。
 */
import type { H3Event } from 'h3';
import { verifySessionCookie } from '@@/utils/session-cookie';
import { resolveIdentity, type AuthResult } from '@@/utils/require-auth';

export async function getSessionFromEvent(event: H3Event): Promise<AuthResult> {
  const decoded = await verifySessionCookie(event);
  if (!decoded) {
    return { ok: false, code: 401, message: { zh_tw: '未授權', en: 'Unauthorized', ja: '未承認' } };
  }
  return resolveIdentity(event, decoded);
}
