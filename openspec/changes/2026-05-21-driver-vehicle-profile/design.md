# Design — Phase 1B Driver / Vehicle Profile + 標籤掛載 + Admin 審核

## 1. 資料模型

### 1.1 `drivers/{lineUid}` 既有 doc 擴充（top-level 加 4 欄位）

```ts
interface DriverDocExtensions {
  /** 司機端能立即生效的標籤（scope=driver；driverSkill group 的 tag id 陣列） */
  tags: string[]

  /** 已 admin 審核通過的車輛 profile（公開檔案頁與配對讀此欄位） */
  vehicleProfile: VehicleProfile | null

  /** Driver 編輯中或待審的車輛 profile（不影響 current vehicleProfile） */
  vehicleProfilePending: VehicleProfilePending | null

  /** 最近一次 admin approve vehicleProfile 的時間（公開檔案頁 verified 徽章用） */
  verifiedAt: Timestamp | null
  verifiedBy: string | null  // admin uid
}

interface VehicleProfile {
  /** Storage public signed URL 陣列；max 8 */
  photos: string[]
  /** scope=vehicle 的 tag id 陣列（含 power/vehicleType/origin/interior/equipment） */
  tags: string[]
  updatedAt: Timestamp
}

interface VehicleProfilePending extends VehicleProfile {
  /** draft：driver 編輯中；pending_review：已送審；rejected：admin 退回 */
  status: 'draft' | 'pending_review' | 'rejected'
  submittedAt: Timestamp | null  // 進 pending_review 的時點
  rejectedAt: Timestamp | null
  rejectReason: string | null    // reject 時必填
  reviewedBy: string | null      // admin uid
}
```

> **不開新 collection**：vehicleProfile 與 pending 直接掛在 drivers doc 內。理由：
> - 與 driver 是 1:1 關係（議題 #5：一車制）
> - admin 詳情頁本來就讀 drivers doc，省一次 round-trip
> - 既有 driver doc 已存 `application.documents`（同類用法）

### 1.2 不開新 audit collection

沿用既有 `audit_logs/{logId}`。`AuditAction` union 加 3 case：

```ts
| 'driver.tags_update'           // driver-scope tags（driverSkill）即時更新
| 'driver.vehicle_profile_submit' // draft → pending_review
| 'driver.vehicle_profile_review' // admin approve / reject
```

payload 帶 before/after snapshot（沿用既有 `payload: { before, after }` 慣例）。

## 2. shared 層

### 2.1 `shared/vehicleProfile.ts`

```ts
import { TAG_GROUPS, type TagGroup, type TagScope } from './tagTaxonomy'

export type VehicleProfileStatus = 'draft' | 'pending_review' | 'rejected'

export interface VehicleProfileInput {
  photos?: string[]
  tags?: string[]
}

export interface VehicleProfileValidationError {
  field: string
  code: 'required' | 'invalid' | 'too_many' | 'mismatch' | 'mutex_violation'
}

/**
 * 驗證 vehicle profile 輸入。
 * 注意：本函式只做「形狀」+「群組互斥」驗證；tag id 是否存在 / scope 是否符合
 * 由 server 端 vehicle-profile.ts 對 tags collection 查詢比對（避免 shared 層 import firebase）。
 */
export function validateVehicleProfileShape(
  input: VehicleProfileInput,
  options?: {
    /** tag id → { group, scope } 映射（server 端從 tags collection 查得後注入） */
    tagIndex?: ReadonlyMap<string, { group: TagGroup; scope: TagScope }>
  },
): VehicleProfileValidationError[]
```

規則：
- `photos`：array，length ≤ 8；每項 string（URL，server 端再驗 prefix）
- `tags`：array，每項 string；
  - 若有 tagIndex：每個 id 必須在 index 中、scope 必須是 `'vehicle'`、不可有兩個同屬 `single` multiplicity group 的 tag id（mutex_violation）

### 2.2 `shared/vehicleProfile.spec.ts`

最少 8 case：
1. 空 input → []
2. photos length 9 → too_many
3. photos 內含非 string → invalid
4. tags 含 id 不在 index → invalid
5. tags 含 scope=driver 的 id → mismatch（vehicleProfile 不收 driver-scope）
6. tags 含 2 個 power group → mutex_violation
7. tags 含 2 個 interior group（multi）→ []
8. tags + photos 同時合法 → []

## 3. Server 層

### 3.1 `server/utils/vehicle-profile.ts`

