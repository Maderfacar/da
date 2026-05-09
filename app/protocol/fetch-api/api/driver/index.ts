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
