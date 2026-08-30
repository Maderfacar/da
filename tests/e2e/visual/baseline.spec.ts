// 視覺回歸基線（W0.2）
//
// 目的：全站 49% 的程式碼是 <style>（26,593 / 54,733 行），而既有 610+ 測試全是邏輯測試。
// 動全站色彩而無截圖比對，破圖會靜默發生。這組基線就是那道防護網。
//
// 用法（**對 production build 拍，不要用 dev server**）：
//   1. `pnpm build`
//   2. `PORT=3000 node .output/server/index.mjs`
//      ⚠ **不要加 NUXT_PUBLIC_TEST_MODE=T**。那個 env 不只 auth plugin 在看 ——
//        app/protocol/fetch-api/api/{order,auth,file}/index.ts 的 IsMock() 也看它，為 T 時
//        整層 API 直接回罐頭資料、完全不發請求，於是 fixtures 的 page.route 與下面的 seed
//        全部被繞過，拍到的是「另一組資料」的畫面。身分 mock 靠 window.__E2E_MODE__ 就夠。
//   3. 產生／更新基線：`npx playwright test tests/e2e/visual --update-snapshots`
//   4. 比對：`npx playwright test tests/e2e/visual`
//
// 為什麼不用 dev server：實測 dev 的 vite-node 會 IPC crash，讓 /admin/* 回 500
// （production build 同一路徑是 200）。那是 dev 基礎設施的不穩定，不是應用的錯，
// 但會污染基線。順帶好處：prod server 沒有隨編譯，整輪從 2.7 分鐘降到 45 秒。
//
// 換色票後預期「全部 diff」—— 那不是失敗，是要逐張人工確認「變得對」後才接受新基線。
//
// 身分沿用 tests/e2e/auth/fixtures.ts 的 mock（不打真實 Firebase / LINE）。
import { test, expect } from '../auth/fixtures';
import type { Page } from '@playwright/test';

// 司機端沒有定位權限就會被「需要位置權限」全屏彈窗蓋住，整張基線只剩那個 modal。
// 預先授權 + 給一個固定座標（台北車站），讓畫面穩定且拍得到底下的實際 UI。
// ⚠ iPhone 14（WebKit）基線能不能拍到 CSS，取決於下面那個 stripSecurityHeaders。
//
// 專案的 CSP 含 `upgrade-insecure-requests`（server/utils/security-headers.ts）。
// Chromium 對 localhost / 127.0.0.1 這類 potentially-trustworthy origin 豁免該指令，
// **WebKit 不豁免** —— 於是 WebKit 把 `http://localhost:3000/static/entry.css` 升級成
// `https://` 然後 SSL connect error，整張 entry.css 靜默載入失敗。
// 頁面照樣渲染，只是完全沒有 design token（`--da-*` / `--ink` / `--accent` 全解析為空）。
//
// 這就是舊基線裡「iPhone 14 的 /booking /home /orders 三張截圖 md5 完全相同」的真正原因：
// 那不是 boot/hydration race，是三張都在拍沒有 CSS 的頁面，所以長得一樣。
// 換句話說 **iPhone 14 那 11 張基線在此之前驗不到任何 token 相關的東西**。
//
// 在 prod 全站走 https，`upgrade-insecure-requests` 是 no-op —— 這純粹是「本地用 http
// 跑 prod server」造成的測試假象，不是應用缺陷，所以不動 production 的 CSP。
//
// 注意：Playwright 的 `bypassCSP: true` **救不了這個**（實測 WebKit 下 `--da-amber` 仍為空）。
// 它不涵蓋 upgrade-insecure-requests，必須從 response header 把 CSP 拿掉才有效。
test.use({
  permissions: ['geolocation'],
  geolocation: { latitude: 25.0478, longitude: 121.5170 },
});


type Identity = 'passenger' | 'driverApproved' | 'adminWith2fa';

