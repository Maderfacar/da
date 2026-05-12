import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { sendLinePush } from '@@/utils/line-push';
import type { LineClient } from '@@/utils/line-channel';
import { successResponse, badRequestError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

interface BroadcastBody {
  title: string;
  message: string;
  targetRole: 'all' | 'passenger' | 'driver';
}

export default defineEventHandler(async (event) => {
  // P14：必須登入；P18：套 canBroadcast 權限
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const body = await readBody<BroadcastBody>(event);

  if (!body.message?.trim() || !body.targetRole) {
    return badRequestError({ zh_tw: '缺少訊息或目標', en: 'Missing message or target', ja: 'メッセージまたは対象が不足しています' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError();
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    let q = db.collection('users') as FirebaseFirestore.Query;
    if (body.targetRole !== 'all') {
      q = q.where('roles', 'array-contains', body.targetRole);
    }

    const snapshot = await q.get();
    // P29：每位 user 配對應 OA channel。driver role 優先用 driver OA 推；其餘走 passenger OA。
    //   - targetRole='passenger' → 全部 passenger OA
    //   - targetRole='driver'    → 全部 driver OA
    //   - targetRole='all'       → 每人單推一次，依 role 分流（避免雙推同一人）
    interface PushTarget { lineUserId: string; client: LineClient }
    const targets: PushTarget[] = [];
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const lineUserId = data.lineUserId as string;
      if (!lineUserId) return;
      const roles = Array.isArray(data.roles) ? (data.roles as string[]) : [];

      let client: LineClient;
      if (body.targetRole === 'driver') {
        client = 'driver';
      } else if (body.targetRole === 'passenger') {
        client = 'passenger';
      } else {
        // 'all'：driver role 用 driver OA，其餘 passenger OA
        client = roles.includes('driver') ? 'driver' : 'passenger';
      }
      targets.push({ lineUserId, client });
    });

    const text = body.title ? `${body.title}\n\n${body.message}` : body.message;
    const pushResults = await Promise.allSettled(
      targets.map((t) => sendLinePush(t.client, t.lineUserId, [{ type: 'text', text }])),
    );

    const sent = pushResults.filter((r) => r.status === 'fulfilled').length;

    // P25-2 audit log（廣播訊息內容 mask 200 字避免 audit_logs 暴量）
    await writeAuditLog({
      event,
      auth,
      action: 'broadcast.send',
      targetType: 'broadcast',
      targetId: body.targetRole,
      payload: {
        targetRole: body.targetRole,
        title: body.title ?? '',
        messagePreview: body.message.slice(0, 200),
        sent,
        total: targets.length,
      },
    });

    return successResponse({ sent, total: targets.length });
  } catch (err) {
    console.error('[admin/broadcast] failed:', err);
    return serverError();
  }
});
