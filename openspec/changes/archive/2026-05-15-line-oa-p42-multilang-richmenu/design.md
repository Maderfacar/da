# Design — P42 LINE Richmenu 多語版本

> 對應 [proposal.md](proposal.md)。以**推 spec 預設**（Q1=1a / Q2=2b / Q3=3b / Q4=4a / Q5=5a / Q6=6a / Q7=7a）展開設計。

## 0. 既有架構盤點（design 假設都基於這些事實）

### 0.1 既有 lang code

- `server/utils/i18n-message.ts:22` 已定義：`Lang = 'zh_tw' | 'en' | 'ja'`
- `i18n/locales/` 三檔對齊：`zh.js` / `en.js` / `ja.js`（CLAUDE.md 內 i18n 規範）
- **重要對齊**：lang code 採 **`zh_tw`**（底線版）— 與 i18n locale 檔命名 `zh.js` 略有不一致；本案統一沿用 `zh_tw`（避免改 i18n 既有對應）

### 0.2 users.lang 寫入路徑（**目前是空的**）

- `server/utils/i18n-message.ts:122-133` `getUserLang(db, lineUid)` 已實作 → 全 case fallback `'zh_tw'`（因 users doc 沒 lang field）
- `server/routes/nuxt-api/auth/line-exchange.post.ts` 不寫 lang field（首次 login 走 `displayName / pictureUrl / lastSeenAt`）
- 沒有 `/api/self/lang` 或 `/api/self/profile` 類 endpoint
- 前端 i18n switcher（passenger settings / driver profile）目前只切 cookie / store，**不 persist** 到 Firestore
- 「driver 端 i18n switcher UI 尚未實作」（Out of Scope §記錄）

→ **P42 必須一併補 user lang persist 機制**（Q3=3b/3c 的前置）

### 0.3 既有 line_richmenus schema（P38 落地）

`server/utils/line-richmenu-doc.ts` `LineRichmenuDoc`：

```typescript
{
  channel: 'passenger' | 'driver',
  status: 'draft' | 'active' | 'archived',
  name: string,
  lineRichMenuId: string | null,
  syncStatus: 'not_synced' | 'syncing' | 'synced' | 'sync_failed',
  // ... image / content / meta
}
```

unique 約束：`channel × status='active'` 同時 ≤ 1（P38 Phase 1 publish.post.ts tx 邏輯）。

### 0.4 既有 publish 流程（P38）

[server/routes/nuxt-api/admin/line-richmenus/[id]/publish.post.ts](server/routes/nuxt-api/admin/line-richmenus/[id]/publish.post.ts)：
1. `isPublishReady` 檢查
2. Rate-limit（5/hr/admin）
3. Firestore tx：archive 舊 active → mark 新 active 'syncing'
4. LINE API：createRichmenu + uploadRichmenuImage（若 lineRichMenuId 為 null）+ **setDefaultRichmenu**（對全 user 生效）
5. 寫回 syncStatus + audit log

### 0.5 既有 follow event 流程（P38 + P40）

[server/utils/line-channel.ts:188-194](server/utils/line-channel.ts:188)：
- 驗 signature → readBody → events loop
- follow event：loadBotReply（P40 Phase 2）→ `_reply` 推歡迎文字
- **無 richmenu 綁定邏輯**（user 看到的 richmenu 來自 setDefaultRichmenu 全 user default）

### 0.6 LINE Messaging API 限制

- `POST /v2/bot/user/{userId}/richmenu/{id}`（linkRichmenuToUser）：每 user 一次 API call
- LINE 公開額度：單 OA 每分鐘 ~1000 req（plan dependent）
- `event.source.language`：LINE Webhook event 規格允許 follow / message 帶此 field（依 user LINE App language 設定），但**非強制**；user profile lookup API `/v2/bot/profile/{userId}` 回 `language` 也是可選
- 既有 `server/utils/line-richmenu.ts:373` `linkRichmenuToUser` / `:390` `unlinkRichmenuFromUser` helper 已建好（P38 Phase 1）

---

## 1. line_richmenus schema 加 lang 維度（Q1=1a 推 spec 預設）

### 1.1 Firestore Schema 改動

```typescript
interface LineRichmenuDoc {
  channel: LineClient;
  lang: 'zh_tw' | 'en' | 'ja';        // ← P42 NEW
  status: RichmenuStatus;
  name: string;
  // ... 其餘欄位不變
}
```

### 1.2 Unique 約束

| 維度 | P38 | P42 (Q1=1a) |
|---|---|---|
| status='active' 同時 ≤ 1 doc | 每 channel | 每 channel × lang |
| publish tx archive 對象 | 同 channel 既有 active | 同 channel **同 lang** 既有 active |

### 1.3 Migration（既有 active → grandfather zh_tw）