interface VisualTarget {
  /** 截圖檔名（不含副檔名與 project 後綴） */
  name: string;
  path: string;
  identity: Identity;
  /**
   * 需要有資料才看得到的畫面。fixtures 的列表端點一律回 []，空狀態下卡片根本不渲染，
   * 基線就拍不到那些樣式 —— 於是「做完了但沒人看過」。這裡在 loginAs 之後覆蓋端點回應。
   * key = pathname 片段，value = data 欄位內容。
   */
  seed?: Readonly<Record<string, unknown>>;
  /** 拍照前要先做的事（例：切到某個分頁）。 */
  beforeShot?: (page: Page) => Promise<void>;
}

/**
 * 司機需求單卡的假資料。
 * 這張卡是「金額襯線 · 派單等級章 · 倒數不佔用紅」三條規則的落點，
 * 三張單分別涵蓋：最高等級（古銅章）+ 緊急倒數、全體開放（素色章、無倒數）、已喊單。
 * 時間全部釘在 clock.setFixedTime 的 2026-08-27T09:30:00+08:00 附近，倒數才是定值。
 */
const DISPATCHED_SEED = [
  {
    orderId: 'seedaaa1b2c3d4', orderType: 'airport-pickup',
    pickupDateTime: '2026-08-27T15:40:00+08:00',
    pickupLocation: { address: '桃園市大園區航站南路 9 號', lat: 25.0777, lng: 121.2328, displayName: '桃園機場 T2', city: '桃園市', district: '大園區' },
    dropoffLocation: { address: '台北市中山區南京東路二段 1 號', lat: 25.0524, lng: 121.5238, displayName: '台北 中山區', city: '台北市', district: '中山區' },
    stopovers: [], vehicleType: 'mpv-family', passengerCount: 4, adultCount: 3, childCount: 1,
    estimatedFare: 1450, distanceKm: 41.6, notes: null, flightNumber: 'BR128', terminal: 'T2',
    preferences: null, dispatchAt: '2026-08-27T09:20:00+08:00', activeBidCount: 0, myBidStatus: 'none',
    dispatchCurrentLevel: '2', dispatchOpenedAt: '2026-08-27T09:20:00+08:00',
    dispatchNextDowngradeAt: '2026-08-27T09:30:45+08:00',
  },
  {
    orderId: 'seedbbb2c3d4e5', orderType: 'airport-dropoff',
    pickupDateTime: '2026-08-28T09:15:00+08:00',
    pickupLocation: { address: '台北市信義區信義路五段 7 號', lat: 25.0339, lng: 121.5645, displayName: '台北 信義區', city: '台北市', district: '信義區' },
    dropoffLocation: { address: '台北市松山區敦化北路 340 號', lat: 25.0637, lng: 121.5520, displayName: '松山機場', city: '台北市', district: '松山區' },
    stopovers: [], vehicleType: 'sedan-suv', passengerCount: 2, adultCount: 2, childCount: 0,
    estimatedFare: 680, distanceKm: 8.2, notes: null, flightNumber: null, terminal: null,
    preferences: null, dispatchAt: '2026-08-27T08:00:00+08:00', activeBidCount: 2, myBidStatus: 'none',
    dispatchCurrentLevel: '0', dispatchOpenedAt: '2026-08-27T08:00:00+08:00',
    dispatchNextDowngradeAt: null,
  },
  {
    orderId: 'seedccc3d4e5f6', orderType: 'charter',
    pickupDateTime: '2026-08-29T08:00:00+08:00',
    pickupLocation: { address: '台中市西屯區台灣大道三段 251 號', lat: 24.1657, lng: 120.6417, displayName: '台中 西屯區', city: '台中市', district: '西屯區' },
    dropoffLocation: { address: '南投縣仁愛鄉大同村仁和路 170 號', lat: 24.0000, lng: 121.1500, displayName: '清境農場', city: '南投縣', district: '仁愛鄉' },
    stopovers: [], vehicleType: 'van-9', passengerCount: 7, adultCount: 7, childCount: 0,
    estimatedFare: 12800, distanceKm: 96.4, notes: null, flightNumber: null, terminal: null,
    preferences: null, dispatchAt: '2026-08-27T09:00:00+08:00', activeBidCount: 1, myBidStatus: 'bid',
    dispatchCurrentLevel: '1', dispatchOpenedAt: '2026-08-27T09:00:00+08:00',
    dispatchNextDowngradeAt: '2026-08-27T09:36:00+08:00',
  },
];

