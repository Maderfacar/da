// 司機 GPS 定位與離線資料同步
// 支援司機端斷線後重新上線時批次同步行程資料

import { defineEventHandler, readBody } from 'h3';

interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: number;
}

interface TripSyncPayload {
  trip_id: string;
  driver_id: string;
  gps_trail: GpsPoint[];
  offline_events: Array<{ type: string; payload: unknown; timestamp: number }>;
}

interface UnifiedResponse<T> {
  data: T;
  status: { code: number; message: { zh_tw: string; en: string; ja: string } };
}

export default defineEventHandler(async (event): Promise<UnifiedResponse<{ synced: boolean } | Record<string, never>>> => {
  const body = await readBody<TripSyncPayload>(event);

  if (!body?.trip_id || !body?.driver_id) {
    return {
      data: {},
      status: {
        code: 400,
        message: {
          zh_tw: '缺少行程 ID 或司機 ID',
          en: 'Missing trip_id or driver_id',
          ja: 'trip_id または driver_id が不足しています'
        }
      }
    };
  }

  // TODO: 將 gps_trail 與 offline_events 寫入 Firebase Firestore

  return {
    data: { synced: true },
    status: {
      code: 200,
      message: { zh_tw: '', en: '', ja: '' }
    }
  };
});
