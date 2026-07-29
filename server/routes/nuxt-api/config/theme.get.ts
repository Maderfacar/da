/**
 * GET /nuxt-api/config/theme
 *
 * 公開端點：回傳乘客端當前生效的季節主題（ResolvedTheme：完整 tokens + hero）。
 * 乘客 layout（front-desk / marketing）SSR + client 讀這個，注入 [data-da-theme] 覆寫調色盤。
 *
 * 自動 seed：site_themes / site_config/theme 為空時寫入 defaults。
 * 30 秒 TTL 快取於 site-theme-config helper。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { resolveActiveTheme } from '@@/utils/site-theme-config';

export default defineEventHandler(async () => {
  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const resolved = await resolveActiveTheme(db);
    return successResponse(resolved);
  } catch (err) {
    console.error('[config/theme] read failed:', err);
    return serverError({ zh_tw: '讀取主題設定失敗', en: 'Failed to read theme config', ja: 'テーマ設定の読み込みに失敗しました' });
  }
});
