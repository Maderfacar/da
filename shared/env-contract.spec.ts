import { describe, it, expect } from 'vitest';
import destr from 'destr';
import {
  ENV_CONTRACTS,
  DESTR_HAZARD_CONTRACTS,
  validateEnvValues,
  validateRuntimeConfigTypes,
  readConfigPath,
  configKeyOf,
  summarizeIssues,
} from './env-contract.mjs';

/** 讓所有 required 項目都合格的最小環境（避免測單一規則時被其他項目干擾）。 */
const validEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const c of ENV_CONTRACTS) {
    if (c.importance === 'optional') continue;
    if (c.kind === 'numeric-id') env[c.env] = '2009509209';
    else if (c.kind === 'hex64') env[c.env] = 'a'.repeat(64);
    else if (c.kind === 'url') env[c.env] = 'https://example.com';
    else if (c.kind === 'json') env[c.env] = '{"project_id":"x"}';
    else env[c.env] = 'value';
  }
  return env;
};

describe('ENV_CONTRACTS 契約自檢', () => {
  it('環境變數名不重複', () => {
    const names = ENV_CONTRACTS.map((c) => c.env);
    expect(new Set(names).size).toBe(names.length);
  });

  it('runtimeConfig 路徑不重複', () => {
    const paths = ENV_CONTRACTS.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('每項都有說明（壞掉會發生什麼）', () => {
    for (const c of ENV_CONTRACTS) expect(c.note.length).toBeGreaterThan(5);
  });

  it('destr 高危群 = 所有 numeric-id 契約，且含本次事故的那一支', () => {
    expect(DESTR_HAZARD_CONTRACTS.every((c) => c.kind === 'numeric-id')).toBe(true);
    expect(DESTR_HAZARD_CONTRACTS.map((c) => c.env)).toContain('NUXT_LINE_LOGIN_CHANNEL_ID');
  });
});

describe('validateEnvValues', () => {
  it('全部合格時無問題', () => {
    expect(validateEnvValues(validEnv())).toEqual([]);
  });

  it('核心必要缺失 → error', () => {
    const env = validEnv();
    delete env.NUXT_LINE_LOGIN_CHANNEL_ID;
    const issues = validateEnvValues(env);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      env: 'NUXT_LINE_LOGIN_CHANNEL_ID',
      level: 'error',
      problem: 'missing',
    });
  });

  it('strictRequired=false 時必要項缺失降級為 warn（Vercel Preview / 本機）', () => {
    const env = validEnv();
    delete env.NUXT_LINE_CHANNEL_ID;
    const strict = validateEnvValues(env);
    expect(strict[0]).toMatchObject({ level: 'error', problem: 'missing' });

    const lenient = validateEnvValues(env, undefined, { strictRequired: false });
    expect(lenient[0]).toMatchObject({ level: 'warn', problem: 'missing' });
  });

  it('strictRequired=false 不影響格式錯誤 —— 格式錯與環境無關，任何情境都是 error', () => {
    const env = validEnv();
    env.NUXT_LINE_LOGIN_CHANNEL_ID = 'not-a-number';
    const lenient = validateEnvValues(env, undefined, { strictRequired: false });
    expect(lenient[0]).toMatchObject({ level: 'error', problem: 'format' });
  });

  it('optional 缺失完全不回報', () => {
    const issues = validateEnvValues(validEnv());
    const optionalEnvs = ENV_CONTRACTS.filter((c) => c.importance === 'optional').map((c) => c.env);
    expect(issues.filter((i) => optionalEnvs.includes(i.env))).toEqual([]);
  });

  it('驗收案例：channel id 改成非數字 → error（部署必須紅）', () => {
    const env = validEnv();
    env.NUXT_LINE_LOGIN_CHANNEL_ID = 'not-a-number';
    const issues = validateEnvValues(env);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      env: 'NUXT_LINE_LOGIN_CHANNEL_ID',
      level: 'error',
      problem: 'format',
    });
  });

  it('值存在但格式錯一律 error（與 importance 無關）', () => {
    const env = validEnv();
    env.NUXT_PUBLIC_SITE_URL = 'not-a-url';
    expect(validateEnvValues(env)[0]).toMatchObject({ level: 'error', problem: 'format' });
  });

  it('TOTP 金鑰長度不足 → error（後台會全鎖）', () => {
    const env = validEnv();
    env.NUXT_TOTP_ENC_KEY = 'abc123';
    expect(validateEnvValues(env)[0]).toMatchObject({
      env: 'NUXT_TOTP_ENC_KEY',
      problem: 'format',
    });
  });

  it('空白字串視同缺失', () => {
    const env = validEnv();
    env.NUXT_LINE_LOGIN_CHANNEL_SECRET = '   ';
    expect(validateEnvValues(env)[0]).toMatchObject({ problem: 'missing' });
  });

  it('回報內容不含設定值本身', () => {
    const env = validEnv();
    env.NUXT_TOTP_ENC_KEY = 'super-secret-but-wrong-format';
    const serialized = JSON.stringify(validateEnvValues(env));
    expect(serialized).not.toContain('super-secret-but-wrong-format');
  });
});

describe('validateRuntimeConfigTypes', () => {
  it('迴歸：2026-08-19 事故 —— destr 把 channel id 轉成 number 必須被回報', () => {
    // 重現 Nitro 的注入行為：destr('2009509209') → number
    const injected = destr('2009509209');
    expect(typeof injected).toBe('number');

    const issues = validateRuntimeConfigTypes({ lineLoginChannelId: injected });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      env: 'NUXT_LINE_LOGIN_CHANNEL_ID',
      problem: 'type-hazard',
    });
    expect(issues[0].detail).toContain('configStr');
  });

  it('字串型別不回報', () => {
    expect(validateRuntimeConfigTypes({ lineLoginChannelId: '2009509209' })).toEqual([]);
  });

  it('未設定不回報（缺失由 validateEnvValues 負責，不重複）', () => {
    expect(validateRuntimeConfigTypes({})).toEqual([]);
    expect(validateRuntimeConfigTypes({ lineLoginChannelId: '' })).toEqual([]);
  });

  it('public 巢狀路徑也檢查得到', () => {
    const issues = validateRuntimeConfigTypes({
      public: { firebaseMessagingSenderId: destr('718691467645') },
    });
    expect(issues[0]).toMatchObject({
      env: 'NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
      problem: 'type-hazard',
    });
  });

  it('回報內容不含設定值本身', () => {
    const issues = validateRuntimeConfigTypes({ lineLoginChannelId: 2009509209 });
    expect(JSON.stringify(issues)).not.toContain('2009509209');
  });
});

describe('工具函式', () => {
  it('readConfigPath 讀得到巢狀值、缺失回 undefined', () => {
    expect(readConfigPath({ public: { a: 1 } }, 'public.a')).toBe(1);
    expect(readConfigPath({}, 'public.a')).toBeUndefined();
    expect(readConfigPath({ a: 'x' }, 'a')).toBe('x');
  });

  it('configKeyOf 取路徑最後一段（靜態掃描用）', () => {
    expect(configKeyOf('public.firebaseMessagingSenderId')).toBe('firebaseMessagingSenderId');
    expect(configKeyOf('lineLoginChannelId')).toBe('lineLoginChannelId');
  });

  it('summarizeIssues 分級統計', () => {
    expect(summarizeIssues([
      { level: 'error' }, { level: 'error' }, { level: 'warn' },
    ])).toEqual({ error: 2, warn: 1 });
  });
});
