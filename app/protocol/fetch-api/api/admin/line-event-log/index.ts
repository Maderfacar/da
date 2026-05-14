// P43 Phase 1：admin line event log API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  EventLogListParams,
  EventLogListRes,
} from './type.d';

export type {
  EventLogChannel,
  EventLogDto,
  EventLogHandlerResult,
  EventLogListParams,
  EventLogListRes,
  EventLogType,
} from './type.d';

/** 列 webhook event log（依 channel + 可選 type/handlerResult filter；createdAt desc） */
export const GetLineEventLogs = (params: EventLogListParams) =>
  methods.get<EventLogListRes>(
    '/nuxt-api/admin/line-event-logs',
    params as Record<string, unknown>,
  );
