/**
 * LINE Richmenu API Client（P38 Phase 1）
 *
 * 對應 LINE Messaging API 圖文選單操作。雙 OA（passenger / driver）共用，
 * 差別僅在 Authorization header 用哪個 access token（透過 `getLineChannel(client)`）。
 *
 * Endpoint 分布：
 *   - 一般 API：https://api.line.me/v2/bot/richmenu/...
 *   - 圖片上傳：https://api-data.line.me/v2/bot/richmenu/{id}/content
 *
 * 錯誤策略：
 *   - 所有 helper 失敗 throw `LineApiError`（含 statusCode + details）
 *   - 5xx 自動 retry 1 次（exponential backoff 500ms）
 *   - 4xx 不 retry（regulartory rejection，retry 沒意義）
 *   - 404（取 default richmenu 時）視為 null 而非錯誤
 *
 * Image 限制：
 *   - format: image/jpeg or image/png
 *   - large: 2500×1686 / compact: 2500×843
 *   - size ≤ 1 MB
 *   - 寬高必須與 createRichmenu 時 size 完全一致
 */
import { getLineChannel, type LineClient } from '@@/utils/line-channel';

const API_BASE = 'https://api.line.me/v2/bot/richmenu';
const DATA_BASE = 'https://api-data.line.me/v2/bot/richmenu';
const USER_API_BASE = 'https://api.line.me/v2/bot/user';

const RETRY_DELAY_MS = 500;

// ── Types ─────────────────────────────────────────────────────────

export interface RichmenuSize {
  width: 2500;
  height: 1686 | 843;
}

export interface RichmenuBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RichmenuAction =
  | { type: 'uri'; uri: string; label?: string }
  | { type: 'message'; text: string; label?: string }
  | { type: 'postback'; data: string; displayText?: string; label?: string };

export interface RichmenuArea {
  bounds: RichmenuBounds;
  action: RichmenuAction;
}

export interface RichmenuCreatePayload {
  size: RichmenuSize;
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: RichmenuArea[];
}

export interface RichmenuRemote {
  richMenuId: string;
  size: RichmenuSize;
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: RichmenuArea[];
}

// ── Error ─────────────────────────────────────────────────────────

