// 乘客端季節主題 server 端 helper（W1）
//
// Firestore：
//   - site_themes/{themeId}   每套主題包（name / tokens / hero / enabled / sortOrder / isDefault）
//   - site_config/theme       { activeThemeId }  手動切換指標
//
// 公開 GET `/nuxt-api/config/theme` 撈全部主題 + 指標，解析為 ResolvedTheme 給乘客端 SSR/client。
// admin 切換走 `/nuxt-api/admin/config/theme/*`（W2，需 admin 權限）。
//
// 首次呼叫若 collection / 指標為空，自動 seed defaults（避免上線後資料庫空白）。
// 30 秒 in-memory TTL 快取（對齊 fare-rules-cache 設計取捨：換季後最多 30 秒各 serverless instance 生效）。

import type { Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_SITE_THEMES,
  resolveTheme,
  type ResolvedTheme,
  type SiteTheme,
} from '~shared/site-theme';

export const SITE_THEMES_COLLECTION = 'site_themes';
export const SITE_CONFIG_COLLECTION = 'site_config';
export const ACTIVE_THEME_DOC_ID = 'theme';
export const DEFAULT_ACTIVE_THEME_ID = 'default';

const CACHE_TTL_MS = 30 * 1000;

interface ActiveThemePointer {
  activeThemeId: string;
}

const docToSiteTheme = (
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): SiteTheme => ({ id: doc.id, ...doc.data() } as SiteTheme);

/** 若 site_themes 為空就寫入 defaults；site_config/theme 缺失就寫入預設指標。 */
export const seedSiteThemesIfEmpty = async (db: Firestore): Promise<void> => {
  const [themesSnap, pointerSnap] = await Promise.all([
    db.collection(SITE_THEMES_COLLECTION).limit(1).get(),
    db.collection(SITE_CONFIG_COLLECTION).doc(ACTIVE_THEME_DOC_ID).get(),
  ]);

  const batch = db.batch();
  let needsCommit = false;

  if (themesSnap.empty) {
    DEFAULT_SITE_THEMES.forEach((theme) => {
      const { id, ...rest } = theme;
      batch.set(db.collection(SITE_THEMES_COLLECTION).doc(id), rest);
    });
    needsCommit = true;
  }

  if (!pointerSnap.exists) {
    batch.set(
      db.collection(SITE_CONFIG_COLLECTION).doc(ACTIVE_THEME_DOC_ID),
      { activeThemeId: DEFAULT_ACTIVE_THEME_ID } satisfies ActiveThemePointer,
    );
    needsCommit = true;
  }

  if (needsCommit) await batch.commit();
};

/** 撈全部主題（含 disabled，供 admin list 與解析共用），依 sortOrder 排序。 */
export const listSiteThemes = async (db: Firestore): Promise<SiteTheme[]> => {
  const snap = await db.collection(SITE_THEMES_COLLECTION).orderBy('sortOrder').get();
  return snap.docs.map(docToSiteTheme);
};

/** 讀取目前生效指標；缺失回退預設 id。 */
export const getActiveThemeId = async (db: Firestore): Promise<string> => {
  const snap = await db.collection(SITE_CONFIG_COLLECTION).doc(ACTIVE_THEME_DOC_ID).get();
  const data = snap.data() as ActiveThemePointer | undefined;
  return data?.activeThemeId ?? DEFAULT_ACTIVE_THEME_ID;
};

/** 讀單一主題 doc；不存在回 null（供 admin 端點 guard 用）。 */
export const getSiteThemeById = async (
  db: Firestore,
  id: string,
): Promise<SiteTheme | null> => {
  const snap = await db.collection(SITE_THEMES_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as SiteTheme;
};

/** 切換生效主題指標（admin）。呼叫端須先確認目標 enabled。 */
export const setActiveTheme = async (db: Firestore, activeThemeId: string): Promise<void> => {
  await db
    .collection(SITE_CONFIG_COLLECTION)
    .doc(ACTIVE_THEME_DOC_ID)
    .set({ activeThemeId } satisfies ActiveThemePointer, { merge: true });
};

/** 啟用 / 停用主題（admin）。 */
export const setThemeEnabled = async (
  db: Firestore,
  id: string,
  enabled: boolean,
): Promise<void> => {
  await db.collection(SITE_THEMES_COLLECTION).doc(id).set({ enabled }, { merge: true });
};

/**
 * 設定 / 清除主題 Hero 主圖（admin）。
 *   - bgImage 為字串 → 寫入 hero.bgImage
 *   - bgImage 為 null → 以 FieldValue.delete() 清除該欄位（回退純色 hero）
 */
export const setThemeHeroImage = async (
  db: Firestore,
  id: string,
  bgImage: string | null,
): Promise<void> => {
  const { FieldValue } = await import('firebase-admin/firestore');
  await db
    .collection(SITE_THEMES_COLLECTION)
    .doc(id)
    .set(
      { hero: { bgImage: bgImage === null ? FieldValue.delete() : bgImage } },
      { merge: true },
    );
};

// ── In-memory 快取 ───────────────────────────────────────────────────────────
let cached: ResolvedTheme | null = null;
let cachedAt = 0;

/**
 * 取得目前生效的 ResolvedTheme。30 秒 TTL；讀取失敗一律 fallback 由 DEFAULT_SITE_THEMES
 * 解析出的 default 主題（並快取避免每次進站重打 Firestore）。
 */
export const resolveActiveTheme = async (db: Firestore): Promise<ResolvedTheme> => {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  try {
    await seedSiteThemesIfEmpty(db);
    const [themes, activeThemeId] = await Promise.all([
      listSiteThemes(db),
      getActiveThemeId(db),
    ]);
    const list = themes.length > 0 ? themes : DEFAULT_SITE_THEMES;
    cached = resolveTheme(list, activeThemeId);
    cachedAt = now;
    return cached;
  } catch (err) {
    console.error('[site-theme] 解析生效主題失敗，改用預設：', err);
    cached = resolveTheme(DEFAULT_SITE_THEMES, DEFAULT_ACTIVE_THEME_ID);
    cachedAt = now;
    return cached;
  }
};

/** admin 切換 / 改主題後呼叫，下次 resolveActiveTheme 立即重讀。 */
export const invalidateSiteThemeCache = (): void => {
  cached = null;
  cachedAt = 0;
};
