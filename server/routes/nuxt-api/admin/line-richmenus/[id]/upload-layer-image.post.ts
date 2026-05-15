/**
 * POST /nuxt-api/admin/line-richmenus/[id]/upload-layer-image
 *
 * P44b-FU：圖層合成器上傳自訂圖片（image layer 用），與 menu 成品圖（upload-image）區隔。
 *
 * 差異：
 *   - 不驗 2500×1686 / 2500×843（layer 會被 canvas 縮放）
 *   - 容許 PNG / JPEG / WebP（WebP icon 省 30-60% size）
 *   - 大小 ≤ 2 MB
 *   - 不寫回 doc（layer.imageUrl 由 client 收到 URL 後在 composer 內 patchLayer 設）
 *   - active richmenu 也允許上傳（純 admin metadata 編輯，與 patch layers 一致）
 *
 * Storage 路徑：`line-richmenus/{channel}/{id}/layers/{timestamp}.{ext}`
 *
 * 權限：canBroadcast
 * 副作用：audit log `line.richmenu.update` with payload.fields=['layer-image']
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import type { LineRichmenuDoc } from '@@/utils/line-richmenu-doc';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface UploadLayerImageRes {
  url: string;
  objectPath: string;
  sizeBytes: number;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: 'id 缺失', en: 'id is required', ja: 'id が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db, storage } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('line_richmenus').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: 'richmenu 不存在', en: 'Richmenu not found', ja: 'richmenu が見つかりません' });
    }
    const existing = snap.data() as LineRichmenuDoc;

    // 讀 multipart
    const formData = await readMultipartFormData(event);
    if (!formData || formData.length === 0) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }
    const file = formData.find((p) => p.name === 'file' && p.filename);
    if (!file?.data) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }

    // 驗 mime
    const rawMime = file.type ?? 'application/octet-stream';
    const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    if (!ALLOWED_MIMES.has(mime)) {
      return badRequestError({
        zh_tw: '僅支援 PNG / JPEG / WebP',
        en: 'Only PNG / JPEG / WebP allowed',
        ja: 'PNG / JPEG / WebP のみ',
      });
    }

    // 驗 size
    if (file.data.length > MAX_BYTES) {
      return badRequestError({
        zh_tw: `檔案大小不可超過 ${MAX_BYTES / 1024 / 1024} MB`,
        en: `File exceeds ${MAX_BYTES / 1024 / 1024} MB`,
        ja: `ファイルは ${MAX_BYTES / 1024 / 1024} MB 以下`,
      });
    }

    // 上傳到 Storage
    const ext = EXT_MAP[mime] ?? 'bin';
    const timestamp = Date.now();
    const objectPath = `line-richmenus/${existing.channel}/${id}/layers/${timestamp}.${ext}`;
    const blob = storage.bucket().file(objectPath);
    await blob.save(file.data, {
      contentType: mime,
      metadata: { contentType: mime, cacheControl: 'public, max-age=31536000' },
    });

    /**
     * 回 same-origin proxy URL（P44b-FU2）：
     *
     * - layer image 純 admin 內部用（client canvas 合成藍圖），LINE server 不需直接讀
     * - 走 /nuxt-api/admin/storage-proxy/{path} 同源 GET → canvas 不 tainted → toBlob 可匯出
     * - 對既有 Storage CORS 設定 / hosting URL 行為完全免依賴
     */
    const proxyUrl = `/nuxt-api/admin/storage-proxy/${objectPath}`;

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.update',
      targetType: 'line_richmenu',
      targetId: id,
      payload: { fields: ['layer-image'], bytes: file.data.length, mime, objectPath },
    });

    return successResponse<UploadLayerImageRes>({
      url: proxyUrl,
      objectPath,
      sizeBytes: file.data.length,
      mime: mime as 'image/png' | 'image/jpeg' | 'image/webp',
    });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/upload-layer-image] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `上傳失敗：${detail}` : '上傳失敗',
      en: detail ? `Upload failed: ${detail}` : 'Upload failed',
      ja: detail ? `アップロード失敗: ${detail}` : 'アップロード失敗',
    });
  }
});
