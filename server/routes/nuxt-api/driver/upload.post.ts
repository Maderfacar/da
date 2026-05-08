/**
 * POST /nuxt-api/driver/upload
 * 司機申請證件圖片上傳
 *
 * 流程：
 *   1. 接收 multipart/form-data（單一檔案 + docType + lineUserId）
 *   2. 驗證檔案大小 / MIME / docType
 *   3. 上傳至 Firebase Storage 路徑 `drivers/{lineUserId}/{docType}-{timestamp}.{ext}`
 *   4. 產生長效 signed URL（1 年）回傳給 client，存進 driverApplication.documents
 *
 * docType 限制：licenseUrl | registrationUrl | insuranceUrl | goodCitizenUrl
 *   - 駕照 / 行照 / 保險卡 / 良民證
 *
 * 安全：
 *   - 檔案上限 5MB
 *   - 僅接受 jpg / png / pdf
 *   - lineUserId 由 client 帶入；正式環境建議改從 ID token 解出 uid 確保 owner-only
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

const ALLOWED_DOC_TYPES = ['licenseUrl', 'registrationUrl', 'insuranceUrl', 'goodCitizenUrl'] as const;
type DocType = typeof ALLOWED_DOC_TYPES[number];

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig();
    if (!config.firebaseServiceAccountJson) {
      return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
    }

    const formData = await readMultipartFormData(event);
    if (!formData || formData.length === 0) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }

    // 從 multipart 解析 docType / lineUserId / file
    let docType: string | undefined;
    let lineUserId: string | undefined;
    let file: { data: Buffer; filename?: string; type?: string } | undefined;
    for (const part of formData) {
      if (part.name === 'docType' && part.data) {
        docType = part.data.toString('utf-8');
      } else if (part.name === 'lineUserId' && part.data) {
        lineUserId = part.data.toString('utf-8');
      } else if (part.name === 'file' && part.filename) {
        file = part;
      }
    }

    if (!docType || !ALLOWED_DOC_TYPES.includes(docType as DocType)) {
      return badRequestError({ zh_tw: 'docType 無效', en: 'Invalid docType', ja: 'docType が無効です' });
    }
    if (!lineUserId) {
      return badRequestError({ zh_tw: '缺少 lineUserId', en: 'Missing lineUserId', ja: 'lineUserId が必要です' });
    }
    if (!file?.data) {
      return badRequestError({ zh_tw: '沒有收到檔案', en: 'No file received', ja: 'ファイルが受信できませんでした' });
    }

    // 驗證檔案大小
    if (file.data.length > MAX_BYTES) {
      return badRequestError({ zh_tw: '檔案超過 5MB 限制', en: 'File exceeds 5MB limit', ja: 'ファイルが 5MB を超えています' });
    }

    // 驗證 MIME
    const mime = file.type ?? 'application/octet-stream';
    if (!ALLOWED_MIMES.includes(mime)) {
      return badRequestError({ zh_tw: '僅接受 jpg / png / pdf', en: 'Only jpg / png / pdf allowed', ja: 'jpg / png / pdf のみ受付' });
    }

    const ext = EXT_MAP[mime] ?? 'bin';
    const timestamp = Date.now();
    const objectPath = `drivers/${lineUserId}/${docType}-${timestamp}.${ext}`;

    // 上傳至 Firebase Storage
    const { storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const bucket = storage.bucket();
    const blob = bucket.file(objectPath);
    await blob.save(file.data, {
      contentType: mime,
      metadata: { contentType: mime, cacheControl: 'private, max-age=31536000' },
    });

    // 產生長效 signed URL（1 年），admin / owner 端可直接顯示圖片，無需配置 Storage Rules public
    const [signedUrl] = await blob.getSignedUrl({
      action: 'read',
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });

    return successResponse({
      docType,
      url: signedUrl,
      objectPath,
      sizeBytes: file.data.length,
      mime,
    });
  } catch (err) {
    // 把 err.message 暴露給 client，方便定位問題（如 "The specified bucket does not exist"
    // 表示 storageBucket 名稱不對；"Permission denied" 表示 Service Account 缺權限）。
    // 不會洩漏 secret，只是 SDK 訊息。
    console.error('[driver/upload] failed:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return serverError({
      zh_tw: `上傳失敗：${detail}`,
      en: `Upload failed: ${detail}`,
      ja: `アップロード失敗: ${detail}`,
    });
  }
});
