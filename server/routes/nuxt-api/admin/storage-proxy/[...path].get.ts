/**
 * GET /nuxt-api/admin/storage-proxy/[...path]
 *
 * P44b-FU2：Firebase Storage 圖檔同源 proxy。
 *
 * 目的：解決 client canvas（圖層合成器）讀 cross-origin Storage 圖時的 CORS / tainted canvas 問題。
 * 走本 endpoint 後，圖檔來源 host = 本站 vercel.app（同源）→ canvas 不會 tainted → toBlob 可正常匯出。
 *
 * - 公開讀（無 admin auth）：path 限定 ALLOWED_PREFIXES 內白名單，避免被當任意 storage 探索工具
 * - server 端 read stream 後 pipe 回 client，無 buffer 整檔（記憶體 friendly）
 * - 30s edge cache + 300s SWR（admin 重複載入快）
 *
 * 範例：
 *   /nuxt-api/admin/storage-proxy/line-richmenus/passenger/abc/layers/1234.png
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

const ALLOWED_PREFIXES = [
  'line-richmenus/',
  'notification-templates/',
];

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

export default defineEventHandler(async (event) => {
  const raw = event.context.params?.path;
  const objectPath = Array.isArray(raw) ? raw.join('/') : (raw ?? '');
  if (!objectPath || objectPath.length > 1024) {
    return notFoundError({ zh_tw: 'path 缺失', en: 'path required', ja: 'path required' });
  }

  // 防 path traversal
  if (objectPath.includes('..') || objectPath.includes('//') || objectPath.startsWith('/')) {
    return badRequestError({ zh_tw: '不合法的 path', en: 'invalid path', ja: 'invalid path' });
  }

  // 白名單前綴
  if (!ALLOWED_PREFIXES.some((p) => objectPath.startsWith(p))) {
    return forbiddenError({ zh_tw: 'path 不在允許範圍', en: 'path not allowed', ja: 'path not allowed' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { storage } = useFirebaseAdmin(firebaseServiceAccountJson);
    const file = storage.bucket().file(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      return notFoundError({ zh_tw: '檔案不存在', en: 'not found', ja: 'not found' });
    }

    const [metadata] = await file.getMetadata();
    const contentType = typeof metadata.contentType === 'string' ? metadata.contentType : 'application/octet-stream';
    if (!ALLOWED_MIMES.has(contentType)) {
      return forbiddenError({ zh_tw: 'mime 不允許', en: 'mime not allowed', ja: 'mime not allowed' });
    }

    setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600');
    // 同源請求即使不加 ACAO 也 work；保留以便未來 cross-origin（admin 跨網域）情境
    setHeader(event, 'Access-Control-Allow-Origin', '*');
    setHeader(event, 'Cross-Origin-Resource-Policy', 'cross-origin');
    if (typeof metadata.size === 'string') {
      setHeader(event, 'Content-Length', metadata.size);
    }

    return sendStream(event, file.createReadStream());
  } catch (err) {
    console.error('[admin/storage-proxy] failed:', err);
    return serverError();
  }
});
