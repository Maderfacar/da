# Design — Phase 1C 車輛公開檔案頁

## 1. server endpoint

### 1.1 `GET /nuxt-api/vehicles/[driverId]`

- **Auth**: 無（公開可讀）
- **Path param**: `driverId` = lineUid（drivers doc id，去 `line:` prefix）
- **Query**: `?lang=zh_tw|en|ja`（可選；預設 `zh_tw`）

#### Response shape

```ts
interface VehiclePublicDto {
  driverDisplayName: string         // 遮罩後顯示名
  completedOrders: number           // drivers doc 既有 completedOrders
  driverSkillTags: VehiclePublicTagDto[]
  vehicleProfile: {
    photos: string[]                // resigned signed URLs（TTL 4h）
    tags: VehiclePublicTagDto[]
    verifiedAt: string              // ISO timestamp
  }
}

interface VehiclePublicTagDto {
  id: string
  name: string                      // 已 localized
  group: TagGroup
  sortOrder: number
}
```

#### server 邏輯

1. 讀 `drivers/{driverId}` doc
2. 守則：
   - doc 不存在 → `return notFoundError({ zh_tw: '找不到車輛', en: 'Vehicle not found', ja: '車両が見つかりません' })`
   - `vehicleProfile == null` 或 `verifiedAt == null` → 同上 404
3. 解析 lang param（白名單 `['zh_tw','en','ja']`；無 / 非法 → `'zh_tw'`）
4. 收集 tag id 集合：`new Set([...vehicleProfile.tags, ...(driverTags ?? [])])`
5. 批次讀 `tags` collection（`db.collection('tags').where(...).get()` 或逐 id `getAll`；只取 `status==='active'`）
6. 對每個 tag 用 `localizedTagName(tag, lang)`（已存在於 `shared/tagTaxonomy.ts`）
7. tags 分流：vehicle-scope → `vehicleProfile.tags`；driver-scope → `driverSkillTags`
8. 排序：依 `TAG_GROUPS[group].sortOrder` 升序，再依 `tag.sortOrder` 升序
9. signed URL 重簽：對 `vehicleProfile.photos` 每張呼叫 Storage `getSignedUrl({ action: 'read', expires: now + 4h })`
10. `driverDisplayName` 遮罩 helper：
    ```ts
    function maskDriverName(driver: { displayName?: string }, uid: string, lang: 'zh_tw'|'en'|'ja'): string {
      if (driver.displayName?.trim()) return driver.displayName.trim()
      const suffix = uid.slice(-4)
      return lang === 'en' ? `Driver ${suffix}`
           : lang === 'ja' ? `ドライバー ${suffix}`
           : `司機 ${suffix}`
    }
    ```

#### 隱私守則
- 絕不 echo：完整 `lineUid` / `phone` / `email` / `vehicleProfilePending` / audit fields / `verifiedBy`（admin uid）
- response 內 driverId（給前端做後續 booking 用）可用，但只 echo path param 原值

## 2. UI

### 2.1 Page route `app/pages/vehicles/[driverId].vue`

```vue
<script setup lang="ts">
definePageMeta({ layout: 'front-desk' });

const route = useRoute();
const driverId = computed(() => String(route.params.driverId ?? ''));
const { locale } = useI18n();
</script>

<template lang="pug">
.VehiclePublicPage
  ClientOnly
    VehiclePublicProfile(:driver-id="driverId" :lang="locale")
</template>
```

**注意**：本頁需可未登入訪問。確保 `front-desk` layout 不強制 auth middleware；若有就加 `middleware: []` 覆寫。

### 2.2 主元件 `VehiclePublicProfile.vue`

責任：
- 呼叫 `$api.GetVehiclePublic(driverId, lang)` 載資料
- 處理 loading / error / 404
- 組 hero + photo gallery + tag groups + CTA

UI 結構（pug）：

