/**
 * Signed URL helper — driver 證件 GCS URL 重簽工具
 *
 * 背景：driver/upload.post.ts 自 P28 起把 signed URL TTL 從 1 年縮短為 4 小時，
 * 避免證件 URL 一旦外洩可被未授權者下載長達 1 年。所有顯示證件的端點 / 頁面
 * 在回傳給 client 之前，必須透過本 helper 用 objectPath 重新簽發 4h URL。
 *
 * 設計：
 * - GCS V4 signed URL 結構：https://storage.googleapis.com/{bucket}/{objectPath}?X-Goog-...
 * - 從既有 URL 反推 bucket + objectPath，再用 admin SDK 重簽
 * - resign 失敗時 fallback 回傳原 URL（讓既有 1 年 URL 的舊資料仍可顯示）
 * - 僅支援本專案 storage bucket 的 URL（非自家 URL 直接 fallback）
 */

import type { Storage } from 'firebase-admin/storage';

// 預設 TTL 4 小時（單位：毫秒）
export const DRIVER_DOC_TTL_MS = 4 * 60 * 60 * 1000;

const GCS_HOST = 'https://storage.googleapis.com/';

/**
 * 從 GCS signed URL 反推 bucket + objectPath。
 * 解析失敗回 null。
 */
export function reverseParseObjectPath(url: string | null | undefined): { bucket: string; objectPath: string } | null {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith(GCS_HOST)) return null;
  try {
    const parsed = new URL(url);
    // pathname 形如 /{bucket}/{objectPath...}
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const bucket = segments[0]!;
    const objectPath = segments.slice(1).map(decodeURIComponent).join('/');
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  } catch {
    return null;
  }
}

/**
 * 從既有 GCS signed URL 重簽一份新 TTL 的 URL。
 * 反推失敗 / 非 GCS URL → 直接回原 URL（不阻擋舊資料顯示）。
 */
export async function resignGcsUrl(storage: Storage, url: string | null | undefined, ttlMs: number = DRIVER_DOC_TTL_MS): Promise<string> {
  if (!url) return '';
  const parsed = reverseParseObjectPath(url);
  if (!parsed) return url;
  try {
    const bucket = storage.bucket(parsed.bucket);
    const [fresh] = await bucket.file(parsed.objectPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + ttlMs,
    });
    return fresh;
  } catch (err) {
    console.warn('[signed-url] resign failed, fallback to original:', err);
    return url;
  }
}

/**
 * 批次 resign driver application documents（含 documentsPending）。
 * - documents：Record<docType, urlString>
 * - documentsPending：Record<docType, { url, ...meta }>
 *
 * 回傳新物件（不 mutate 原資料）。
 */
export async function resignDriverDocuments<T extends { documents?: Record<string, string>; documentsPending?: Record<string, { url?: string; [k: string]: unknown }> }>(
  storage: Storage,
  application: T | null | undefined,
  ttlMs: number = DRIVER_DOC_TTL_MS,
): Promise<T | null | undefined> {
  if (!application) return application;
  const out = { ...application } as T;

  if (application.documents) {
    const fresh: Record<string, string> = {};
    await Promise.all(
      Object.entries(application.documents).map(async ([k, v]) => {
        fresh[k] = await resignGcsUrl(storage, v, ttlMs);
      }),
    );
    (out as { documents?: Record<string, string> }).documents = fresh;
  }

  if (application.documentsPending) {
    const fresh: Record<string, { url?: string; [k: string]: unknown }> = {};
    await Promise.all(
      Object.entries(application.documentsPending).map(async ([k, entry]) => {
        const e = entry as { url?: string; [k: string]: unknown };
        fresh[k] = { ...e, url: await resignGcsUrl(storage, e.url, ttlMs) };
      }),
    );
    (out as { documentsPending?: Record<string, { url?: string; [k: string]: unknown }> }).documentsPending = fresh;
  }

  return out;
}
