// 開發模式 Service Worker 佔位檔案
// 用於防止 Vite 在開發模式下找不到 dev-sw.js 的警告
console.log('[dev-sw] Development Service Worker loaded');

// 攔截所有 fetch 事件並直接轉發,避免 workbox 路由警告
self.addEventListener('fetch', (event) => {
  // 直接轉發所有請求,不做任何攔截處理
  event.respondWith(fetch(event.request));
});
