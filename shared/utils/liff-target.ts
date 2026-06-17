// LIFF OAuth callback 目標 path 解析
//
// 從 query (`liff.state` / `next`) 或 pathname 取得 callback 要跳的內部目標 path。
// 守則：只接受 `/` 開頭、不含 `//`、不含 scheme — 防 open redirect。
//
// 兩個來源的優先序：
//   1. `liff.state` / `next` query — OAuth callback 標準參數
//   2. `pathname` — LIFF SDK 在 init 內用 history.replaceState 把 URL rewrite 成
//      目標 path，但 Vue Router 仍停在原入口；middleware/page 拿到的 to.path 仍是入口，
//      需用 window.location.pathname 兜底（client only）。

type QueryValue = string | string[] | null | undefined;

export interface LiffTargetInput {
  query?: Record<string, QueryValue>;
  pathname?: string;
}

const _firstString = (v: QueryValue): string => {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
};

const _isSafePath = (p: string): boolean => {
  return p.startsWith('/') && !p.includes('//') && !p.includes(':');
};

export function resolveLiffTarget(input: LiffTargetInput): string {
  const rawState = _firstString(input.query?.['liff.state']);
  const rawNext = _firstString(input.query?.['next']);
  const raw = rawState || rawNext;
  if (raw) {
    try {
      const target = decodeURIComponent(raw);
      if (_isSafePath(target)) return target;
    } catch {
      // decodeURIComponent 失敗 → 視為無效，fallthrough 試 pathname
    }
  }
  if (input.pathname && input.pathname !== '/' && _isSafePath(input.pathname)) {
    return input.pathname;
  }
  return '';
}
