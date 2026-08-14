// 認證根治 Phase 0：開機權威登入判斷。client 開機打一次，以 server 回的 signedIn 為準，
// 取代前端等待 Firebase session 復原（最多 12s）的 race。無 cookie / 無效一律回 signedIn:false（不洩 detection）。
import { getSessionFromEvent } from '@@/utils/session-auth';

export default defineEventHandler(async (event) => {
  const result = await getSessionFromEvent(event);
  if (!result.ok) {
    return successResponse({ signedIn: false });
  }
  return successResponse({
    signedIn: true,
    lineUid: result.lineUid,
    roles: result.roles,
    approved: result.approved,
    level: result.level ?? null,
  });
});