/**
 * 登入後乘客首頁「下一趟」與「最新公告」的假資料。
 * 兩塊都是 v-if 有資料才渲染 —— 空狀態基線只拍得到 hero 與行銷段。
 * ⚠ 「快速操作」的筆數蓋不到：GetOrderList 在 testMode='T' 時走 mock-res 不出門，
 *   route mock 攔不到，所以那個數字在基線裡永遠是 0。
 */
const UPCOMING_SEED = {
  orderId: 'seedhome1a2b3c', orderType: 'airport-pickup',
  pickupDateTime: '2026-08-27T15:40:00+08:00',
  pickupLocation: { address: '桃園市大園區航站南路 9 號', lat: 25.0777, lng: 121.2328, displayName: '桃園機場 T2', city: '桃園市', district: '大園區' },
  dropoffLocation: { address: '台北市中山區南京東路二段 1 號', lat: 25.0524, lng: 121.5238, displayName: '台北 中山區', city: '台北市', district: '中山區' },
  stopovers: [], vehicleType: 'mpv-family', passengerCount: 4, adultCount: 3, childCount: 1,
  estimatedFare: 1450, orderStatus: 'confirmed', flightNumber: 'BR128',
  driver: {
    displayName: '張大明', plateNumber: 'ABC-1234',
    vehicleType: 'mpv', vehicleModel: 'Toyota Alphard', phone: '0912345678',
  },
};

/**
 * 訂單列表假資料（/nuxt-api/orders）。
 * 空狀態拍不到「狀態流程條」—— 那正是口袋航廈第四版第三張畫面的主角，
 * 所以三筆刻意落在流程的不同站：已敲定 / 已成立 / 已完成。
 */
const ORDERS_SEED = [
  {
    orderId: 'seedord1a2b3c', orderType: 'airport-pickup',
    pickupDateTime: '2026-08-27T15:40:00+08:00',
    pickupLocation: { address: '桃園市大園區航站南路 9 號', lat: 25.0777, lng: 121.2328, displayName: '桃園機場 T2', city: '桃園市', district: '大園區' },
    dropoffLocation: { address: '台北市中山區南京東路二段 1 號', lat: 25.0524, lng: 121.5238, displayName: '台北 中山區', city: '台北市', district: '中山區' },
    stopovers: [], vehicleType: 'mpv-family', passengerCount: 4,
    estimatedFare: 1450, orderStatus: 'confirmed', flightNumber: 'BR128',
  },
  {
    orderId: 'seedord2a2b3c', orderType: 'airport-dropoff',
    pickupDateTime: '2026-09-03T06:15:00+08:00',
    pickupLocation: { address: '台北市信義區市府路 1 號', lat: 25.0330, lng: 121.5654, displayName: '台北 信義區', city: '台北市', district: '信義區' },
    dropoffLocation: { address: '桃園市大園區航站南路 15 號', lat: 25.0797, lng: 121.2342, displayName: '桃園機場 T1', city: '桃園市', district: '大園區' },
    stopovers: [], vehicleType: 'sedan-business', passengerCount: 2,
    estimatedFare: 1380, orderStatus: 'pending', flightNumber: 'CI102',
  },
  {
    orderId: 'seedord3a2b3c', orderType: 'airport-dropoff',
    pickupDateTime: '2026-08-14T09:20:00+08:00',
    pickupLocation: { address: '台北市大安區信義路四段 1 號', lat: 25.0330, lng: 121.5450, displayName: '台北 大安區', city: '台北市', district: '大安區' },
    dropoffLocation: { address: '台北市松山區敦化北路 340 號', lat: 25.0637, lng: 121.5520, displayName: '松山機場', city: '台北市', district: '松山區' },
    stopovers: [], vehicleType: 'mpv-family', passengerCount: 3,
    estimatedFare: 980, orderStatus: 'completed', flightNumber: '',
  },
];

