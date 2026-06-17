// 認證公開路由 SSOT — 唯一定義
//
// 設計目標：「哪些路徑不需要登入」由本檔集中定義，其他關卡（BootGate / middleware /
// PageIndex）一律 import isPublicRoute() 判斷，避免散在多處重複定義導致漂移。
//
// 包含路徑說明：
//   - '/'      — 行銷首頁 hero
//   - '/fare'  — 車資說明（含試算機）
//   - '/faq'   — 常見問題
//   - '/fleet' — 車型介紹（目前已合併進 /fare；保留前綴避免未來重啟頁面遺漏）
//   - '/login' — 乘客登入
//   - '/legal' — 法律頁（terms / privacy 等子路徑）
//
// 語系前綴策略：i18n 採 prefix_except_default，預設繁中無前綴；英日為 /en、/ja。
// isPublicRoute() 會先剝掉 /en /ja 再比對，確保三語系一致放行。

export const PUBLIC_ROUTE_PREFIXES: readonly string[] = [
  '/',
  '/fare',
  '/faq',
  '/fleet',
  '/login',
  '/legal',
];

const LOCALE_PREFIX_PATTERN = /^\/(?:en|ja)(?=\/|$)/;

export function isPublicRoute(path: string): boolean {
  if (!path) return false;
  const stripped = path.replace(LOCALE_PREFIX_PATTERN, '');
  if (stripped === '' || stripped === '/') return true;
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => prefix !== '/' && (stripped === prefix || stripped.startsWith(`${prefix}/`)),
  );
}
