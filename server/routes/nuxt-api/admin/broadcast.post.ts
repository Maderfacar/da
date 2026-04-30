import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { sendLinePush } from '@@/utils/line-push';
import { successResponse, badRequestError, serverError } from '@@/utils/response';

interface BroadcastBody {
  title: string;
  message: string;
  targetRole: 'all' | 'passenger' | 'driver';
}

export default defineEventHandler(async (event) => {
  const body = await readBody<BroadcastBody>(event);

  if (!body.message?.trim() || !body.targetRole) {
    return badRequestError({ zh_tw: '缺少訊息或目標', en: 'Missing message or target', ja: 'メッセージまたは対象が不足しています' });
  }

  const { firebaseServiceAccountJson, lineChannelAccessToken } = useRuntimeConfig();
  if (!firebaseServiceAccountJson || !lineChannelAccessToken) {
    return serverError();
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    let q = db.collection('users') as FirebaseFirestore.Query;
    if (body.targetRole !== 'all') {
      q = q.where('role', '==', body.targetRole);
    }

    const snapshot = await q.get();
    const lineUserIds: string[] = [];
    snapshot.docs.forEach((doc) => {
      const lineUserId = doc.data().lineUserId as string;
      if (lineUserId) lineUserIds.push(lineUserId);
    });

    const text = body.title ? `${body.title}\n\n${body.message}` : body.message;
    const pushResults = await Promise.allSettled(
      lineUserIds.map((to) =>
        sendLinePush(lineChannelAccessToken, to, [{ type: 'text', text }])
      )
    );

    const sent = pushResults.filter((r) => r.status === 'fulfilled').length;

    return successResponse({ sent, total: lineUserIds.length });
  } catch (err) {
    console.error('[admin/broadcast] failed:', err);
    return serverError();
  }
});
