// 航班落地狀態 BFF 代理
// 前端嚴禁直接呼叫航班 API，憑證僅存於伺服器端

import { defineEventHandler, getQuery } from 'h3';

interface FlightStatusData {
  flight_number: string;
  status: 'scheduled' | 'landed' | 'delayed' | 'cancelled' | 'unknown';
  actual_arrival: string | null;
  terminal: string | null;
}

interface UnifiedResponse<T> {
  data: T;
  status: { code: number; message: { zh_tw: string; en: string; ja: string } };
}

export default defineEventHandler(async (event): Promise<UnifiedResponse<FlightStatusData | Record<string, never>>> => {
  const query = getQuery(event);
  const { flight } = query as { flight?: string };

  if (!flight) {
    return {
      data: {},
      status: {
        code: 400,
        message: {
          zh_tw: '缺少航班號碼參數',
          en: 'Missing flight number parameter',
          ja: '便名パラメータが不足しています'
        }
      }
    };
  }

  // TODO: 串接 AviationStack / FlightAware 等航班 API

  return {
    data: {
      flight_number: flight as string,
      status: 'unknown',
      actual_arrival: null,
      terminal: null
    },
    status: {
      code: 200,
      message: { zh_tw: '', en: '', ja: '' }
    }
  };
});
