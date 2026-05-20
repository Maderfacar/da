/**
 * POST /nuxt-api/drivers/me/vehicle-photo-upload
 * 司機上傳單張車輛照片 → 回 signed URL（client 自行寫入 vehicleProfilePending.photos）
 * Phase 1B
 *
 * Multipart: { file }
 * 規格：
 *   - 檔案上限 5MB
 *   - jpg / png / webp 三種
 *   - Storage 路徑：drivers/{lineUid}/vehicle-profile/{timestamp}.{ext}
 *   - signed URL TTL：DRIVER_DOC_TTL_MS（4h；client 顯示用，存進 pending 後續可重簽）
 *
 * 認證：require driver self
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { DRIVER_DOC_TTL_MS } from '@@/utils/signed-url';

const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export default defineEventHandler(async (event) => {
  try {
    const auth = await getAuthFromEvent(event);
    if (!auth.ok) return authFailResponse(auth);

    if (!auth.roles.includes('driver')) {
      return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
    }

    const config = useRuntimeConfig();
    if (!config.firebaseServiceAccountJson) {
      return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
    }

    const formData = await readMultipartFormData(event);
    if (!formData || formData.length === 0) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }

    let file: { data: Buffer; filename?: string; type?: string } | undefined;
    for (const part of formData) {
      if (part.name === 'file' && part.filename) {
        file = part;
      }
    }

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
    const objectPath = `drivers/${auth.lineUid}/vehicle-profile/${timestamp}.${ext}`;

    const { storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const bucket = storage.bucket();
    const blob = bucket.file(objectPath);
    await blob.save(file.data, {
      contentType: mime,
      metadata: { contentType: mime, cacheControl: 'private, max-age=31536000' },
    });

    const [signedUrl] = await blob.getSignedUrl({
      action: 'read',
      expires: Date.now() + DRIVER_DOC_TTL_MS,
    });

    return successResponse({
      url: signedUrl,
      objectPath,
      sizeBytes: file.data.length,
      mime,
    });
  } catch (err) {
    console.error('[drivers/me/vehicle-photo-upload] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `上傳失敗：${detail}` : '上傳失敗，請稍後重試',
      en: detail ? `Upload failed: ${detail}` : 'Upload failed, please retry',
      ja: detail ? `アップロード失敗: ${detail}` : 'アップロードに失敗しました。再試行してください',
    });
  }
});
