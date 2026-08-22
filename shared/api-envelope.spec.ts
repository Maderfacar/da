import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

// ── 靜態掃描：沒有呼叫點可以把 networkError(0) 當成功 ─────────────────────────
//
// 為什麼需要這道：「|| code === 0」這種贅碼在 2026-05-11 寫下時是無害的
// （server 的 successResponse 一律回 200，從不回 0，那條分支永遠不成立）。
// 775135d 引入 networkError = 0 之後，同一行程式碼的**意思變成「把斷線當成功」**，
// 而 networkError envelope 的 data 恆為 null → 呼叫端接著讀 data.xxx 就爆。
//
// 2026-08-22 prod 同時中了兩處：
//   - 8.store-config.ts → null is not an object (evaluating 'm.vehicles')
//   - booking/index.vue → 更糟：訂單送出失敗卻顯示「已成立」並清掉草稿
//
// 這一類（既有贅碼因新語意而活化）在本專案反覆出現，靠人工複查擋不住，故以掃描釘死。
// 只掃 app/：envelope 是 client 端 $api 呼叫慣例，風險全在呼叫點；
const SCAN_ROOTS = ['app'];
const SCAN_EXT = ['.ts', '.vue'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
      continue;
    }
    if (SCAN_EXT.some((e) => p.endsWith(e)) && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('networkError(0) 不得被當成功', () => {
  it('0 必然不等於 success（否則所有 !== success 防呆全失效）', () => {
    expect(API_NETWORK_ERROR_CODE).not.toBe(SUCCESS);
  });

  it('原始碼中沒有任何地方拿 status.code 與 0 比對相等', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (line.trimStart().startsWith('//')) return; // 註解不算
          if (!/code\s*===?\s*0(?![\w.])/.test(line)) return; // 尾端否定環視排除 0x7f 之類字元碼
          offenders.push(file + ':' + (i + 1) + '  ' + line.trim());
        });
      }
    }
    const hint = '把 networkError(0) 當成功的呼叫點（0 = 請求從未到達 server，data 恆為 null）:\n';
    expect(offenders, hint + offenders.join('\n')).toEqual([]);
  });
});
