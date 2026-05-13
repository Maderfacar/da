/**
 * POST /nuxt-api/admin/announcements/upload-cover
 *
 * 上傳公告封面圖。回傳 signed URL（1 年 TTL，給 LINE Flex + App 內顯示用）。
 *
 * Body：multipart/form-data，欄位 `file`（圖檔）
 *
 * 規格（對齊 LINE Flex Hero image）：
 *   - mime：image/jpeg / image/png / image/gif（不含 webp，LINE 不支援）
 *   - size：< 10 MB
 *   - 寬高建議 < 2048 px（client 端應壓縮，server 不做轉檔）
 *
 * 儲存路徑：`announcements/{adminLineUid}/cover-{timestamp}.{ext}`
 *
 * 安全：
 *   - canBroadcast 權限
 *   - signed URL 1 年 TTL（公告圖屬公開內容，非敏感資料）
 *
 * Phase 2 不寫 audit log（純檔案上傳；正式落地是 PATCH 帶 coverImageUrl 時 audit）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
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

    const file = formData.find((p) => p.name === 'file' && p.filename);
    if (!file?.data) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }

    if (file.data.length > MAX_BYTES) {
      return badRequestError({ zh_tw: '檔案超過 10MB 限制', en: 'File exceeds 10MB limit', ja: 'ファイルが 10MB を超えています' });
    }

    const mime = file.type ?? 'application/octet-stream';
    if (!ALLOWED_MIMES.includes(mime)) {
      return badRequestError({ zh_tw: '僅接受 jpg / png / gif', en: 'Only jpg / png / gif allowed', ja: 'jpg / png / gif のみ受付' });
    }

    const ext = EXT_MAP[mime] ?? 'bin';
    const timestamp = Date.now();
    const objectPath = `announcements/${auth.lineUid}/cover-${timestamp}.${ext}`;

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
      sizeBytes: file.data.length,
      mime,
    });
  } catch (err) {
    console.error('[admin/announcements/upload-cover] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `上傳失敗：${detail}` : '上傳失敗，請稍後重試',
      en: detail ? `Upload failed: ${detail}` : 'Upload failed, please retry',
      ja: detail ? `アップロード失敗: ${detail}` : 'アップロードに失敗しました。再試行してください',
    });
  }
});