Q7=7a 推 spec 預設：

`POST /nuxt-api/admin/migrations/p42-richmenu-lang`（super only）：
- 列所有 `line_richmenus` doc lang 為 null/undefined → set `lang='zh_tw'`
- dry-run mode（`?dryRun=1`）：只 list 影響 doc 不寫入
- 冪等：跑兩次無害（已有 lang field 的 doc 不動）
- audit log `line.richmenu.migrate.lang`

### 1.4 Q1=1b 替代設計（不採）

單 doc 多 variants：
```typescript
{
  channel: LineClient,
  status: RichmenuStatus,
  contents: {
    zh_tw: { lineRichMenuId, areas, image, ... },
    en:    { lineRichMenuId, areas, image, ... },
    ja:    { lineRichMenuId, areas, image, ... },
  },
}
```

不採理由：
- admin UI 設計複雜度上升（單卡片要顯示 3 lang 狀態）
- LINE 端仍是 3 個 richmenu（一個 lang 一個 LineRichMenuId），1b 只是 doc 結構不同
- migration cost 上升（grandfather 既有 doc 結構翻倍）
- syncStatus / syncError 一個 doc 多 LINE 端要對應 3 lang 各自的 sync 狀態，schema 更複雜

---

## 2. binding helper（新 util `server/utils/line-richmenu-binding.ts`）

### 2.1 resolveUserLang（Q3=3b 推 spec 預設）

```typescript
import type { Firestore } from 'firebase-admin/firestore';
import { getUserLang, type Lang } from '@@/utils/i18n-message';

/**
 * 解析 user 偏好 lang。
 * Q3=3b（推 spec 預設）：純讀 users/{lineUid}.lang；缺值 fallback 'zh_tw'
 * Q3=3a 替代：純讀 eventLang（webhook source.language；缺值 fallback 'zh_tw'）
 * Q3=3c 替代：先 users.lang，缺值 fallback eventLang，再 fallback 'zh_tw'
 */
export async function resolveUserLang(
  db: Firestore,
  lineUid: string,
  eventLang?: string,
): Promise<Lang> {
  return getUserLang(db, lineUid);  // Q3=3b 直接複用既有 helper
}
```

### 2.2 loadActiveRichmenuForLang

```typescript
/**
 * 查該 channel × lang active richmenu doc。
 * 找不到 → 依 Q5 fallback chain（推 spec 預設 5a zh→en→ja）
 */
export async function loadActiveRichmenuForLang(
  db: Firestore,
  channel: LineClient,
  lang: Lang,
): Promise<LineRichmenuDoc | null> {
  const chain = FALLBACK_CHAIN[lang];  // Q5=5a: ['zh_tw', 'en', 'ja'] 重排序
  for (const tryLang of chain) {
    const snap = await db.collection('line_richmenus')
      .where('channel', '==', channel)
      .where('lang', '==', tryLang)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].data() as LineRichmenuDoc;
  }
  return null;
}

// Q5=5a chain（每 lang 找不到時的 fallback 順序）
const FALLBACK_CHAIN: Record<Lang, Lang[]> = {
  zh_tw: ['zh_tw', 'en', 'ja'],
  en:    ['en', 'zh_tw', 'ja'],
  ja:    ['ja', 'zh_tw', 'en'],
};
```

### 2.3 bindRichmenuForUser

```typescript
/**
 * 對 user 綁該 lang 對應 richmenu。
 *
 * - 若該 lang × channel 有 active doc → linkRichmenuToUser
 * - 若 fallback chain 全空 → unlinkRichmenuFromUser（讓 user 看 LINE default）
 * - LINE API 失敗 → P43 error log + return false（fail-open）
 */
export async function bindRichmenuForUser(
  db: Firestore,
  client: LineClient,
  lineUid: string,
  lang: Lang,
): Promise<{ ok: boolean; richMenuId: string | null; usedLang: Lang | null }> {
  const richmenu = await loadActiveRichmenuForLang(db, client, lang);
  if (!richmenu?.lineRichMenuId) {
    try {
      await unlinkRichmenuFromUser(client, lineUid);
    } catch (err) {
      console.warn('[richmenu-binding] unlink failed:', err);
    }
    return { ok: true, richMenuId: null, usedLang: null };
  }
  try {
    await linkRichmenuToUser(client, lineUid, richmenu.lineRichMenuId);
    return { ok: true, richMenuId: richmenu.lineRichMenuId, usedLang: richmenu.lang };
  } catch (err) {
    // P43 error log 已在 linkRichmenuToUser 內透過 errorContext 寫入
    return { ok: false, richMenuId: null, usedLang: null };
  }
}
```

---

## 3. webhook follow event 整合（Q2/Q3 路徑）

