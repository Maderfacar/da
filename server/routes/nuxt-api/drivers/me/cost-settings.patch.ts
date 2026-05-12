/**
 * PATCH /nuxt-api/drivers/me/cost-settings
 * 司機自存營運成本計算機設定（P30 接續 P26 風格）
 *
 * 寫入 drivers/{lineUid}.costSettings；driver 可在 /driver/cost 頁編輯，
 * 改 server 端持久化（取代原本的 localStorage），跨裝置 / 重登後仍可載入。
 *
 * 認證：require driver self（caller 必須是該 driver 本人）
 *
 * Body 12 欄位皆 optional（partial update），都是 number。
 *   - 每月固定：carLoan / insurance / maintenance / parking / laborIns
 *   - 每月變動：oilMonthly / tollMonthly（P33：原 oilPerKm/tollPerKm 每公里計算改每月直接輸入）
 *   - 每 5 萬公里：tireCost
 *   - 每上班日：miscDaily
 *   - 營運參數：dailyKm / dailyRevenue / workDays
 *
 * 數值範圍驗證：≥ 0；過大值（> 1e9）拒收避免誤輸入
 *
 * P33 向下兼容：
 *   - 既有 prod 資料仍有 oilPerKm/tollPerKm 欄位（單位每公里）；本端點仍接受寫入以免破壞 client
 *     migration 中途行為；但新 client 改寫 oilMonthly/tollMonthly
 *   - load 端（cost/index.vue）會優先讀新欄位，找不到再讀舊欄位
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

const FIELDS = [
  'carLoan', 'insurance', 'maintenance', 'parking', 'laborIns',
  // P33 新欄位（每月）
  'oilMonthly', 'tollMonthly',
  // P33 舊欄位（每公里）— 保留接受以免 in-flight migration 失敗；新 client 不再寫入
  'oilPerKm', 'tollPerKm',
  'tireCost',
  'miscDaily',
  'dailyKm', 'dailyRevenue', 'workDays',
] as const;
type Field = typeof FIELDS[number];

type PatchBody = Partial<Record<Field, number>>;

const MAX = 1e9;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body || typeof body !== 'object') {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid body', ja: 'リクエスト形式が不正です' });
  }

  // 收集合法欄位（型別 + 範圍）；任一不合法直接拒整批
  const update: Record<string, number> = {};
  for (const f of FIELDS) {
    const v = body[f];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX) {
      return badRequestError({
        zh_tw: `欄位 ${f} 數值無效`,
        en: `Invalid value for ${f}`,
        ja: `${f} の値が無効です`,
      });
    }
    update[`costSettings.${f}`] = v;
  }

  if (Object.keys(update).length === 0) {
    return badRequestError({ zh_tw: '請提供至少一個欄位', en: 'Provide at least one field', ja: '少なくとも 1 つのフィールドを指定してください' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    // merge:true 確保 costSettings 不存在時自動建立 nested map
    await driverRef.set({ costSettings: {} }, { merge: true });
    await driverRef.update(update);

    return successResponse({ uid: auth.lineUid, updated: true });
  } catch (err) {
    console.error('[drivers/me/cost-settings.patch] Firestore update failed:', err);
    return serverError();
  }
});