const ANNOUNCEMENTS_SEED = {
  items: [
    { id: 'seednews1', title: '中秋連假加成時段公告', coverImageUrl: null, publishedAt: '2026-08-20T10:00:00+08:00', isRead: false, category: 'announcement' },
    { id: 'seednews2', title: '桃園機場 T1 接機點調整', coverImageUrl: null, publishedAt: '2026-08-12T10:00:00+08:00', isRead: true, category: 'announcement' },
  ],
  nextCursor: null,
};

/**
 * 司機任務列表的假資料（/nuxt-api/orders/assigned）。
 * 任務卡的車資同樣換了襯線，空狀態一樣拍不到。
 */
const ASSIGNED_SEED = [
  {
    orderId: 'seedtrip1a2b3c', userId: 'u-seed-1', orderType: 'airport-pickup',
    pickupDateTime: '2026-08-27T15:40:00+08:00',
    pickupLocation: { address: '桃園市大園區航站南路 9 號', lat: 25.0777, lng: 121.2328, displayName: '桃園機場 T2', city: '桃園市', district: '大園區' },
    dropoffLocation: { address: '台北市中山區南京東路二段 1 號', lat: 25.0524, lng: 121.5238, displayName: '台北 中山區', city: '台北市', district: '中山區' },
    stopovers: [], vehicleType: 'mpv-family', passengerCount: 4, adultCount: 3, childCount: 1,
    luggageItems: [], estimatedFare: 1450, estimatedTime: 52, distanceKm: 41.6, extraServices: [],
    flightNumber: 'BR128', terminal: 'T2', notes: null, orderStatus: 'en_route',
    createdAt: 1787000000000, passengerName: '王小姐', passengerPhone: '0912345678',
    passengerConfirmationStatus: null,
  },
  {
    orderId: 'seedtrip2b3c4d', userId: 'u-seed-2', orderType: 'charter',
    pickupDateTime: '2026-08-29T08:00:00+08:00',
    pickupLocation: { address: '台中市西屯區台灣大道三段 251 號', lat: 24.1657, lng: 120.6417, displayName: '台中 西屯區', city: '台中市', district: '西屯區' },
    dropoffLocation: { address: '南投縣仁愛鄉大同村仁和路 170 號', lat: 24.0000, lng: 121.1500, displayName: '清境農場', city: '南投縣', district: '仁愛鄉' },
    stopovers: [], vehicleType: 'van-9', passengerCount: 7, adultCount: 7, childCount: 0,
    luggageItems: [], estimatedFare: 12800, estimatedTime: 128, distanceKm: 96.4, extraServices: [],
    flightNumber: null, terminal: null, notes: null, orderStatus: 'confirmed',
    createdAt: 1787000200000, passengerName: '林小姐', passengerPhone: '0933444555',
    passengerConfirmationStatus: 'pending',
  },
];

/** 需求單詳情用：列表第一張單再補三個 detail-only 欄位。 */
const DISPATCHED_DETAIL_SEED = {
  ...DISPATCHED_SEED[0],
  luggageItems: [{ typeId: 'suitcase-l', count: 3 }],
  extraServices: [], estimatedTime: 52,
};

/**
 * Admin 訂單列表的假資料。
 * 訂單為空時整張表（含表頭）不渲染 —— 「表頭底色」「列 hover」兩條規則
 * 在空狀態基線裡是驗不到的。
 */
