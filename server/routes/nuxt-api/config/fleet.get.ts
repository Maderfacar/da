/**
 * GET /nuxt-api/config/fleet
 *
 * 公開端點：回傳整份 fleet 計價配置（車型 / 行李類型 / 加值服務）。
 * 乘客 fleet 頁 + booking 流程 + admin/settings 都讀這個。
 *
 * 自動 seed：3 collection 任一為空時寫入 defaults（避免上線後資料庫空白）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getFleetConfig } from '@@/utils/fleet-config';

export default defineEventHandler(async () => {
  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const config = await getFleetConfig(db);
    return successResponse(config);
  } catch (err) {
    console.error('[config/fleet] read failed:', err);
    return serverError({ zh_tw: '讀取 fleet 設定失敗', en: 'Failed to read fleet config', ja: 'fleet設定の読み込みに失敗しました' });
  }
});
