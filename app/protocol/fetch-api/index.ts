import * as file from './api/file';
import * as auth from './api/auth';
import * as tinymce from './api/tinymce';
import * as maps from './api/maps';
import * as order from './api/order';
import * as driver from './api/driver';
import * as airport from './api/airport';
import * as admin from './api/admin';

export default {
  ...file,
  ...auth,
  ...tinymce,
  ...maps,
  ...order,
  ...driver,
  ...airport,
  ...admin,
};


// // 使用 Vite 的 import.meta.glob 自動聚合 api 模組
// // 會自動載入 ./api/**/index.ts 中的所有 named export，並合併成單一物件輸出
// const modules = import.meta.glob('./api/**/index.ts', { eager: true }) as Record<string, any>;
// const apiExports: Record<string, any> = {};

// for (const key in modules) {
//   const mod = modules[key] as Record<string, any>;
//   Object.assign(apiExports, mod);
// }

// export default apiExports;