```ts
/**
 * 從 tags collection 拉所有 active tag，組成 id → { group, scope } map。
 * 給 validation 與 audit log 名稱顯示用。
 */
export async function buildTagIndex(db: Firestore): Promise<Map<string, TagIndexEntry>>

export interface TagIndexEntry {
  id: string
  group: TagGroup
  scope: TagScope
  nameZh: string  // audit log payload 顯示用
}

/**
 * driver-scope tag 驗證（單獨給 tags.patch.ts 用）— 不檢 mutex（driverSkill 只有 multi group）
 */
export function validateDriverTags(tags: string[], index: Map<string, TagIndexEntry>): string | null
```

### 3.2 7 個 endpoint

統一遵 `@@/utils/response`；錯誤訊息三語；auth 細節如下：

#### 3.2.1 `PATCH /nuxt-api/drivers/me/tags`
- Auth: driver self
- Body: `{ tags: string[] }`
- 驗證：每個 tag id 存在於 active tags、scope='driver'
- 寫入：`drivers/{lineUid}.tags = input.tags`
- Audit: `driver.tags_update`，payload `{ before, after }`

#### 3.2.2 `PATCH /nuxt-api/drivers/me/vehicle-profile`
- Auth: driver self
- Body: `{ photos?: string[]; tags?: string[] }`（partial，**只更新 pending**）
- 驗證：呼叫 `validateVehicleProfileShape` + tagIndex
- 寫入：`drivers/{lineUid}.vehicleProfilePending = { ...existing, ...input, status: 'draft' }`
  - 若先前 status='rejected'，patch 後 status 自動回 'draft'（允許基於 reject 內容續編）
- **不寫 audit log**（草稿頻繁變動會炸 log 量；送審/退回時才寫）

#### 3.2.3 `POST /nuxt-api/drivers/me/vehicle-profile` （送審）
- Auth: driver self
- Body: 無
- 條件：vehicleProfilePending 必須存在且 status ∈ {'draft', 'rejected'}
- 寫入：vehicleProfilePending.status = 'pending_review' + submittedAt = serverTimestamp
- Audit: `driver.vehicle_profile_submit`，payload `{ pending }`
- LINE push：通知所有具 canManageDrivers 權限的 admin（複用既有 sendLinePush）

#### 3.2.4 `DELETE /nuxt-api/drivers/me/vehicle-profile` （捨棄 pending）
- Auth: driver self
- 條件：vehicleProfilePending.status !== 'pending_review'（送審後不可自行捨棄；要 admin reject）
- 寫入：`vehicleProfilePending = null`
- 無 audit log（無業務影響）

#### 3.2.5 `POST /nuxt-api/drivers/me/vehicle-photo-upload`
- Auth: driver self
- Multipart: `file`（單一檔）
- 驗證：≤ 5MB、jpg/png/webp、檔名安全
- 上傳：Storage `drivers/{lineUid}/vehicle-profile/{timestamp}.{ext}`
- 回傳：`{ url: signedUrl }`（TTL 1 年；與 driver/upload 一致 = `DRIVER_DOC_TTL_MS`）
- **不直接寫 doc**；driver 端拿到 url 後再呼叫 vehicle-profile.patch 加進 photos

#### 3.2.6 `POST /nuxt-api/admin/drivers/[uid]/vehicle-profile-review`
- Auth: admin + canManageDrivers
- Body:
  ```ts
  {
    decision: 'approve' | 'reject'
    reason?: string  // reject 時必填
  }
  ```
- 條件：vehicleProfilePending.status === 'pending_review'
- approve：
  - `vehicleProfile = { photos, tags, updatedAt: serverTimestamp }`
  - `vehicleProfilePending = null`
  - `verifiedAt = serverTimestamp`、`verifiedBy = admin uid`
- reject：
  - vehicleProfilePending.status = 'rejected'
  - rejectedAt + rejectReason + reviewedBy
  - 保留 photos/tags 內容（議題 #7）
- Audit: `driver.vehicle_profile_review`，payload `{ decision, before, after, reason? }`
- LINE push：通知該 driver（approve / reject + reason）

### 3.3 既有 `server/utils/audit-log.ts` 修改

```ts
export type AuditAction =
  // ... existing
  | 'driver.tags_update'
  | 'driver.vehicle_profile_submit'
  | 'driver.vehicle_profile_review'
```

無新 collection / 無新 targetType（沿用 'driver'）。

## 4. Protocol 層