[server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` follow event 內：

```typescript
if (ev.type === 'follow' && ev.source.userId && accessToken) {
  // 既有：loadBotReply + _reply（保留）
  const text = await loadBotReply(client, 'follow');
  await _reply(accessToken, ev.replyToken, [{ type: 'text', text }], replyCtx);

  // P42 新增：per-user 綁 lang 對應 richmenu（fire-and-forget）
  void (async () => {
    try {
      const { firebaseServiceAccountJson } = useRuntimeConfig();
      const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
      const lang = await resolveUserLang(db, ev.source.userId, ev.source.language);
      await bindRichmenuForUser(db, client, ev.source.userId, lang);
    } catch (err) {
      console.warn('[follow-bind-richmenu] failed (silent):', err);
    }
  })();

  handlerResult = 'replied';
}
```

fire-and-forget 因為：
- LINE webhook 要求 200 OK 回應 ≤ 5s；linkRichmenuToUser 額外 100-500ms 可能拖累
- 綁失敗不影響 user 體驗（仍有 default richmenu fallback）
- P43 error log 已捕捉 LINE API 失敗（不需重複寫）

---

## 4. user lang persist endpoint（Q2=2b + Q3=3b 路徑）

### 4.1 PATCH /nuxt-api/self/lang

新檔 `server/routes/nuxt-api/self/lang.patch.ts`：

```typescript
import { z } from 'zod';

const Body = z.object({
  lang: z.enum(['zh_tw', 'en', 'ja']),
});

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const parse = Body.safeParse(await readBody(event));
  if (!parse.success) {
    return badRequestError({
      zh_tw: 'lang 必須為 zh_tw / en / ja',
      en: 'lang must be zh_tw / en / ja',
      ja: 'lang は zh_tw / en / ja のいずれか',
    });
  }
  const { lang } = parse.data;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

  await db.collection('users').doc(auth.lineUid).set({ lang }, { merge: true });

  // 取對應 client（passenger / driver 依 auth.roles 推；同時為兩 channel 重綁）
  const clients: LineClient[] = inferClientsForUser(auth);
  const results = await Promise.all(
    clients.map((c) => bindRichmenuForUser(db, c, auth.lineUid, lang)),
  );

  return successResponse({ lang, rebinds: results });
});
```

權限：登入 user 自己（passenger / driver / admin 皆可）。

### 4.2 PATCH /nuxt-api/drivers/me/lang（driver alias，可選）

考量 driver 端 i18n switcher 落地後可能用獨立 endpoint：

- **方案 A**：driver 也走 `/api/self/lang`（passenger / driver 共用，較簡單）
- **方案 B**：driver 走獨立 `/drivers/me/lang`（與既有 `drivers/me/profile.patch.ts` 對稱）

推 spec 預設 **方案 A**（passenger / driver 共用 `/api/self/lang`），減少重複代碼。

### 4.3 inferClientsForUser 推 channel 邏輯

依 auth.roles 推：
- roles 含 `passenger` → 加 `'passenger'`
- roles 含 `driver` → 加 `'driver'`
- 兩者皆有（admin 可能） → 兩 channel 都重綁

### 4.4 前端 i18n switcher 改動（passenger 端）

`app/stores/8.store-config.ts`（既有 i18n 切換邏輯）+ settings page i18n switcher：

```typescript
async function ChangeLang(newLang: Lang) {
  // 既有：set i18n locale + persist cookie
  $i18n.locale.value = newLang;
  // 新增：persist 到 Firestore（已登入時才 call；訪客只切 cookie）
  if (StoreSelf().isLoggedIn) {
    await $api.PatchSelfLang({ lang: newLang });
  }
}
```

driver 端 i18n switcher UI 尚未實作 → endpoint 加但前端不動（後續 wave 落地時用）。

---

## 5. admin UI per-lang management（Q4=4a 推 spec 預設）

### 5.1 Richmenu tab 結構改動

`app/pages/admin/line-management/index.vue` Richmenu tab：

```
─ tab: Richmenu ──────────────────────
  ─ sub-tab: passenger / driver ──────
    ─ sub-tab: zh_tw / en / ja ───────   ← P42 NEW
      ─ status filter: all / draft / active / archived
      ─ cards grid
```

每 lang sub-tab 獨立 list；同 channel 下 lang sub-tab 共用 status filter 設定。

### 5.2 Edit dialog 改動

`app/components/open/dialog/line-richmenu/Edit.vue`：

- 既有：channel select + name + chatBarText + image upload + areas
- **新增**：lang select（zh_tw / en / ja）
  - 建立草稿時必選；既有 doc 編輯時 readonly（避免 mid-flight 改 lang 破壞 unique 約束）
  - `lang` 與 `channel + status` 一起決定 unique scope
- **新增**：「從其他 lang 複製」按鈕（複製 areas + image + chatBarText 到當前編輯中的 draft，方便先做 zh_tw 再翻譯）

### 5.3 Publish UI 改動

publish 按鈕 tooltip 加當前 lang 提示：「將設為 passenger × zh_tw 的 active 版本」。

publish 後顯示影響統計：
```
✓ 已發佈 passenger × zh_tw
  本地 archive：1 個舊 active doc
  LINE 同步：成功 / 失敗
  Re-bind：N 個 user 重綁完成（M 失敗）
