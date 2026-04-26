interface I18nMsg { zh_tw: string; en: string; ja: string }

interface UnifiedResponse<T> {
  data: T
  status: { code: number; message: I18nMsg }
}

export function successResponse<T>(data: T): UnifiedResponse<T> {
  return { data, status: { code: 200, message: { zh_tw: '成功', en: 'Success', ja: '成功' } } };
}

export function badRequestError(msg: I18nMsg): UnifiedResponse<Record<string, never>> {
  return { data: {}, status: { code: 400, message: msg } };
}

export function unauthorizedError(msg?: I18nMsg): UnifiedResponse<Record<string, never>> {
  return { data: {}, status: { code: 401, message: msg ?? { zh_tw: '未授權', en: 'Unauthorized', ja: '未承認' } } };
}

export function forbiddenError(msg?: I18nMsg): UnifiedResponse<Record<string, never>> {
  return { data: {}, status: { code: 403, message: msg ?? { zh_tw: '禁止存取', en: 'Forbidden', ja: 'アクセス禁止' } } };
}

export function notFoundError(msg?: I18nMsg): UnifiedResponse<Record<string, never>> {
  return { data: {}, status: { code: 404, message: msg ?? { zh_tw: '找不到資源', en: 'Not found', ja: 'リソースが見つかりません' } } };
}

export function serverError(msg?: I18nMsg): UnifiedResponse<Record<string, never>> {
  return { data: {}, status: { code: 500, message: msg ?? { zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' } } };
}
