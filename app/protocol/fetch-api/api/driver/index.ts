import methods from '@/protocol/fetch-api/methods';

export interface DriverApplyBody {
  lineUserId: string
  driverName: string
  phone: string
  plateNumber: string
  vehicleType: 'sedan' | 'mpv' | 'suv' | 'van'
  bankCode: string
  bankAccount: string
  documents: {
    licenseUrl: string
    registrationUrl: string
    insuranceUrl: string
    goodCitizenUrl: string
  }
}

export interface DriverApplyResponse {
  applied: boolean
  appliedAt: string
  cooldownUntil?: string
}

export interface UploadDocumentResponse {
  docType: 'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl'
  url: string
  objectPath: string
  sizeBytes: number
  mime: string
}

// P19 hotfix：URL path 含 'line:' prefix（即 'line:Uxxx'）會在 Vercel/Nitro routing
// 觸發冒號相關 edge case 導致 404；統一在 client side strip prefix，server 端原本就
// 對 `[id]` `[uid]` 兩種格式都有 normalize 邏輯，雙端兼容。
const _stripLinePrefix = (id: string): string => (id.startsWith('line:') ? id.slice(5) : id);

export const UpdateDriverLocation = (driverId: string, params: UpdateLocationParams) =>
  methods.put<{ ok: boolean }>(`/nuxt-api/drivers/${_stripLinePrefix(driverId)}/location`, params);

export const GetAvailableDrivers = () =>
  methods.get<DriverInfo[]>('/nuxt-api/drivers/available', {});

export const GetDriverStats = (uid: string) =>
  methods.get<DriverStats>(`/nuxt-api/drivers/${_stripLinePrefix(uid)}/stats`, {});

/** 司機申請送出（寫 driverApplication + arrayUnion 'driver' + approved=false） */
export const ApplyDriver = (body: DriverApplyBody) =>
  methods.post<DriverApplyResponse>('/nuxt-api/driver/apply', body);

// ── P26 driver self-edit ───────────────────────────────────────────

/** 司機自編 profile（目前只開放 phone） */
export const UpdateDriverSelfProfile = (body: { phone: string }) =>
  methods.patch<{ uid: string; updated: boolean }>('/nuxt-api/drivers/me/profile', body);

/**
 * 司機自上傳新證件 — 兩步流程的第 2 步：
 *   1. 先用 UploadDriverDocument 上傳檔案拿 signed URL
 *   2. 用本 API 把 (docType, url) 寫入 drivers.application.documentsPending.{docType}
 * admin 核准前不會覆蓋現用證件
 */
export const ReplaceDriverDocument = (body: {
  docType: 'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl';
  url: string;
}) => methods.post<{ docType: string; status: 'pending' }>('/nuxt-api/drivers/me/document-replace', body);

/**
 * 上傳司機證件圖片至 Firebase Storage，回傳 signed URL
 * 注意：此端點接受 multipart/form-data，必須直接使用 fetch 而非 methods.post
 *
 * P14：手動帶 Firebase ID token（multipart 不走 methods.ts onRequest 攔截器）
 */
export const UploadDriverDocument = async (params: {
  file: File;
  docType: 'licenseUrl' | 'registrationUrl' | 'insuranceUrl' | 'goodCitizenUrl';
  lineUserId: string;
}) => {
  const fd = new FormData();
  fd.append('file', params.file);
  fd.append('docType', params.docType);
  fd.append('lineUserId', params.lineUserId);

  const idToken = await StoreAuth().GetFreshIdToken();
  const headers: Record<string, string> = idToken ? { Authorization: `Bearer ${idToken}` } : {};

  const res = await $fetch<{ data: UploadDocumentResponse; status: { code: number; message: { zh_tw: string; en: string; ja: string } } }>(
    '/nuxt-api/driver/upload',
    { method: 'POST', body: fd, headers },
  );
  return res;
};
