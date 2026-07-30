/**
 * POST /nuxt-api/admin/config/themes/upload-hero-image
 *
 * 上傳乘客首頁 Hero 主圖到 Firebase Storage，回傳可注入 CSS url() 的網址，
 * 由前端接著呼叫 PATCH /themes/{id}/hero 寫回主題 doc（沿用車型圖兩段式流程）。
 *
 * Body：multipart/form-data
 *   - file：圖檔（image/jpeg / png / webp；< 5 MB）
 *   - themeId：目標主題 id（僅供路徑歸檔，實際綁定由 hero.patch 完成）
 *
 * 儲存路徑：`site-themes/{themeId}/hero-{timestamp}.{ext}`
 *
 * URL 策略：優先 makePublic() 取得永久公開 URL（季節主題可能跨年重用，避免 signed URL 過期）；
 *          若 bucket 啟用 uniform bucket-level access 使 makePublic 失敗，則 fallback 1 年 signed URL。
 *          兩種形式皆通過 isSafeThemeImageUrl（https + 影像副檔名，signed 允許尾端 query）。
 *
 * 權限：canManageThemes（預設僅 super）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// themeId 僅用於歸檔路徑，限英數與 - _，避免路徑穿越
const SAFE_THEME_ID_RE = /^[\w-]{1,64}$/;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageThemes')) {
    return forbiddenError({ zh_tw: '需要主題管理權限', en: 'canManageThemes required', ja: 'テーマ管理権限が必要です' });
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

    const themeIdPart = formData.find((p) => p.name === 'themeId');
    const themeId = themeIdPart?.data?.toString('utf-8').trim() ?? '';
    if (!SAFE_THEME_ID_RE.test(themeId)) {
      return badRequestError({ zh_tw: 'themeId 不合法', en: 'Invalid themeId', ja: 'themeId が不正です' });
    }

    const file = formData.find((p) => p.name === 'file' && p.filename);
    if (!file?.data) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }
    if (file.data.length > MAX_BYTES) {
      return badRequestError({ zh_tw: '檔案超過 5MB 限制', en: 'File exceeds 5MB limit', ja: 'ファイルが 5MB を超えています' });
    }

    const mime = file.type ?? 'application/octet-stream';
    if (!ALLOWED_MIMES.includes(mime)) {
      return badRequestError({ zh_tw: '僅接受 jpg / png / webp', en: 'Only jpg / png / webp allowed', ja: 'jpg / png / webp のみ受付' });
    }

    const ext = EXT_MAP[mime] ?? 'bin';
    const objectPath = `site-themes/${themeId}/hero-${Date.now()}.${ext}`;

    const { storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const bucket = storage.bucket();
    const blob = bucket.file(objectPath);
    await blob.save(file.data, {
      contentType: mime,
      metadata: { contentType: mime, cacheControl: 'public, max-age=31536000' },
    });

    // 優先公開 URL（永久）；makePublic 失敗（uniform bucket-level access）→ fallback signed URL（1 年）
    let url: string;
    try {
      await blob.makePublic();
      url = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;
    } catch (pubErr) {
      console.warn('[admin/config/themes/upload-hero-image] makePublic 失敗，改用 signed URL：', pubErr);
      const [signedUrl] = await blob.getSignedUrl({ action: 'read', expires: Date.now() + ONE_YEAR_MS });
      url = signedUrl;
    }

    return successResponse({ url, objectPath, sizeBytes: file.data.length, mime });
  } catch (err) {
    console.error('[admin/config/themes/upload-hero-image] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `上傳失敗：${detail}` : '上傳失敗，請稍後重試',
      en: detail ? `Upload failed: ${detail}` : 'Upload failed, please retry',
      ja: detail ? `アップロード失敗: ${detail}` : 'アップロードに失敗しました。再試行してください',
    });
  }
});