const ADMIN_ORDERS_SEED = [
  {
    orderId: 'seedadm1a2b3c4', userId: 'u-seed-1', lineUserId: 'U-seed-1', orderType: 'airport-pickup',
    pickupDateTime: '2026-08-27T15:40:00+08:00',
    pickupLocation: { address: '桃園市大園區航站南路 9 號', lat: 25.0777, lng: 121.2328, displayName: '桃園機場 T2', city: '桃園市', district: '大園區' },
    dropoffLocation: { address: '台北市中山區南京東路二段 1 號', lat: 25.0524, lng: 121.5238, displayName: '台北 中山區', city: '台北市', district: '中山區' },
    stopovers: [], vehicleType: 'mpv-family', passengerCount: 4, adultCount: 3, childCount: 1,
    luggageItems: [], estimatedFare: 1450, estimatedTime: 52, distanceKm: 41.6, extraServices: [],
    flightNumber: 'BR128', terminal: 'T2', notes: null, orderStatus: 'pending', assignedDriverId: '',
    cancelReason: null, createdAt: 1787000000000, passengerName: '王小姐', passengerPhone: '0912345678',
    preferences: null, dispatchAt: null, bids: [],
  },
  {
    orderId: 'seedadm2b3c4d5', userId: 'u-seed-2', lineUserId: 'U-seed-2', orderType: 'airport-dropoff',
    pickupDateTime: '2026-08-28T09:15:00+08:00',
    pickupLocation: { address: '台北市信義區信義路五段 7 號', lat: 25.0339, lng: 121.5645, displayName: '台北 信義區', city: '台北市', district: '信義區' },
    dropoffLocation: { address: '台北市松山區敦化北路 340 號', lat: 25.0637, lng: 121.5520, displayName: '松山機場', city: '台北市', district: '松山區' },
    stopovers: [], vehicleType: 'sedan-suv', passengerCount: 2, adultCount: 2, childCount: 0,
    luggageItems: [], estimatedFare: 680, estimatedTime: 22, distanceKm: 8.2, extraServices: [],
    flightNumber: null, terminal: null, notes: null, orderStatus: 'pending', assignedDriverId: '',
    cancelReason: null, createdAt: 1787000100000, passengerName: '陳先生', passengerPhone: '0922333444',
    preferences: null, dispatchAt: '2026-08-27T09:00:00+08:00', dispatchCount: 1,
    bids: [{ driverId: 'd-seed-1', bidAt: '2026-08-27T09:05:00+08:00', withdrawnAt: null }],
  },
  {
    orderId: 'seedadm3c4d5e6', userId: 'u-seed-3', lineUserId: 'U-seed-3', orderType: 'charter',
    pickupDateTime: '2026-08-29T08:00:00+08:00',
    pickupLocation: { address: '台中市西屯區台灣大道三段 251 號', lat: 24.1657, lng: 120.6417, displayName: '台中 西屯區', city: '台中市', district: '西屯區' },
    dropoffLocation: { address: '南投縣仁愛鄉大同村仁和路 170 號', lat: 24.0000, lng: 121.1500, displayName: '清境農場', city: '南投縣', district: '仁愛鄉' },
    stopovers: [], vehicleType: 'van-9', passengerCount: 7, adultCount: 7, childCount: 0,
    luggageItems: [], estimatedFare: 12800, estimatedTime: 128, distanceKm: 96.4, extraServices: [],
    flightNumber: null, terminal: null, notes: null, orderStatus: 'confirmed', assignedDriverId: 'd-seed-1',
    cancelReason: null, createdAt: 1787000200000, passengerName: '林小姐', passengerPhone: '0933444555',
    preferences: null, dispatchAt: '2026-08-26T10:00:00+08:00', assignedAt: '2026-08-26T11:00:00+08:00',
    bids: [],
  },
];