```

---

## 6. 開放問題（待 Brain AI 拍板）

### Q1：line_richmenus schema 設計

- **1a**（推 spec 預設）：每 lang 一獨立 doc，加 `lang` field；unique = channel × lang × status='active'
- **1b**：單 doc 多 lang variants，`contents: Record<Lang, RichmenuContent>`；admin UI 走群組編輯

**Brain AI 拍板**：⏳ pending

### Q2：lang 切換觸發點

- **2a**：純 follow event + admin force re-bind；user 改 lang 後不重綁（仍看舊版直到 logout/login 或 follow event）
- **2b**（推 spec 預設）：含 user lang 切換 webhook → 新加 PATCH /api/self/lang endpoint + 前端 i18n switcher 改 call

**Brain AI 拍板**：⏳ pending

### Q3：lang 偵測來源

- **3a**：LINE event `source.language`（webhook 才有；LIFF push 取不到 → fallback default）
- **3b**（推 spec 預設）：`users/{lineUid}.lang` 為唯一來源（**順帶加 user lang persist 機制**）
- **3c**：兩者並存（首選 users.lang，fallback event lang，再 fallback default）

**Brain AI 拍板**：⏳ pending

### Q4：admin UI 編輯入口

- **4a**（推 spec 預設）：各 lang 獨立編輯（lang sub-tab + 「從其他 lang 複製」按鈕）
- **4b**：群組編輯器（單彈窗內 3 lang tab pane；publish 一次發 3 lang）

**Brain AI 拍板**：⏳ pending

### Q5：fallback lang 策略

- **5a**（推 spec 預設）：zh→en→ja 鏈式（與 i18n locale default 一致）
- **5b**：系統 default（admin 在 settings 設定 fallback lang 單一值）
- **5c**：永遠 zh（簡單但對非中文 user 不友善）

**Brain AI 拍板**：⏳ pending

### Q6：本案範圍

- **6a**（推 spec 預設）：三語全做（zh_tw / en / ja）
- **6b**：先 zh_tw + en，後續 wave 補 ja

**Brain AI 拍板**：⏳ pending

### Q7：既有 active richmenu 兼容

- **7a**（推 spec 預設）：視為 zh_tw 版本自動 grandfather（migration endpoint 把 lang=null → zh_tw；冪等）
- **7b**：強制 admin 補 en/ja 後才能 publish（既有 active 失效，admin 必須先建另外兩 lang draft + publish）

**Brain AI 拍板**：⏳ pending

---

## 7. 拍板紀錄

**2026-05-15 Brain AI 一句「預設即可」拍板** — 全部採推 spec 預設，無需重寫 design 其他 section。

| Q | 拍板 | 摘要 | 時間 |
|---|---|---|---|
| Q1 | **1a** | 每 lang 一獨立 doc，加 `lang` field；unique = channel × lang × status='active'；既有資料 grandfather zh_tw | 2026-05-15 |
| Q2 | **2b** | 含 user lang 切換 webhook（順帶加 PATCH /api/self/lang endpoint + 前端 i18n switcher 改 call） | 2026-05-15 |
| Q3 | **3b** | `users/{lineUid}.lang` 為唯一來源（本案順帶加 persist 機制，與 Q2=2b 連動） | 2026-05-15 |
| Q4 | **4a** | 各 lang 獨立編輯（channel sub-tab 內加 lang sub-tab + 「從其他 lang 複製」按鈕） | 2026-05-15 |
| Q5 | **5a** | zh_tw → en → ja fallback chain（與 i18n locale default 一致；每 lang 找不到時對應 fallback chain） | 2026-05-15 |
| Q6 | **6a** | 三語全做（zh_tw / en / ja） | 2026-05-15 |
| Q7 | **7a** | 既有 active richmenu 視為 zh_tw 版本自動 grandfather（migration endpoint 冪等 + dry-run mode） | 2026-05-15 |

設計即落地：§1.1 schema / §1.3 migration / §2 binding helper / §3 webhook follow / §4 user lang persist endpoint / §5 admin UI 全部依 §1-5 推 spec 預設展開，**無 section 需重寫**。

進入 [Phase 1](tasks.md#phase-1schema--binding-helper--webhook-follow-integration05-天) 實作。