### 4.1 `app/protocol/fetch-api/api/driver/index.ts` 加：

```ts
export const PatchDriverTags = (body: { tags: string[] }) =>
  methods.patch<{ ok: true }>('/nuxt-api/drivers/me/tags', body)

export const PatchVehicleProfile = (body: { photos?: string[]; tags?: string[] }) =>
  methods.patch<{ ok: true }>('/nuxt-api/drivers/me/vehicle-profile', body)

export const SubmitVehicleProfile = () =>
  methods.post<{ ok: true }>('/nuxt-api/drivers/me/vehicle-profile')

export const DiscardVehicleProfile = () =>
  methods.delete<{ ok: true }>('/nuxt-api/drivers/me/vehicle-profile')

export const UploadVehiclePhoto = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return methods.postMultipart<{ url: string }>('/nuxt-api/drivers/me/vehicle-photo-upload', fd)
}
```

> 確認 `methods.delete` / `methods.postMultipart` 既有；若無走 `$fetch` 直接打。

### 4.2 `app/protocol/fetch-api/api/admin/index.ts` 加：

```ts
export const PostVehicleProfileReview = (
  uid: string,
  body: { decision: 'approve' | 'reject'; reason?: string },
) => methods.post<{ ok: true }>(
  `/nuxt-api/admin/drivers/${encodeURIComponent(uid)}/vehicle-profile-review`,
  body as Record<string, unknown>,
)
```

加 `DriverApplication` 擴充（既有 interface 加欄位，型別需嚴格符合 server 寫入結構）：
```ts
export interface VehicleProfileDto {
  photos: string[]
  tags: string[]
  updatedAt: string | null
}
export interface VehicleProfilePendingDto extends VehicleProfileDto {
  status: 'draft' | 'pending_review' | 'rejected'
  submittedAt: string | null
  rejectedAt: string | null
  rejectReason: string | null
  reviewedBy: string | null
}
```

並擴充 `AdminUser` / `DriverApplication` 範圍（admin/drivers 端點需 echo 這些欄位）。

## 5. Driver UI

### 5.1 `app/pages/driver/profile/index.vue` 加 section

在既有「個人資料 / 證件」之後，加：

```pug
.DriverProfile__section
  h3 車輛資料
  VehicleProfileEditor(
    :driver-tags="driver.tags"
    :vehicle-profile="driver.vehicleProfile"
    :pending="driver.vehicleProfilePending"
    @refresh="ApiLoadDriver"
  )
```

### 5.2 `app/components/driver/VehicleProfileEditor.vue` 🆕

- props: 接 driver tags + vehicleProfile current + pending
- 載入 active tags（呼叫 `GetActiveTags()`，無 scope filter 一次拿；client cache 5 分鐘）
- 上方：driverSkill group（多選 chip）→ change 立即 PatchDriverTags
- 下方：「車輛 Profile」卡片
  - 顯示 status badge（unverified / pending_review / rejected / verified）
  - 5 個 vehicle-scope group picker（單/多選 chip）
  - photo grid（最多 8 張 + 「+」上傳按鈕）
  - 底部按鈕：
    - 若 status ∈ {null, draft, rejected}：「儲存草稿」（auto-saves on each change）+「送審」+「捨棄變更」
    - 若 status='pending_review'：disable 編輯 + 顯示「待 admin 審核中」+「撤回」按鈕（呼叫 DELETE）— 議題 #6 撤回設計
    - 若 verified（無 pending）：「重新編輯」按鈕複製 current → pending status='draft'

### 5.3 `app/components/driver/TagGroupPicker.vue` 🆕

共用元件：
- props: `group: TagGroup`、`tags: TagDto[]`、`modelValue: string[]`
- 依 `TAG_GROUPS[group].multiplicity` 渲染：
  - single → 一排 chip，點擊互斥
  - multi → 一排 chip，點擊 toggle
- emit `update:modelValue`

## 6. Admin UI

### 6.1 `app/pages/admin/drivers/index.vue` 列表加徽章

每 row 後加「⚠ 待審車輛」徽章（v-if 該 driver `vehicleProfilePending?.status === 'pending_review'`）

> 列表已 echo `vehicleProfilePending`，server `admin/users` endpoint 要對應 echo 欄位。

### 6.2 `app/pages/admin/drivers/[uid].vue` 詳情頁加 section