const TARGETS: readonly VisualTarget[] = [
  // ── 乘客端 ────────────────────────────────────────────────
  // 2026-08-29：`passenger-landing` 移除。
  //
  // 它拍的是 `/`，但 fixture 一律是**已登入**身分，而已登入者進 `/` 會被
  // resolveAuthTarget 導去 `/home` —— 也就是說這張跟 passenger-home 是同一個畫面。
  // 之前它看起來有內容，是因為 Playwright 預設 locale 是 en-US，`/` 被 i18n 導到 `/en`，
  // 而當時 `/en` **不算入口**（auth-target 沒剝語系前綴），所以停在英文行銷頁上。
  // 那是 bug 造成的覆蓋率，不是設計。前綴修好之後它就變成 /home 的重複。
  //
  // ⚠ 已知缺口：**未登入訪客看到的行銷 landing 目前沒有視覺基線**，而那是 SEO 主頁。
  //   要補得先讓 fixture 有一個真正的 anonymous 身分（現在 plugin 在 mock 模式下
  //   一定會 MockSignIn，做不出「已解析但未登入」的狀態）。
  { name: 'passenger-booking', path: '/booking', identity: 'passenger' },
  { name: 'passenger-orders', path: '/orders', identity: 'passenger' },
  // 有單的訂單頁 —— 空狀態拍不到狀態流程條與 chips 的計數
  {
    name: 'passenger-orders-full',
    path: '/orders',
    identity: 'passenger',
    seed: { '/nuxt-api/orders': ORDERS_SEED },
  },
  // 消息頁本來沒有基線 —— 口袋航廈第四版動到它（未讀點改古銅、日期靠右等寬），補上
  {
    name: 'passenger-notifications',
    path: '/notifications',
    identity: 'passenger',
    seed: { '/nuxt-api/passenger/announcements': ANNOUNCEMENTS_SEED },
  },
  { name: 'passenger-fare', path: '/fare', identity: 'passenger' },
  // 註：沒有 /vehicles 列表頁（只有 /vehicles/[driverId]）；/home 是登入後的乘客首頁
  { name: 'passenger-home', path: '/home', identity: 'passenger' },
  {
    name: 'passenger-home-full',
    path: '/home',
    identity: 'passenger',
    seed: {
      '/nuxt-api/orders/upcoming': UPCOMING_SEED,
      '/nuxt-api/passenger/announcements': ANNOUNCEMENTS_SEED,
    },
  },
  // ── 司機端 ────────────────────────────────────────────────
  { name: 'driver-dashboard', path: '/driver/dashboard', identity: 'driverApproved' },
  { name: 'driver-trip', path: '/driver/trip', identity: 'driverApproved' },
  {
    name: 'driver-trip-list',
    path: '/driver/trip',
    identity: 'driverApproved',
    seed: { '/nuxt-api/orders/assigned': ASSIGNED_SEED },
  },
  {
    name: 'driver-dispatched',
    path: '/driver/dispatched',
    identity: 'driverApproved',
    seed: { '/nuxt-api/driver/dispatched-orders': DISPATCHED_SEED },
  },
  {
    // ⚠ 兩個 key 的順序有意義：list pattern 也會命中 detail URL，
    //    detail 要**後**註冊才蓋得過它（Playwright 後註冊優先）。
    name: 'driver-dispatched-detail',
    path: '/driver/dispatched/seedaaa1b2c3d4',
    identity: 'driverApproved',
    seed: {
      '/nuxt-api/driver/dispatched-orders': DISPATCHED_SEED,
      '/nuxt-api/driver/dispatched-orders/seedaaa1b2c3d4': DISPATCHED_DETAIL_SEED,
    },
  },
  {
    name: 'driver-dispatched-mine',
    path: '/driver/dispatched',
    identity: 'driverApproved',
    seed: { '/nuxt-api/driver/dispatched-orders': DISPATCHED_SEED },
    // ⚠ 切分頁後**不要用固定秒數等**。第一版寫 waitForTimeout(300)，
    //    mobile-chrome 上約每兩輪紅一次（356 px，比例 0.01）——
    //    等的是時間不是狀態。改等「只有這個分頁才有的元素」真的出現。
    beforeShot: async (page) => {
      await page.getByRole('button', { name: /已喊單/ }).click();
      await page.getByRole('button', { name: '撤回喊單' }).waitFor({ state: 'visible' });
    },
  },
  // ── 管理端 ────────────────────────────────────────────────
  { name: 'admin-orders', path: '/admin/orders', identity: 'adminWith2fa' },
  {
    name: 'admin-orders-list',
    path: '/admin/orders',
    identity: 'adminWith2fa',
    seed: { '/nuxt-api/admin/orders': ADMIN_ORDERS_SEED },
  },
  { name: 'admin-dashboard', path: '/admin/dashboard', identity: 'adminWith2fa' },
  // /admin/settings 呼叫 20+ 支 API，逐一精準 mock 不划算（fixture 萬用 {data:{}} 會炸）；
  // 改用同樣具代表性的 admin 頁面 —— 側欄、表格、卡片一樣涵蓋到。
  { name: 'admin-drivers', path: '/admin/drivers', identity: 'adminWith2fa' },
  { name: 'admin-audit-logs', path: '/admin/audit-logs', identity: 'adminWith2fa' },
];

/**
 * 壓掉會讓截圖 flaky 的來源。
 * 動畫由 toHaveScreenshot 的 animations:'disabled' 處理，這裡處理它蓋不到的：
 * 無限迴圈動畫的中間態、捲動位置、以及仰賴 IntersectionObserver 的入場效果。
 */
