/**
 * 推播失敗 → email 備援（有副作用的那一半；純邏輯在 email-fallback.ts）
 *
 * 掛在 sendLinePush 的 catch。**永不 throw**：它自己失敗不可以再炸一次推播路徑。
 *
 * 節流狀態存 Firestore `system_state/email-fallback`：額度用罄時每一次推播都會失敗，
 * 沒有上限的話一天可能寄出數百封，把信箱與 email 服務的免費額度一起燒掉。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { sendEmail } from '@@/utils/email-send';
import {
  decideEmailQuota,
  buildFallbackEmail,
  type EmailQuotaState,
} from '@@/utils/email-fallback';
import type { LineMessage } from '@@/utils/line-push';

const STATE_DOC = 'system_state/email-fallback';

export interface PushFailureInput {
  channel: 'passenger' | 'driver';
  targetUid: string;
  statusCode: number;
  errorDetails?: unknown;
  messages: ReadonlyArray<LineMessage>;
}

export async function notifyPushFailureByEmail(input: PushFailureInput): Promise<void> {
  try {
    const { firebaseServiceAccountJson } = useRuntimeConfig();
    if (!firebaseServiceAccountJson) return;
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.doc(STATE_DOC);

    let prev: EmailQuotaState | null = null;
    try {
      const snap = await ref.get();
      prev = snap.exists ? (snap.data() as EmailQuotaState) : null;
    } catch (err) {
      // 讀不到狀態就當作沒寄過 —— 與告警去重同一原則：寧可多寄，不可靜音
      console.error('[push-failure-email] 讀取節流狀態失敗，照常寄送:', err);
    }

    const now = Date.now();
    const quota = decideEmailQuota(prev, now);
    if (!quota.send) return; // 已達當日上限；失敗仍留在 line_api_errors，不會遺失

    const mail = buildFallbackEmail({
      channel: input.channel,
      targetUid: input.targetUid,
      statusCode: input.statusCode,
      errorDetails: input.errorDetails,
      messages: input.messages,
      at: now,
      isLastBeforeCap: quota.isLastBeforeCap,
    });

    const result = await sendEmail(mail.subject, mail.text);
    // 只有真的寄出才計數 —— 沒設 API key 時若照樣累加，上限會被沒寄出的信吃光
    if (result.sent) await ref.set(quota.nextState);
  } catch (err) {
    console.error('[push-failure-email] 備援流程失敗（silent）:', err);
  }
}
