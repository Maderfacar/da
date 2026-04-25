// Google Maps 預估車程 BFF 代理
// 前端嚴禁直接呼叫 Maps API，金鑰僅存於伺服器端

import { defineEventHandler, getQuery } from 'h3';

interface DistanceData {
  distance_km: number;
  duration_minutes: number;
  origin: string;
  destination: string;
}

interface UnifiedResponse<T> {
  data: T;
  status: { code: number; message: { zh_tw: string; en: string; ja: string } };
}

export default defineEventHandler(async (event): Promise<UnifiedResponse<DistanceData | Record<string, never>>> => {
  const query = getQuery(event);
  const { origin, destination } = query as { origin?: string; destination?: string };

  if (!origin || !destination) {
    return {
      data: {},
      status: {
        code: 400,
        message: {
          zh_tw: '缺少起點或終點參數',
          en: 'Missing origin or destination parameter',
          ja: '出発地または目的地のパラメータが不足しています'
        }
      }
    };
  }

  // TODO: 串接 Google Maps Distance Matrix API
  // const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  return {
    data: {
      distance_km: 0,
      duration_minutes: 0,
      origin: origin as string,
      destination: destination as string
    },
    status: {
      code: 200,
      message: { zh_tw: '', en: '', ja: '' }
    }
  };
});
