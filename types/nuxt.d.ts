// 全域注入的型別宣告（使用相對路徑避免別名在類型檔解析問題）
import type api from '../app/utils/$api';
import type dayjs from '../app/utils/$dayjs';
import type encrypt from '../app/utils/$encrypt';
import type enums from '../app/utils/$enum';
import type lodash from '../app/utils/$lodash';
import type open from '../app/utils/$open';
import type tool from '../app/utils/$tool';

declare module '#app' {
  interface NuxtApp {
    $api: typeof api;
    $dayjs: typeof dayjs;
    $encrypt: typeof encrypt;
    $enum: typeof enums;
    $lodash: typeof lodash;
    $open: typeof open;
    $tool: typeof tool;
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $api: typeof api;
    $dayjs: typeof dayjs;
    $encrypt: typeof encrypt;
    $enum: typeof enums;
    $lodash: typeof lodash;
    $open: typeof open;
    $tool: typeof tool;
  }
}

export {};