```pug
.VehiclePublicProfile(v-if="profile")
  // Hero
  .VehiclePublicProfile__hero
    .VehiclePublicProfile__driver-name
      span {{ profile.driverDisplayName }}
      span.VehiclePublicProfile__verified-badge(v-if="profile.vehicleProfile.verifiedAt")
        | ✓ {{ $t('vehicle.public.verified') }}
    .VehiclePublicProfile__stats
      | {{ $t('vehicle.public.completedOrders', { count: profile.completedOrders }) }}
    .VehiclePublicProfile__verified-at
      | {{ $t('vehicle.public.verifiedAt', { date: formatDate(profile.vehicleProfile.verifiedAt) }) }}

  // Photos
  VehiclePhotoGallery(:photos="profile.vehicleProfile.photos")

  // Vehicle tags
  .VehiclePublicProfile__section(v-if="profile.vehicleProfile.tags.length")
    h3.VehiclePublicProfile__section-title {{ $t('vehicle.public.vehicleFeatures') }}
    VehicleTagChipGroup(:tags="profile.vehicleProfile.tags")

  // Driver tags
  .VehiclePublicProfile__section(v-if="profile.driverSkillTags.length")
    h3.VehiclePublicProfile__section-title {{ $t('vehicle.public.driverSkills') }}
    VehicleTagChipGroup(:tags="profile.driverSkillTags")

  // CTA
  .VehiclePublicProfile__cta
    ElButton(disabled type="primary" size="large")
      | {{ $t('vehicle.public.bookCta') }}
    .VehiclePublicProfile__cta-hint {{ $t('vehicle.public.bookCtaHint') }}

.VehiclePublicProfile__notfound(v-else-if="errorStatus === 404")
  h2 {{ $t('vehicle.public.notFound') }}
```

### 2.3 子元件

#### `VehiclePhotoGallery.vue`
- Props: `photos: string[]`
- 用 `ElImage` + `preview-src-list`（既有專案慣例可 grep `ElImage` 確認）
- Layout：mobile 2 cols / tablet 3 cols / desktop 4 cols
- Loading skeleton

#### `VehicleTagChipGroup.vue`
- Props: `tags: VehiclePublicTagDto[]`
- 依 `group` 分區，每群 header 顯示群組名（用 `TAG_GROUPS[group].label[lang]`）
- 每個 chip 顯示 `tag.name`（已 localized）
- 樣式：cream theme，圓角 chip

### 2.4 設計風格

對齊既有乘客端 cream theme（參考 `app/pages/booking/`、`app/pages/orders/`、`app/pages/fleet/`）。
- 主色：cream background + warm accent
- Verified 徽章：用既有 success 色或自定 sage / amber accent
- Photo gallery：圓角 12px、陰影柔和

### 2.5 響應式 breakpoints

對齊既有 `rwd.scss` mixin。最低支援 320px。

## 3. i18n (`vehicle.public.*`)

完整三語（**不 fallback 繁中**，本 phase 真的展開英日翻譯）：

```js
// zh
vehicle: {
  public: {
    title: '車輛資訊',
    verified: '已驗證',
    verifiedAt: '認證於 {date}',
    completedOrders: '已完成 {count} 趟',
    driverSkills: '司機能力',
    vehicleFeatures: '車輛特色',
    photoCount: '{count} 張照片',
    bookCta: '預約此車',
    bookCtaHint: '即將開放（將於 Phase 1D 上線）',
    notFound: '找不到車輛資訊',
    notFoundDesc: '此車輛尚未通過驗證或不存在。',
  }
}

// en
vehicle: {
  public: {
    title: 'Vehicle Profile',
    verified: 'Verified',
    verifiedAt: 'Verified on {date}',
    completedOrders: '{count} trips completed',
    driverSkills: 'Driver Skills',
    vehicleFeatures: 'Vehicle Features',
    photoCount: '{count} photos',
    bookCta: 'Book this vehicle',
    bookCtaHint: 'Coming soon (Phase 1D)',
    notFound: 'Vehicle not found',
    notFoundDesc: 'This vehicle has not been verified or does not exist.',
  }
}

// ja
vehicle: {
  public: {
    title: '車両情報',
    verified: '認証済',
    verifiedAt: '{date} 認証',
    completedOrders: '{count} 回完了',
    driverSkills: 'ドライバー',
    vehicleFeatures: '車両特徴',
    photoCount: '{count} 枚の写真',
    bookCta: 'この車両を予約',
    bookCtaHint: '近日公開（Phase 1D）',
    notFound: '車両が見つかりません',
    notFoundDesc: 'この車両は認証されていないか、存在しません。',
  }
}
```

## 4. Tests

- 不寫 component 單元測試（手測為主）
- server endpoint smoke 由 admin/passenger 真機跑
- E2E 留 1G

## 5. 留尾（不在本 phase 範圍）

- booking 流程連結進公開頁 → Phase 1D（在 booking 配對結果區塊放「查看車輛詳情」連結）
- SEO / OG meta + 分享連結預覽圖 → Phase 2
- 評分系統 → Phase 2+
- server 端 response 快取（key by `verifiedAt`） → Phase 1G 評估
