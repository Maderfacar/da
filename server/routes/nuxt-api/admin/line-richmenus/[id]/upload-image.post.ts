/**
 * POST /nuxt-api/admin/line-richmenus/[id]/upload-image
 *
 * 上傳 richmenu 圖片到 Firebase Storage，回傳 signed URL + 寬高 + 大小。
 *
 * Body：multipart/form-data，欄位 `file`（PNG 或 JPEG）
 *
 * 規格（LINE 嚴格要求）：
 *   - mime：image/png / image/jpeg
 *   - 寬高：2500×1686（large）或 2500×843（compact）
 *   - size：≤ 1 MB
 *
 * 儲存路徑：`line-richmenus/{channel}/{id}/image-{timestamp}.{ext}`
 *
 * 同步寫回 doc：imageUrl / imageObjectPath / imageSize / imageBytes / imageMime / updatedAt
 *
 * **限制**：active 不允許換圖（避免 LINE 線上 menu 與 doc 不一致）；需先 unpublish
 *
 * 權限：canBroadcast
 * 副作用：audit log `line.richmenu.update` with payload.fields=['image']
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { VALID_SIZES, type LineRichmenuDoc } from '@@/utils/line-richmenu-doc';
import type { RichmenuSize } from '@@/utils/line-richmenu';

const MAX_BYTES = 1 * 1024 * 1024; // 1MB
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

/**
 * 從 PNG/JPEG binary buffer 讀寬高（無外部依賴）
 *
 * - PNG：8-byte signature + IHDR chunk → bytes 16..20 width / 20..24 height（big-endian）
 * - JPEG：scan SOF0/SOF1/SOF2/SOF3 marker (0xFFC0..C3) → 後 height(2) / width(2)
 *
 * 無法解析回 null（呼叫端視為無效圖檔）
 */
function readImageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png' && buf.length >= 24) {
    // 0x89 PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
    return null;
  }

  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    // JPEG SOI: FF D8
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      // SOF markers (excluding DHT FFC4, JPG FFC8, DAC FFCC, RST FFD0-D7)
      if (
        (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)
      ) {
        // segment length (2) + precision (1) + height (2) + width (2)
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        if (width > 0 && height > 0) return { width, height };
        return null;
      }
      // 其他 marker：跳過 segment（marker(2) + length(2) + payload）
      const segLen = buf.readUInt16BE(i + 2);
      if (segLen < 2) return null;
      i += 2 + segLen;
    }
    return null;
  }

  return null;
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
    if (existing.status === 'active') {
      return badRequestError({
        zh_tw: 'active 狀態不允許換圖，請先 unpublish',
        en: 'Cannot replace image while active; unpublish first',
        ja: 'active の richmenu は画像を差し替えられません',
      });
    }

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
    if (mime !== 'image/png' && mime !== 'image/jpeg') {
      return badRequestError({
        zh_tw: '僅支援 PNG / JPEG',
        en: 'Only PNG / JPEG allowed',
        ja: 'PNG / JPEG のみ',
      });
    }

    // 驗 size
    if (file.data.length > MAX_BYTES) {
      return badRequestError({
        zh_tw: `檔案大小不可超過 ${(MAX_BYTES / 1024 / 1024)}MB（LINE 限制）`,
        en: `File exceeds ${(MAX_BYTES / 1024 / 1024)}MB (LINE limit)`,
        ja: `ファイルは ${(MAX_BYTES / 1024 / 1024)}MB 以下（LINE 制限）`,
      });
    }

    // 驗寬高
    const dims = readImageSize(file.data, mime);
    if (!dims) {
      return badRequestError({
        zh_tw: '無法解析圖片寬高，請使用標準 PNG / JPEG',
        en: 'Cannot parse image dimensions',
        ja: '画像サイズを解析できません',
      });
    }
    const sizeMatch = VALID_SIZES.find((v) => v.width === dims.width && v.height === dims.height);
    if (!sizeMatch) {
      return badRequestError({
        zh_tw: `圖片寬高需為 2500×1686 或 2500×843，實際為 ${dims.width}×${dims.height}`,
        en: `Image must be 2500×1686 or 2500×843, got ${dims.width}×${dims.height}`,
        ja: `画像は 2500×1686 または 2500×843、実際は ${dims.width}×${dims.height}`,
      });
    }

    // 換圖：清舊圖片（best-effort，不阻擋上傳）
    if (existing.imageObjectPath) {
      try {
        await storage.bucket().file(existing.imageObjectPath).delete({ ignoreNotFound: true });
      } catch (err) {
        console.warn('[upload-image] old storage delete failed (silent):', err);
      }
    }

    // 上傳
    const ext = EXT_MAP[mime] ?? 'bin';
    const timestamp = Date.now();
    const objectPath = `line-richmenus/${existing.channel}/${id}/image-${timestamp}.${ext}`;
    const blob = storage.bucket().file(objectPath);
    await blob.save(file.data, {
      contentType: mime,
      metadata: { contentType: mime, cacheControl: 'public, max-age=31536000' },
    });
    const [signedUrl] = await blob.getSignedUrl({
      action: 'read',
      expires: Date.now() + ONE_YEAR_MS,
    });

    // 寫回 doc
    const sizeForDoc: RichmenuSize = sizeMatch;
    await ref.update({
      imageUrl: signedUrl,
      imageObjectPath: objectPath,
      imageSize: sizeForDoc,
      imageBytes: file.data.length,
      imageMime: mime,
      // 換圖後既有 areas 可能不再相符 LINE size（雖然 size 固定為 2 種，但 admin 應重審）：
      // 第一版不自動清 areas，由 admin 在 patch areas 時自然修正
      // 換圖後 LINE 端先前的 lineRichMenuId 即使存在也已無效（new image 必須重 push）→ 重置 sync 狀態
      lineRichMenuId: null,
      syncStatus: 'not_synced',
      syncError: null,
      lastSyncedAt: null,
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.update',
      targetType: 'line_richmenu',
      targetId: id,
      payload: { fields: ['image'], bytes: file.data.length, size: sizeForDoc, mime },
    });

    return successResponse({
      url: signedUrl,
      objectPath,
      sizeBytes: file.data.length,
      width: sizeForDoc.width,
      height: sizeForDoc.height,
      mime,
    });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/upload-image] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `上傳失敗：${detail}` : '上傳失敗',
      en: detail ? `Upload failed: ${detail}` : 'Upload failed',
      ja: detail ? `アップロード失敗: ${detail}` : 'アップロード失敗',
    });
  }
});
