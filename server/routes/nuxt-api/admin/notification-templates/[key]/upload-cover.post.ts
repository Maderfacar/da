/**
 * POST /nuxt-api/admin/notification-templates/[key]/upload-cover
 *
 * 上傳 template 封面圖到 Firebase Storage。
 *
 * Body：multipart/form-data，欄位 `file`（PNG / JPEG / GIF）
 *
 * 規格（對齊 LINE Flex Hero image）：
 *   - mime：image/jpeg / image/png / image/gif（不含 webp）
 *   - size：< 10 MB
 *   - 寬高建議 < 2048 px（client 端應壓縮）
 *
 * 儲存路徑：`notification-templates/{key}/cover-{timestamp}.{ext}`
 *
 * **注意**：本 endpoint 只上傳圖 + 回 signed URL；admin 端拿到 URL 後須再 PUT 寫進 doc。
 *
 * 權限：canBroadcast
 */
import { randomUUID } from 'node:crypto';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { TEMPLATE_REGISTRY } from '@@/utils/template-registry';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024;

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
};

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const key = getRouterParam(event, 'key');
  if (!key) {
    return badRequestError({ zh_tw: 'key 缺失', en: 'key required', ja: 'key が必要' });
  }
  if (!TEMPLATE_REGISTRY[key]) {
    return notFoundError({ zh_tw: '未知的 template key', en: 'Unknown template key', ja: '未知の template key' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const formData = await readMultipartFormData(event);
    if (!formData || formData.length === 0) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file', ja: 'ファイル未受信' });
    }
    const file = formData.find((p) => p.name === 'file' && p.filename);
    if (!file?.data) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file', ja: 'ファイル未受信' });
    }
    if (file.data.length > MAX_BYTES) {
      return badRequestError({ zh_tw: '檔案超過 10MB 限制', en: 'File exceeds 10MB', ja: '10MB を超えています' });
    }
    const mime = file.type ?? 'application/octet-stream';
    if (!ALLOWED_MIMES.includes(mime)) {
      return badRequestError({ zh_tw: '僅接受 jpg / png / gif', en: 'Only jpg/png/gif', ja: 'jpg/png/gif のみ' });
    }

    const ext = EXT_MAP[mime] ?? 'bin';
    const timestamp = Date.now();
    const objectPath = `notification-templates/${key}/cover-${timestamp}.${ext}`;

    // 改用 Firebase Storage Hosting download URL（與 P44b-FU layer image 一致）：
    //   - URL 較短（~200-300 chars，原 V4 signed URL ~600-800 chars，避免超 LINE Flex 限制）
    //   - 不會 1 年後失效（LINE Flex push 比較不會掉圖）
    //   - 預設支援 CORS（未來如需 client 端 canvas 處理也 OK）
    const { storage } = useFirebaseAdmin(firebaseServiceAccountJson);
    const bucket = storage.bucket();
    const blob = bucket.file(objectPath);
    const downloadToken = randomUUID();
    await blob.save(file.data, {
      contentType: mime,
      metadata: {
        contentType: mime,
        cacheControl: 'public, max-age=31536000',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

    return successResponse({
      url: downloadUrl,
      objectPath,
      sizeBytes: file.data.length,
      mime,
    });
  } catch (err) {
    console.error('[admin/notification-templates/[key]/upload-cover] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `上傳失敗：${detail}` : '上傳失敗',
      en: detail ? `Upload failed: ${detail}` : 'Upload failed',
      ja: detail ? `アップロード失敗: ${detail}` : 'アップロード失敗',
    });
  }
});
