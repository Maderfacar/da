/**
 * 醜點系統 Phase 1（A2）— Server 端 helper
 *
 * 規範參考 [shared/penalty.ts](../../shared/penalty.ts) 與 Memory project-penalty-system.md。
 *
 * 對 PATCH /orders/[id] 取消路徑（late_cancel）與
 * POST /admin/orders/[id]/no-show（no_show）共用同一個累計入口。
 *
 * 設計重點：
 *   - 累計用 Firestore transaction（避免併發兩單同時取消造成 lost update）
 *   - lazy 6 個月歸零：transaction 內判斷 + 寫 reset audit log
 *   - LINE 推播在 transaction 外（成功/失敗均不影響累計結果）
 *   - audit log 一律 await（Vercel serverless 不砍 promise）
 */
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import type { H3Event } from 'h3';
import {
  computeUglyPoints,
  shouldResetUgly,
  decidePenaltyPush,
  type UglyType,
} from '~shared/penalty';
import { writeAuditLog } from '@@/utils/audit-log';
import type { AuthOk } from '@@/utils/require-auth';
import { sendLinePush } from '@@/utils/line-push';
import { resolveTemplate, buildTemplate, type TemplateContentFlex } from '@@/utils/template-registry';
import { getUserLang } from '@@/utils/user-lang';

interface UglyHistoryEntry {
  orderId: string;
  type: UglyType;
  count: number;
  at: Timestamp;
}

interface ApplyUglyPointInput {
  ownerUid: string;
  type: UglyType;
  orderId: string;
  event: H3Event;
  auth: AuthOk;
  /** 自訂推播原因（admin 拉黑時帶入）；late_cancel/no_show 累計時通常為 null */
  customReason?: string | null;
}

interface ApplyUglyPointResult {
  newCount: number;
  added: number;
  reset: boolean;
  push: ReturnType<typeof decidePenaltyPush>;
}

/**
 * 累計醜點並推 LINE。對 PATCH late_cancel 與 admin no_show 共用。
 *
 * 流程：
 *   1. transaction：讀 users → 若 shouldResetUgly 先歸零 → 累加新點數 → 寫 history + uglyResetAt
 *   2. transaction 外：寫 audit log（reset / apply 各一筆）
 *   3. transaction 外：依 newCount 決定推 warning / suspended（fire-and-forget）
 *
 * 注意：本函式預期由 caller `void` 或 `await`，內部失敗 throw 由 caller 接住 log；
 * 主流程（訂單取消 / no-show 標記）已先 commit，不會 rollback。
 */
export async function applyUglyPoint(
  db: Firestore,
  input: ApplyUglyPointInput,
): Promise<ApplyUglyPointResult> {
  const { ownerUid, type, orderId, event, auth, customReason } = input;
  const added = computeUglyPoints(type);
  const userRef = db.collection('users').doc(ownerUid);
  const now = new Date();

  const txResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? (snap.data() ?? {}) : {};
    const prevCount = typeof data.uglyCount === 'number' ? data.uglyCount : 0;
    const prevResetAtRaw = data.uglyResetAt as Timestamp | null | undefined;
    const prevResetAt = prevResetAtRaw && typeof prevResetAtRaw.toDate === 'function'
      ? prevResetAtRaw.toDate()
      : null;
    const prevHistory = Array.isArray(data.uglyHistory) ? (data.uglyHistory as UglyHistoryEntry[]) : [];

    const willReset = shouldResetUgly(prevResetAt, now);
    const baseCount = willReset ? 0 : prevCount;
    const newCount = baseCount + added;

    const entry: UglyHistoryEntry = {
      orderId,
      type,
      count: added,
      at: Timestamp.fromDate(now),
    };

    // 歸零時連 uglyHistory 一併清空（避免累積無上限；歸零代表 6 個月內無新點）
    const nextHistory = willReset ? [entry] : [...prevHistory, entry];

    tx.set(userRef, {
      uglyCount: newCount,
      uglyHistory: nextHistory,
      uglyResetAt: Timestamp.fromDate(now),
    }, { merge: true });

    return { newCount, reset: willReset };
  });

  // audit log：歸零 + 累計（reset 在前）
  if (txResult.reset) {
    await writeAuditLog({
      event,
      auth,
      action: 'user.penalty_reset',
      targetType: 'user',
      targetId: ownerUid,
      payload: { reason: 'lazy_6m_no_new_penalty' },
    });
  }
  await writeAuditLog({
    event,
    auth,
    action: 'user.penalty_apply',
    targetType: 'user',
    targetId: ownerUid,
    payload: { orderId, type, added, newCount: txResult.newCount },
  });

  // 推 LINE 通知（fire-and-forget；失敗 silent）
  const pushType = decidePenaltyPush(txResult.newCount);
  if (pushType) {
    void pushPenaltyNotification(db, {
      ownerUid,
      pushType,
      uglyCount: txResult.newCount,
      reason: customReason ?? null,
    });
  }

  return { newCount: txResult.newCount, added, reset: txResult.reset, push: pushType };
}

interface PushPenaltyInput {
  ownerUid: string;
  pushType: 'warning' | 'suspended';
  uglyCount: number;
  reason: string | null;
}

/**
 * 推 penalty.warning / penalty.suspended Flex Bubble。
 *
 * fire-and-forget；失敗 silent log，不 throw（caller 通常已 void）。
 */
export async function pushPenaltyNotification(
  db: Firestore,
  input: PushPenaltyInput,
): Promise<void> {
  try {
    const { ownerUid, pushType, uglyCount, reason } = input;
    const templateKey = pushType === 'warning' ? 'penalty.warning' : 'penalty.suspended';
    const lang = await getUserLang(db, ownerUid);
    const tpl = await resolveTemplate(db, templateKey, lang) as TemplateContentFlex;
    const params: Record<string, string> = {
      uglyCount: String(uglyCount),
    };
    if (reason) {
      params.reason = reason;
    } else {
      // 累計到頂無 reason 時，body 內 {reason} 留空避免顯示 placeholder 殘留
      params.reason = '';
    }
    const msg = buildTemplate(tpl, params, 'flex');
    if (msg) await sendLinePush('passenger', ownerUid, [msg]);
  } catch (err) {
    console.error('[penalty] push notification failed:', err);
  }
}
