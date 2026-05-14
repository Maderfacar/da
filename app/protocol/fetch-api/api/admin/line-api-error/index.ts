// P43 Phase 2：admin line API error log API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  ApiErrorListParams,
  ApiErrorListRes,
} from './type.d';

export type {
  ApiErrorChannel,
  ApiErrorDto,
  ApiErrorListParams,
  ApiErrorListRes,
} from './type.d';

/** 列 LINE API error log（依 channel + 可選 api filter；createdAt desc） */
export const GetLineApiErrors = (params: ApiErrorListParams) =>
  methods.get<ApiErrorListRes>(
    '/nuxt-api/admin/line-api-errors',
    params as Record<string, unknown>,
  );
