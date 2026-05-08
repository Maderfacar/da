# 後端編碼規範（Server API）

Nitro server routes 位於 `server/routes/nuxt-api/`，使用 `@@` 別名引用 `server/`。

## API 路由結構

每個資源依 HTTP 方法拆檔：

```
server/routes/nuxt-api/{資源}/
  index.get.ts    — 列表
  index.post.ts   — 新增
  [id].get.ts     — 詳情
  [id].put.ts     — 更新
  [id].delete.ts  — 刪除
```

## 錯誤處理（核心規則）

- **使用 `return` 回傳錯誤，禁止 `throw`**（H3 unhandled exception 會回 HTTP 500，client 看不到友善訊息）
- 使用 `@@/utils/response` 提供的工具函式：
  - `successResponse(data)`
  - `notFoundError(...)`
  - `badRequestError(...)`
  - `forbiddenError(...)`
  - `serverError(...)`
- 錯誤訊息必須提供三語言（`zh_tw`、`en`、`ja`）
- 後端返回資料中的 `null` 值應轉為空字串
- **任何 try-catch 失敗路徑都用 `console.error`**（不是 `console.log` / `info` / `warn`）— Vercel runtime logs 對 error 級別最可靠

## 統一響應格式

```typescript
{
  data: T,
  status: {
    code: number,
    message: { zh_tw: string, en: string, ja: string }
  }
}
```

## 前後端共享

- 共享程式碼放在 `shared/`，以 `~shared` 別名引用
- 前端透過 `$api` 呼叫，需與後端回傳格式保持一致（`status.code` 判斷成功失敗）

## Firebase Admin SDK 規範（P10/P11 強制規範）

### useFirebaseAdmin 統一入口

所有需要 firebase-admin 的 server route 必須走 `@@/utils/firebase-admin` 的 `useFirebaseAdmin()`：

```ts
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

const { auth, db, storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);
```

useFirebaseAdmin 已內建：
- 接受 `string | object | null`（Nuxt destr 可能把 JSON env 自動 parse 成 object）
- 深拷貝解除 frozen object（Nuxt defu deep merge 會 freeze runtimeConfig）
- 必填欄位驗證（type / project_id / private_key / client_email）
- private_key PEM 格式驗證
- storageBucket 自動帶 `${project_id}.appspot.com`（可由 `NUXT_FIREBASE_STORAGE_BUCKET` 覆寫）

**不要**自己 `JSON.parse(config.firebaseServiceAccountJson)` 或 `cert(sa)` — 直接用 `useFirebaseAdmin()`。

### 同步 Auth ↔ Firestore 文件禁用 `.set()` 直接覆寫

Firebase Auth user 與 Firestore 文件可能不同步（前次 init 失敗、admin 手動預先設定文件等）。直接 `.set({...})` 會把使用者已有的 `roles` / `approved` / `driverApplication` 全清掉。

**正確寫法**：先檢查存在性，文件已存在則 merge，不存在才完整建立：

```ts
const docRef = db.collection('users').doc(lineUid);
const snap = await docRef.get();
if (snap.exists) {
  // 只更新本次必要欄位（merge），保留其他既有資料
  await docRef.set({ displayName, pictureUrl }, { merge: true });
} else {
  // 真正全新文件，完整初始化
  await docRef.set({ roles: ['passenger'], approved: true, ... });
}
```

### Firestore 寫入失敗禁止 silent 吞掉

失敗時必須 `return serverError(...)`，避免 client 收到 HTTP 200 + status 200 卻誤以為訂單成立、實際資料庫沒寫入：

```ts
try {
  await db.collection('orders').doc(orderId).set({...});
} catch (err) {
  console.error('[orders/post] Firestore write failed:', err);
  return serverError({ zh_tw: '寫入失敗，請重試', en: '...', ja: '...' });
}
```

### roles 多角色操作（P10 起）

- 加角色：`FieldValue.arrayUnion('driver')`
- 移除角色：`FieldValue.arrayRemove('driver')`
- **禁止移除 `'passenger'`**（passenger 是基礎身分，所有使用者最低 roles 是 `['passenger']`）

### 詳細踩雷紀錄

完整背景與三大踩雷點（destr parse object / frozen object / isNewUser 覆寫）見 [docs/decision-log.md](../../docs/decision-log.md) 2026/05/07~08 條目。
