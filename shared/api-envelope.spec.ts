import { describe, it, expect } from 'vitest';
import { toApiEnvelope, isApiEnvelope, API_NETWORK_ERROR_CODE } from './api-envelope';

const SUCCESS = 200;

describe('isApiEnvelope', () => {
  it('有數字 status.code 才算 envelope', () => {
    expect(isApiEnvelope({ data: null, status: { code: 400, message: {} } })).toBe(true);
    expect(isApiEnvelope({ status: { code: 200 } })).toBe(true);
  });

  it('原始 Error / 空值 / 字串都不是 envelope', () => {
    expect(isApiEnvelope(new Error('Network request failed'))).toBe(false);
    expect(isApiEnvelope(undefined)).toBe(false);
    expect(isApiEnvelope(null)).toBe(false);
    expect(isApiEnvelope('timeout')).toBe(false);
    expect(isApiEnvelope({ status: 'ok' })).toBe(false);
    expect(isApiEnvelope({ status: { code: '400' } })).toBe(false); // code 必須是數字
  });
});

describe('toApiEnvelope', () => {
  it('迴歸：傳輸層失敗後 res.status.code 必須可讀，不得再爆 unhandled rejection', () => {
    // 2026-08-20 prod 實測：undefined is not an object (evaluating 'h.status.code')
    for (const thrown of [new Error('Network request failed'), undefined, null, 'timeout', 0]) {
      const res = toApiEnvelope(thrown);
      expect(() => res.status.code).not.toThrow();
      expect(typeof res.status.code).toBe('number');
    }
  });

  it('傳輸層失敗回 networkError，且必然不等於 success（既有防呆會走失敗分支）', () => {
    const res = toApiEnvelope(new Error('fetch failed'));
    expect(res.status.code).toBe(API_NETWORK_ERROR_CODE);
    expect(res.status.code).not.toBe(SUCCESS);
    expect(res.data).toBeNull();
  });

  it('API 回的錯誤 envelope 原樣保留 —— 不可覆蓋 server 的錯誤碼與訊息', () => {
    const serverEnvelope = {
      data: null,
      status: { code: 403, message: { zh_tw: '沒有權限', en: 'Forbidden', ja: '権限がありません' } },
    };
    expect(toApiEnvelope(serverEnvelope)).toBe(serverEnvelope);
    expect(toApiEnvelope(serverEnvelope).status.code).toBe(403);
  });

  it('401 envelope 原樣保留（401 retry / SignOut 流程依賴此碼）', () => {
    const unauthorized = { data: null, status: { code: 401, message: { zh_tw: '', en: '', ja: '' } } };
    expect(toApiEnvelope(unauthorized).status.code).toBe(401);
  });

  it('networkError 訊息三語齊備（會直接顯示給使用者）', () => {
    const msg = toApiEnvelope(new Error('x')).status.message;
    for (const lang of ['zh_tw', 'en', 'ja'] as const) {
      expect(msg[lang].length).toBeGreaterThan(0);
    }
  });
});
