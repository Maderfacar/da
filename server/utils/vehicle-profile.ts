/**
 * Vehicle Profile server-side helpers（Phase 1B）
 *
 * - 從 active tags collection 建 id → { group, scope, nameZh } 索引
 *   給 vehicleProfile 驗證 / driver-scope tag 驗證 / audit payload 顯示用
 * - driver-scope tag 驗證：scope='driver'（不檢 mutex；driverSkill 為 multi group）
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { TagGroup, TagScope } from '~shared/tagTaxonomy';
import type { TagDoc } from '@@/utils/tag';

export interface TagIndexEntry {
  id: string;
  group: TagGroup;
  scope: TagScope;
  nameZh: string;
}

/**
 * 從 tags collection 拉所有 active tag，組成 id → entry map。
 * 給 vehicleProfile validation + audit log 名稱顯示用。
 */
export async function buildTagIndex(db: Firestore): Promise<Map<string, TagIndexEntry>> {
  const snap = await db.collection('tags').where('status', '==', 'active').get();
  const index = new Map<string, TagIndexEntry>();
  snap.forEach((doc) => {
    const d = doc.data() as Partial<TagDoc>;
    if (!d.group || !d.scope) return;
    index.set(doc.id, {
      id: doc.id,
      group: d.group as TagGroup,
      scope: d.scope as TagScope,
      nameZh: d.name?.zh_tw ?? '',
    });
  });
  return index;
}

/**
 * 驗證 driver-scope tags（給 tags.patch.ts 用）。
 * 規則：每個 id 必須存在於 active tags、scope='driver'。
 * 不檢 mutex（driverSkill 為唯一 driver-scope group，multiplicity='multi'）。
 *
 * 回傳 null 表示通過；string 表示錯誤摘要（給三語錯誤訊息 prefix 用）。
 */
export function validateDriverTags(
  tags: string[],
  index: ReadonlyMap<string, TagIndexEntry>,
): string | null {
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (typeof t !== 'string' || t.trim().length === 0) {
      return `tags[${i}]:invalid`;
    }
    const entry = index.get(t);
    if (!entry) return `tags[${i}]:not_found`;
    if (entry.scope !== 'driver') return `tags[${i}]:scope_mismatch`;
  }
  return null;
}

/**
 * 把 tag id 陣列轉中文名稱陣列（給 audit payload 用）。
 * 不在 index 的回 id 自身。
 */
export function tagIdsToNames(
  tags: string[],
  index: ReadonlyMap<string, TagIndexEntry>,
): string[] {
  return tags.map((id) => index.get(id)?.nameZh || id);
}
