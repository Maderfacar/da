// P43 Phase 1：admin line event log type 定義
//
// 對齊 server/utils/line-event-log.ts EventType / HandlerResult

export type EventLogChannel = 'passenger' | 'driver';

export type EventLogType =
  | 'follow'
  | 'unfollow'
  | 'message'
  | 'postback'
  | 'beacon'
  | 'memberJoined'
  | 'memberLeft'
  | 'unknown';

export type EventLogHandlerResult =
  | 'replied'
  | 'ignored'
  | 'handler_failed'
  | 'no_handler';

export interface EventLogDto {
  id: string;
  channel: EventLogChannel;
  eventType: EventLogType;
  lineUid: string | null;
  postbackData: string | null;
  messageText: string | null;
  handlerResult: EventLogHandlerResult;
  createdAt: string | null;  // ISO
}

export interface EventLogListRes {
  items: EventLogDto[];
}

export interface EventLogListParams {
  channel: EventLogChannel;
  eventType?: EventLogType;
  handlerResult?: EventLogHandlerResult;
  limit?: number;
}