```pug
.AdminDriverDetail__section(v-if="driver.vehicleProfile || driver.vehicleProfilePending")
  h3 車輛 Profile
  AdminVehicleProfileReview(
    :uid="uid"
    :current="driver.vehicleProfile"
    :pending="driver.vehicleProfilePending"
    :verified-at="driver.verifiedAt"
    :verified-by="driver.verifiedBy"
    :tag-index="tagIndex"
    @refresh="ApiLoadDriver"
  )
```

預先 onMounted 載 active tags 組 tagIndex map（用來把 tag id 轉中文顯示）。

### 6.3 `app/components/admin/VehicleProfileReview.vue` 🆕

- 兩欄並排：左 current（or「尚未驗證」）/ 右 pending
- 每欄顯示：photos grid + tag chip list（用 tagIndex 轉名稱）
- 底部 actions（僅 pending status='pending_review' 時顯示）：
  - approve 按鈕
  - reject：點開 ElInput textarea 填 reason + confirm
- 兩個動作均呼叫 `$api.PostVehicleProfileReview(uid, { decision, reason? })`

## 7. Firestore rules（不動）

`drivers/{lineUid}` 既有規則已 cover：read=auth.self|admin / write=server。
本 phase 新增的 4 個 top-level 欄位都在 drivers doc 內，無需新增 rules。

Storage 規則：
- 既有 `drivers/{lineUid}/` 路徑由 Storage rules 允許 server-side 寫；本 phase 在底下開 `vehicle-profile/` 子資料夾，沿用同規則。

## 8. Tests

### 8.1 Unit (`shared/vehicleProfile.spec.ts`)

Vitest，至少 8 case（見 §2.2）。

### 8.2 Integration

無 E2E（留 1G）。Admin / driver 端手動 smoke 一輪：
- driver 編 tags（driver-scope）→ 立即生效
- driver 編 vehicleProfile → 自動存 pending（draft）
- driver 上傳 1 張照片 → grid 出現
- driver 送審 → admin 列表出現徽章
- admin reject → driver 看到原因
- driver 重編後再送 → admin approve → verified 徽章寫入

## 9. i18n

`zh.js` 加：

```js
driver: {
  vehicleProfile: {
    title: '車輛資料',
    statusUnverified: '尚未提交審核',
    statusDraft: '草稿（未送審）',
    statusPendingReview: '審核中',
    statusRejected: '審核退回',
    statusVerified: '已驗證',
    rejectReasonLabel: '退回原因',
    btnSubmit: '送審',
    btnDiscard: '捨棄變更',
    btnWithdraw: '撤回送審',
    btnReedit: '重新編輯',
    photoUpload: '上傳照片',
    photoMaxHint: '最多 8 張，每張 ≤ 5 MB（jpg / png / webp）',
    submitConfirm: '確定送出本次變更給 admin 審核？',
    discardConfirm: '確定捨棄所有未儲存變更？',
    withdrawConfirm: '撤回送審後 admin 將不再審核此次提交。確定撤回？',
  },
  driverSkill: {
    title: '司機能力標籤',
    desc: '勾選自己具備的能力（變更立即生效，不需審核）',
  },
},
admin: {
  driverReview: {
    sectionTitle: '車輛 Profile 審核',
    columnCurrent: '目前（verified）',
    columnPending: '待審內容',
    badgePendingReview: '待審',
    approveBtn: '核准（替換 current）',
    rejectBtn: '退回',
    rejectReasonLabel: '退回原因（會發給司機）',
    approveConfirm: '確定核准？此標籤組與照片將取代目前 verified 內容。',
    rejectConfirm: '確定退回此次提交？',
    verifiedAt: '上次驗證時間',
  },
},
```

`en.js` / `ja.js` 同 keys，值暫沿用繁中（議題 #14）。

## 10. 部署 / commit 策略

- commit message：`feat: Phase 1B — driver/vehicle profile + 標籤掛載 + admin 審核`
- **不 push**
- 不 deploy rules
- 留 1G 統一 push + deploy

## 11. 留尾 / 不在本 phase 範圍

- 車輛公開檔案頁（passenger 端可看 driver verified profile）→ Phase 1C
- Booking nice-to-have 勾選 + 動態 pricing → Phase 1D
- 訂單需求單 / 喊單 / 配對 → Phase 1E
- Soft Match / 重新配對 → Phase 1F
- E2E / push prod / rules deploy → Phase 1G
- 多車支援 → 不在 1A-1G 範圍
- 標籤審核抽查機制（admin 對 driver-scope tag 抽查）→ Phase 2
