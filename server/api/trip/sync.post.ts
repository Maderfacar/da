// 司機 GPS 定位與離線資料同步
// 支援司機端斷線後重新上線時批次同步行程資料

import { defineEventHandler, readBody } from 'h3';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

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
  // 資安修復 W1：本 endpoint 直接接收 GPS 軌跡與離線事件，無 auth 守衛時任何人可偽造司機 driver_id
  // 污染 Firestore。加 requireAuth 並校驗 body.driver_id 對應 caller（admin 例外可代寫）。
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

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

  // driver_id 兼容兩種格式（'line:Uxxxx' 或 'Uxxxx'），對齊 drivers/[id]/location.put.ts:31-32 比對方式
  const isAdmin = auth.roles.includes('admin');
  const driverIdAsLineUid = body.driver_id.startsWith('line:') ? body.driver_id.slice(5) : body.driver_id;
  const isSelf = auth.uid === body.driver_id || auth.lineUid === driverIdAsLineUid;
  if (!isAdmin && !isSelf) {
    return {
      data: {},
      status: {
        code: 403,
        message: {
          zh_tw: '無權同步他人行程',
          en: 'Cannot sync other driver trip',
          ja: '他人の同期はできません'
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