export class LineApiError extends Error {
  statusCode: number;
  details: unknown;
  constructor(message: string, statusCode: number, details: unknown) {
    super(message);
    this.name = 'LineApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

const _sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 取 access token；缺值 throw LineApiError(500) — 比 silent skip 更明確（admin push 失敗時要看到錯誤）
 */
const _getToken = (client: LineClient): string => {
  const { accessToken } = getLineChannel(client);
  if (!accessToken) {
    throw new LineApiError(
      `${client} access token not configured`,
      500,
      { client, hint: 'Set NUXT_LINE_CHANNEL_ACCESS_TOKEN_PASSENGER or _DRIVER' },
    );
  }
  return accessToken;
};

/**
 * 統一 fetch + retry（5xx 重試 1 次；4xx 直接拋）。
 *
 * @returns 解析後的 json（responseType='binary' 時回 Buffer）
 */
async function _lineFetch<T>(
  url: string,
  init: {
    method: 'GET' | 'POST' | 'DELETE';
    token: string;
    body?: object | Buffer;
    contentType?: string;
    responseType?: 'json' | 'binary' | 'none';
  },
): Promise<T> {
  const isBinary = init.body instanceof Buffer;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.token}`,
  };
  if (init.contentType) {
    headers['Content-Type'] = init.contentType;
  } else if (init.body && !isBinary) {
    headers['Content-Type'] = 'application/json';
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers,
        body: isBinary
          ? (init.body as Buffer)
          : (init.body ? JSON.stringify(init.body) : undefined),
      });
    } catch (err) {
      // 網路層失敗（DNS / connection reset 等）→ 視同 5xx retry 一次
      if (attempt <= 1) {
        await _sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new LineApiError(
        `LINE API network failure: ${(err as Error).message}`,
        599,
        { url, attempt },
      );
    }

    // 2xx success
    if (res.status >= 200 && res.status < 300) {
      if (init.responseType === 'none') return undefined as T;
      if (init.responseType === 'binary') {
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer) as unknown as T;
      }
      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new LineApiError(`LINE API response not valid JSON: ${text.slice(0, 200)}`, res.status, { url });
      }
    }

    // 5xx → retry 一次
    if (res.status >= 500 && attempt <= 1) {
      await _sleep(RETRY_DELAY_MS);
      continue;
    }

    // 4xx / 5xx retry 後仍失敗 → 拋
    let details: unknown = null;
    try {
      details = await res.json();
    } catch {
      try { details = await res.text(); } catch { /* swallow */ }
    }
    throw new LineApiError(
      `LINE API ${init.method} ${url} failed: ${res.status}`,
      res.status,
      details,
    );
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * POST /v2/bot/richmenu — 建立 richmenu 框架（不含圖；圖另呼 uploadRichmenuImage）
 *
 * @returns 新建立的 richMenuId
 */
export async function createRichmenu(
  client: LineClient,
  payload: RichmenuCreatePayload,
): Promise<{ richMenuId: string }> {
  const token = _getToken(client);
  return _lineFetch<{ richMenuId: string }>(API_BASE, {
    method: 'POST',
    token,
    body: payload as unknown as object,
  });
}

/**
 * POST /v2/bot/richmenu/{id}/content — 上傳圖片 binary（必須在 createRichmenu 後呼）
 *
 * 寬高比例必須與 createRichmenu 的 size 完全一致；否則 LINE 回 400。
 */
export async function uploadRichmenuImage(
  client: LineClient,
  richMenuId: string,
  imageBuffer: Buffer,
  mime: 'image/png' | 'image/jpeg',
): Promise<void> {
  const token = _getToken(client);
  await _lineFetch<undefined>(`${DATA_BASE}/${richMenuId}/content`, {
    method: 'POST',
    token,
    body: imageBuffer,
    contentType: mime,
    responseType: 'none',
  });
}

/**
 * POST /v2/bot/user/all/richmenu/{id} — 設為全 user 預設選單
 */
export async function setDefaultRichmenu(
  client: LineClient,
  richMenuId: string,
): Promise<void> {
  const token = _getToken(client);
  await _lineFetch<undefined>(`${USER_API_BASE}/all/richmenu/${richMenuId}`, {
    method: 'POST',
    token,
    responseType: 'none',
  });
}

/**
 * DELETE /v2/bot/user/all/richmenu — 清預設選單
 */
export async function clearDefaultRichmenu(client: LineClient): Promise<void> {
  const token = _getToken(client);
  await _lineFetch<undefined>(`${USER_API_BASE}/all/richmenu`, {
    method: 'DELETE',
    token,
    responseType: 'none',
  });
}

/**
 * GET /v2/bot/user/all/richmenu — 取得目前預設 richmenu id（404 → null）
 */
export async function getDefaultRichmenuId(client: LineClient): Promise<string | null> {
  const token = _getToken(client);
  try {
    const res = await _lineFetch<{ richMenuId: string }>(`${USER_API_BASE}/all/richmenu`, {
      method: 'GET',
      token,
    });
    return res?.richMenuId ?? null;
  } catch (err) {
    if (err instanceof LineApiError && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * GET /v2/bot/richmenu/list — 列 LINE 端所有 richmenu（含 detail）
 */
export async function listRichmenus(client: LineClient): Promise<RichmenuRemote[]> {
  const token = _getToken(client);
  const res = await _lineFetch<{ richmenus: RichmenuRemote[] }>(`${API_BASE}/list`, {
    method: 'GET',
    token,
  });
  return res?.richmenus ?? [];
}

/**
 * GET /v2/bot/richmenu/{id} — 單筆詳情
 */
export async function getRichmenuDetail(
  client: LineClient,
  richMenuId: string,
): Promise<RichmenuRemote | null> {
  const token = _getToken(client);
  try {
    return await _lineFetch<RichmenuRemote>(`${API_BASE}/${richMenuId}`, {
      method: 'GET',
      token,
    });
  } catch (err) {
    if (err instanceof LineApiError && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * DELETE /v2/bot/richmenu/{id} — 刪除 richmenu（會一併刪圖）
 *
 * 注意：若 richmenu 是 default，需先 clearDefaultRichmenu 才能刪（LINE 端會回 400）。
 * 本系統的 publish/unpublish 流程已 enforce 此順序，呼叫者通常不需顧慮。
 */
export async function deleteRichmenu(
  client: LineClient,
  richMenuId: string,
): Promise<void> {
  const token = _getToken(client);
  await _lineFetch<undefined>(`${API_BASE}/${richMenuId}`, {
    method: 'DELETE',
    token,
    responseType: 'none',
  });
}

/**
 * POST /v2/bot/user/{userId}/richmenu/{id} — 把 menu 綁定到特定 user（admin 測試用）
 */
export async function linkRichmenuToUser(
  client: LineClient,
  userId: string,
  richMenuId: string,
): Promise<void> {
  const token = _getToken(client);
  await _lineFetch<undefined>(`${USER_API_BASE}/${userId}/richmenu/${richMenuId}`, {
    method: 'POST',
    token,
    responseType: 'none',
  });
}

/**
 * DELETE /v2/bot/user/{userId}/richmenu — 解除 per-user 綁定
 */
export async function unlinkRichmenuFromUser(
  client: LineClient,
  userId: string,
): Promise<void> {
  const token = _getToken(client);
  await _lineFetch<undefined>(`${USER_API_BASE}/${userId}/richmenu`, {
    method: 'DELETE',
    token,
    responseType: 'none',
  });
}
