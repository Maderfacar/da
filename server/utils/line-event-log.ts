/**
 * LINE Webhook Event Log（P43 Phase 1）
 *
 * 對應 spec design.md §1 + Brain AI 拍板 Q1=1a（簡單 schema）/ Q4=4a（fire-and-forget）。
 *
 * 設計：
 *   - collection `line_event_logs/{autoId}`；client 全禁讀寫（firestore.rules）
 *   - 寫入用 fire-and-forget（void 包 async IIFE）；webhook 200 回應不被阻擋
 *   - schema 為簡單版（不存 raw payload；只存 type/uid/postbackData/messageText/handlerResult）
 *   - 不設 TTL（Q3=3c）；Phase 4 收尾後觀察 1-2 週實際寫入量
 *
 * 用法：
 *   import { writeLineEventLog } from '@@/utils/line-event-log';
 *   writeLineEventLog({
 *     channel: 'passenger',
 *     eventType: 'postback',
 *     lineUid: ev.source.userId,
 *     postbackData: ev.postback.data,
 *     handlerResult: 'replied',
 *   });
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import type { LineClient } from '@@/utils/line-channel';

export type EventType =
  | 'follow'
  | 'unfollow'
  | 'message'
  | 'postback'
  | 'beacon'
  | 'memberJoined'
  | 'memberLeft'
  | 'unknown';

export type HandlerResult =
  | 'replied'         // handler 成功推 reply（含 follow / text fallback / postback 對應 handler）
  | 'ignored'         // event 收到但無 reply token（或無對應 handler 邏輯）— 仍視為正常處理
  | 'handler_failed'  // handler throw（postback handler 出錯）
  | 'no_handler';     // accessToken 未設 / postback data 不在 whitelist

export interface WriteEventLogInput {
  channel: LineClient;
  eventType: EventType;
  lineUid: string | null;
  postbackData: string | null;
  messageText: string | null;
  handlerResult: HandlerResult;
}

const MESSAGE_TEXT_TRIM = 100;

/**
 * 寫一筆 webhook event log。**fire-and-forget**（不 await）。
 *
 * 失敗 silent（console.warn）；webhook 處理流程不被影響。
 */
export function writeLineEventLog(input: WriteEventLogInput): void {
  void (async () => {
    try {
      const { firebaseServiceAccountJson } = useRuntimeConfig();
      if (!firebaseServiceAccountJson) return;
      const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
      await db.collection('line_event_logs').add({
        channel: input.channel,
        eventType: input.eventType,
        lineUid: input.lineUid,
        postbackData: input.postbackData,
        messageText: input.messageText !== null
          ? input.messageText.slice(0, MESSAGE_TEXT_TRIM)
          : null,
        handlerResult: input.handlerResult,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('[line-event-log] write failed (silent):', err);
    }
  })();
}