async function settle(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      /* scroll-reveal 元素若還沒進 viewport 會是 opacity:0 → 強制顯示，避免半透明抖動 */
      [class*="reveal"], [class*="fade"] { opacity: 1 !important; transform: none !important; }
    `,
  });
  // 等載入指示器消失。waitForContent 只看「可見文字夠不夠」，光頁首就滿足了 ——
  // 於是資料還在飛的頁面會拍到 spinner 區塊，而 spinner 與它之後的空狀態／列表
  // 高度不同（實測 /orders 在 1307 ↔ 1445 之間跳，138px）。等的是狀態不是字數。
  // 逾時不拋：有些頁面本來就沒有指示器，也不該讓它擋住截圖。
  await page
    .locator('[class*="__loading"], [class*="__spinner"]')
    .first()
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => { /* 沒有指示器、或它是常駐的 → 照拍 */ });

  // 讓字體載入完成，否則會拍到 fallback 字體
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * 可忽略的 console 噪音。
 * - hydration mismatch：SSR/CSR 差異的 Vue 警告，全站幾乎每頁都有，與色票無關；
 *   它是既有技術債，不該讓視覺基線為它停擺（另開議題處理）。
 * - favicon / vite dev 相關：與應用無關。
 * - SSL connect error：WebKit 對被 route.abort() 擋下的第三方請求所報的錯。同源的
 *   http://localhost:3000 不可能產生 SSL 錯誤，所以只會遮住刻意擋掉的外部請求，
 *   不會掩蓋本地資源（例如字檔 404）的問題。
 *
 * - `[history] load failed`（/orders）：**mock 模式的既有缺陷，與視覺無關**。
 *   `GetOrderList()` 在 `IsMock()` 為真時走 `mock-res.ts` 的 `CreateRes()`，
 *   而它回的 `status.code` 是 **0** 不是 200；頁面拿到 code≠success 就 console.error。
 *   實測：請求根本沒出門（Playwright 收不到任何 /nuxt-api/orders 的 response），
 *   所以不是網路或 fixture 問題。頁面本身渲染完整，截圖是好的。
 *   根治屬「mock 回傳包絡 code 0」那條線（參照 api-envelope-zero-code），另開議題。
 *
 * 真正的 TypeError 等仍會讓測試失敗 —— 那代表頁面沒渲染完整，基線會是壞的。
 */
// `ResizeObserver loop …` 是瀏覽器層的良性警告（觀察器在一幀內又觸發了一次），
// 規範明文說可以忽略，各家框架也都當噪音。WebKit 上會間歇性地以 pageerror 形式冒出來，
// 不濾掉的話 /orders 的基線大約每三次跑會紅一次。
const IGNORED_CONSOLE = /Hydration completed but contains mismatches|favicon|Outdated Optimize Dep|504|SSL connect error|\[history\] load failed|ResizeObserver loop/;

/** 可見文字。務必用 innerText 而非 textContent —— 後者會把 <script> 裡的
 *  `window.__NUXT__={...}` 一起算進去，長度動輒數千字，任何「內容夠不夠」的判斷都會失效。 */
const visibleText = (page: Page): Promise<string> =>
  page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

/** 等頁面真的長出內容（boot gate 解除、lazy load 完成），而不是只等固定秒數。 */
async function waitForContent(page: Page, minChars = 60, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const t = (await visibleText(page)).replace(/\s+/g, '');
    if (t.length >= minChars) return;
    await page.waitForTimeout(500);
  }
}

/**
 * 拍照前的健全性檢查。
 *
 * 為什麼需要：第一次跑基線時 10 張全部「通過」，但 admin 三張拍到的是 500 錯誤頁、
 * driver 兩張拍到的是 boot splash。toHaveScreenshot 只保證「拍到了」，不保證「拍對了」——
 * 基線若含垃圾，之後的 diff 全部失去意義，而且不會有任何紅燈。
 */
async function assertRenderedForReal(page: Page, target: VisualTarget): Promise<void> {
  const text = (await visibleText(page)).replace(/\s+/g, '');

  const errorPage = /\b(404|500)\b/.test(text)
    && /(ServerError|Pagenotfound|回到首頁)/.test(text);
  expect(errorPage, `${target.path} 落在 Nuxt 錯誤頁`).toBe(false);

  // 仍停在 boot splash（CommonBootSplash 只有品牌字 + spinner，可見文字極短）
  expect(
    text.length,
    `${target.path} 仍停在 boot splash／空白（可見文字僅 ${text.length} 字：「${text.slice(0, 60)}」）`,
  ).toBeGreaterThanOrEqual(60);
}

for (const target of TARGETS) {
  test(`visual: ${target.name}`, async ({ page, loginAs }) => {
    const appErrors: string[] = [];
    page.on('pageerror', (e) => { if (!IGNORED_CONSOLE.test(e.message)) appErrors.push(`[pageerror] ${e.message}`); });
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) appErrors.push(m.text());
    });

    // 這個 handler 做兩件事：
    //
    // ① 擋掉所有第三方請求（GTM / Clarity / Google Maps…）。視覺基線不該讓分析腳本參與，
    //    否則截圖受外部服務狀態影響。字體是 @nuxt/fonts 自架於同源 /_fonts/，不受影響。
    //
    // ② 同源回應剝掉 CSP 與 HSTS —— 見檔頭說明。沒有這一步，WebKit 會把同源子資源
    //    升級成 https 而全數 SSL 失敗，iPhone 14 的基線就會拍到完全沒有 CSS 的頁面。
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (req.url().startsWith('http') && !/^https?:\/\/localhost:3000/.test(req.url())) return route.abort();
      // 只需要改寫**文件**的 header —— upgrade-insecure-requests 是由文件的 CSP 發動的，
      // 子資源本身的 header 不影響升級與否。只攔 document 也避開了「測試收尾時
      // 還有子資源在飛，route.fetch() 會對已關閉的 page 拋錯」那個坑。
      if (req.resourceType() !== 'document') return route.continue();
      try {
        const res = await route.fetch();
        const headers = { ...res.headers() };
        delete headers['content-security-policy'];
        delete headers['strict-transport-security'];
        return await route.fulfill({ response: res, headers });
      } catch {
        return route.continue().catch(() => { /* page 已關閉，忽略 */ });
      }
    });

    // 把「現在」凍住。/booking 的 ElTimeSelect 與 /fare 的 ElDatePicker 會帶入當下時間，
    // 每 10 分鐘就讓基線差一次（實測就是那 36×13 px 的 `02:40`）。
    // 用凍結時鐘而不是遮罩 —— 遮罩會連那兩個元件的樣式一起蓋掉，等於放棄它們的視覺覆蓋。
    // setFixedTime 只固定 Date.now()／new Date()，不暫停 timer，不影響輪詢與動畫。
    await page.clock.setFixedTime(new Date('2026-08-27T09:30:00+08:00'));

    await loginAs(target.identity);

    // 在 fixtures 的萬用 mock **之後**註冊，才蓋得過它（Playwright 後註冊優先）。
    if (target.seed) {
      for (const [key, data] of Object.entries(target.seed)) {
        await page.route(`**${key}**`, (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } }),
        }));
      }
    }

    await page.goto(target.path, { waitUntil: 'load', timeout: 25000 });
    await waitForContent(page);
    if (target.beforeShot) await target.beforeShot(page);
    await settle(page);

    await assertRenderedForReal(page, target);
    expect(appErrors, `${target.path} 有 app 層錯誤：\n${appErrors.join('\n')}`).toHaveLength(0);

    await expect(page).toHaveScreenshot(`${target.name}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      // 色票換裝預期整片變動；比對階段本就要人工看 diff，不設寬容值。
      // 不設寬容值。放寬容值會連帶讓「某個小徽章色跑掉」這種真實 regression 一起被吞掉。
      // 唯一的不穩定源是「現在時間」，已由上方的 clock.setFixedTime 處理 ——
      // 用凍結時鐘而不是遮罩，那些欄位的樣式才留在覆蓋範圍內。
      maxDiffPixelRatio: 0,
    });
  });
}
