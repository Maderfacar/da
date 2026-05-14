// P43 Phase 2：admin line API error log type 定義
//
// 對齊 server/utils/line-api-error-log.ts schema

export type ApiErrorChannel = 'passenger' | 'driver' | 'unknown';

export interface ApiErrorDto {
  id: string;
  channel: ApiErrorChannel;
  api: string;
  method: 'GET' | 'POST' | 'DELETE';
  statusCode: number;
  errorMessage: string;
  errorDetails: string | null;
  context: {
    targetUid: string | null;
    richMenuId: string | null;
    orderId: string | null;
  };
  createdAt: string | null;
}

export interface ApiErrorListRes {
  items: ApiErrorDto[];
}

export interface ApiErrorListParams {
  channel: ApiErrorChannel;
  api?: string;
  limit?: number;
}
