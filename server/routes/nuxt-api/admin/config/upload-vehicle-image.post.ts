/**
 * POST /nuxt-api/admin/config/upload-vehicle-image
 *
 * 上傳車型卡圖片（exterior 主圖 / interior 內裝 / trunk 後車廂）。
 * 回傳 1 年 TTL 的 signed URL，由 admin 寫回 FleetVehicleDto.images.{slot}。
 *
 * Body：multipart/form-data
 *   - file：圖檔
 *   - slot：'exterior' | 'interior' | 'trunk'
 *
 * 規格（純 web 顯示，不送 LINE，可接受 webp）：
 *   - mime：image/jpeg / image/png / image/webp
 *   - size：< 5 MB
 *   - 建議尺寸：exterior 1600×900（16:9）、interior / trunk 1500×1000（3:2）
 *
 * 儲存路徑：`fleet-vehicles/{adminLineUid}/{slot}-{timestamp}.{ext}`
 *
 * 安全：canManageFleet 權限（同車型 CRUD）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_SLOTS = ['exterior', 'interior', 'trunk'] as const;
type VehicleImageSlot = (typeof ALLOWED_SLOTS)[number];

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要 fleet 管理權限', en: 'canManageFleet required', ja: 'fleet管理権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  try {
    const formData = await readMultipartFormData(event);
    if (!formData || formData.length === 0) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }

    const slotPart = formData.find((p) => p.name === 'slot');
    const slotRaw = slotPart?.data?.toString('utf-8').trim() ?? '';
    if (!ALLOWED_SLOTS.includes(slotRaw as VehicleImageSlot)) {
      return badRequestError({
        zh_tw: 'slot 必須是 exterior / interior / trunk',
        en: 'slot must be exterior / interior / trunk',
        ja: 'slot は exterior / interior / trunk のいずれかが必要です',
      });
    }
    const slot = slotRaw as VehicleImageSlot;

    const file = formData.find((p) => p.name === 'file' && p.filename);
    if (!file?.data) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }

    if (file.data.length > MAX_BYTES) {
      return badRequestError({ zh_tw: '檔案超過 5MB 限制', en: 'File exceeds 5MB limit', ja: 'ファイルが 5MB を超えています' });
    }

    const mime = file.type ?? 'application/octet-stream';
    if (!ALLOWED_MIMES.includes(mime)) {
      return badRequestError({
        zh_tw: '僅接受 jpg / png / webp',
        en: 'Only jpg / png / webp allowed',
        ja: 'jpg / png / webp のみ受付',
      });
    }

    const ext = EXT_MAP[mime] ?? 'bin';
    const timestamp = Date.now();
    const objectPath = `fleet-vehicles/${auth.lineUid}/${slot}-${timestamp}.${ext}`;

    const { storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const bucket = storage.bucket();
    const blob = bucket.file(objectPath);
    await blob.save(file.data, {
      contentType: mime,
      metadata: { contentType: mime, cacheControl: 'public, max-age=31536000' },
    });

    const [signedUrl] = await blob.getSignedUrl({
      action: 'read',
      expires: Date.now() + ONE_YEAR_MS,
    });

    return successResponse({
      url: signedUrl,
      objectPath,
      slot,
      sizeBytes: file.data.length,
      mime,
    });
  } catch (err) {
    console.error('[admin/config/upload-vehicle-image] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `上傳失敗：${detail}` : '上傳失敗，請稍後重試',
      en: detail ? `Upload failed: ${detail}` : 'Upload failed, please retry',
      ja: detail ? `アップロード失敗: ${detail}` : 'アップロードに失敗しました。再試行してください',
    });
  }
});
