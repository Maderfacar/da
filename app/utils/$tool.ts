import cloneDeep from 'lodash-es/cloneDeep';
// 判斷 -----------------------------------------------------------------------------------------------
/** Object has key */
const HasKey = (object: unknown, key: PropertyKey): boolean => object != null && Object.hasOwnProperty.call(object, key);

/** 是 array */
const IsArray = Array.isArray;

/** 是單純物件（排除 Array、Date、Map、Set、Blob 等特殊物件） */
const _IsPlainObject = (value: unknown): value is Record<string, any> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
};

/** 是 object */
const IsObject = (value: unknown): value is Record<string, any> => _IsPlainObject(value);

// 生成轉換 ----------------------------------------------------------------------------------------------------
/** UUID 生成 */
const CreateUUID = (): string => {
  // 安全環境（HTTPS/localhost）下使用原生 API
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 非安全環境或 SSR 環境下的 fallback
  let d = Date.now();
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    d += performance.now(); // use high-precision timer if available
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (d + Math.random() * 16) % 16 | 0;
    d = Math.floor(d / 16);
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

/** 1000 => 1,000 */
const NumToMoney = (num: number | string, isInt = true): string => {
  const text = String(num ?? '');
  const [integerPart = ''] = text.split('.');
  const normalized = isInt ? integerPart : text;
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/** 1,000 => 1000 */
const MoneyToNum = (value: string): number => {
  return Number(value?.replace(/[\s$,]/g, '') || 0);
};

/* array Object 節點深度空字元過濾器 */
const ArrayObjectFilter = <T>(data: T, removeValue: unknown[] = [null, undefined, '']): T => {
  const shouldRemove = (value: unknown) => removeValue.some((removeItem) => removeItem === value);

  if (IsArray(data)) {
    const filtered = data
      .filter((item) => !shouldRemove(item))
      .map((item) => ArrayObjectFilter(item, removeValue));
    return filtered as T;
  }

  if (IsObject(data)) {
    const result: Record<string, unknown> = {};
    Object.entries(data).forEach(([key, value]) => {
      if (shouldRemove(value)) return;
      result[key] = IsArray(value) || IsObject(value) ? ArrayObjectFilter(value, removeValue) : value;
    });
    return result as T;
  }

  return data;
};

/* Array 加總 */
const ArraySum = (arr: Array<number | string>): number => {
  return arr.reduce<number>((sum, current) => sum + Number(current ?? 0), 0);
};

/** 補零 */
const Zero = (val: string | number, len = 5, direction: 'left' | 'right' = 'left'): string => {
  const str = String(val ?? '');
  return direction === 'left' ? str.padStart(len, '0') : str.padEnd(len, '0');
};

// -----------------------------------------------------------------------------------------------
type _Mergeable = Record<string, any> | any[];

/** Array 合併 */
const _MergeArray = (fromArr: any[], toArr: any[]) => {
  toArr.forEach((targetValue, index, targetArray) => {
    const sourceValue = fromArr[index];
    if (sourceValue === undefined) return;

    if ((IsArray(targetValue) && IsArray(sourceValue)) || (IsObject(targetValue) && IsObject(sourceValue))) {
      PickObjectA2B(sourceValue as _Mergeable, targetValue as _Mergeable);
      return;
    }

    targetArray[index] = sourceValue;
  });
};

/** Object 合併 */
const _MergeObject = (fromObj: Record<string, any>, toObj: Record<string, any>) => {
  Object.keys(toObj).forEach((key) => {
    const sourceValue = fromObj[key];
    if (sourceValue === undefined) return;

    const targetValue = toObj[key];
    if ((IsArray(targetValue) && IsArray(sourceValue)) || (IsObject(targetValue) && IsObject(sourceValue))) {
      PickObjectA2B(sourceValue as _Mergeable, targetValue as _Mergeable);
      return;
    }

    toObj[key] = sourceValue;
  });
};

/** 選取物件資料 (A 複製到 B，以 B 為主) */
const PickObjectA2B = (fromObj: _Mergeable, toObj: _Mergeable): _Mergeable => {
  if (IsArray(toObj) && IsArray(fromObj)) {
    _MergeArray(fromObj, toObj);
  } else if (IsObject(toObj) && IsObject(fromObj)) {
    _MergeObject(fromObj as Record<string, any>, toObj as Record<string, any>);
  }
  return toObj;
};
// -----------------------------------------------------------------------------------------------
/** 將任何可序列化資料遞迴塞入 FormData */
const _AppendFormValue = (formData: FormData, key: string, value: any) => {
  if (value === undefined || value === null) return;

  if (value instanceof Blob || value instanceof File) {
    formData.append(key, value);
    return;
  }

  if (value instanceof Date) {
    formData.append(key, value.toISOString());
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      _AppendFormValue(formData, `${key}[${index}]`, item);
    });
    return;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([childKey, childValue]) => {
      _AppendFormValue(formData, `${key}[${childKey}]`, childValue);
    });
    return;
  }

  formData.append(key, String(value));
};

/** 將 JSON 轉為 FormData */
const JsonToFormData = (json: Record<string, any>, formData: FormData = new FormData(), parentKey?: string): FormData => {
  Object.entries(json).forEach(([key, value]) => {
    const fullKey = parentKey ? `${parentKey}[${key}]` : key;
    _AppendFormValue(formData, fullKey, value);
  });
  return formData;
};

// formdata to json -------------------------------------------------------------------------------------------------
/** 解析 FormData 欄位鍵為路徑陣列 */
const _SplitFormKey = (key: string): (string | number)[] => {
  return key
    .replace(/\]/g, '')
    .split('[')
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
};

/** 將 array 轉為物件以保留既有索引資料 */
const _ArrayToObject = (arr: any[]): Record<string, any> => {
  const obj: Record<string, any> = {};
  arr.forEach((value, index) => {
    if (value !== undefined) obj[String(index)] = value;
  });
  return obj;
};

/** 取得或建立下一層容器，處理 array / object 型別衝突 */
const _EnsureNestedContainer = (container: any, key: string | number, nextKey?: string | number) => {
  const wantArray = typeof nextKey === 'number';

  if (Array.isArray(container)) {
    const index = Number(key);
    if (!Number.isFinite(index)) return undefined;
    if (container[index] === undefined) {
      container[index] = wantArray ? [] : {};
    }
    return container[index];
  }

  const existing = container[key];
  if (existing === undefined) {
    container[key] = wantArray ? [] : {};
    return container[key];
  }

  // 型別衝突：既有為 array 但此次需要 object，轉成 object 保留資料
  if (!wantArray && Array.isArray(existing)) {
    container[key] = _ArrayToObject(existing);
    return container[key];
  }

  return existing;
};

/** 依路徑設定值 */
const _AssignFormValue = (target: any, keys: (string | number)[], value: FormDataEntryValue) => {
  const [currentKey, ...restKeys] = keys;

  if (currentKey === undefined) return;

  if (restKeys.length === 0) {
    if (Array.isArray(target) && typeof currentKey === 'number') {
      target[currentKey] = value;
      return;
    }
    target[currentKey as keyof typeof target] = value;
    return;
  }

  const nextKey = restKeys[0];
  const nextTarget = _EnsureNestedContainer(target, currentKey, nextKey);
  if (nextTarget === undefined) return;

  _AssignFormValue(nextTarget, restKeys, value);
};

/** formdata 轉 json */
const FormDataToJson = (formData: FormData): Record<string, any> => {
  const result: Record<string, any> = {};

  formData.forEach((value, key) => {
    const path = _SplitFormKey(key);
    _AssignFormValue(result, path.length > 0 ? path : [key], value);
  });

  return result;
};

// 行為 --------------------------------------------------------------------------------------------------
const _IsClient = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** async await 等待 */
const Sleep = (ms = 1000) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 滾動到頂部 */
const ScrollTop = (selector: string, isSmooth = true) => {
  if (!_IsClient()) return;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return;
  element.scrollTo({
    top: 0,
    left: 0,
    behavior: isSmooth ? 'smooth' : 'auto'
  });
};

/** 滾動到 element */
const ScrollToEl = (
  targetEl: HTMLElement | null,
  isSmooth = true,
  scrollEl: Window | HTMLElement = window
) => {
  if (!_IsClient() || !targetEl) return;
  const behavior: ScrollBehavior = isSmooth ? 'smooth' : 'auto';
  const targetRect = targetEl.getBoundingClientRect();

  if (scrollEl instanceof Window) {
    const top = targetRect.top + scrollEl.scrollY;
    scrollEl.scrollTo({ top, left: 0, behavior });
    return;
  }

  const containerRect = scrollEl.getBoundingClientRect();
  const top = targetRect.top - containerRect.top + scrollEl.scrollTop;
  scrollEl.scrollTo({ top, left: 0, behavior });
};

/** 滾動到指定 id or class */
const ScrollToTag = (selector: string, isSmooth = true) => {
  if (!_IsClient()) return;
  const targetEl = document.querySelector<HTMLElement>(selector);
  ScrollToEl(targetEl, isSmooth);
};

/* 複製文字 */
const CopyText = async (text = ''): Promise<boolean> => {
  if (!text || !_IsClient()) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    // 若 clipboard API 失敗，改用傳統方式
  }

  if (!document.execCommand) return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';

  try {
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    return success;
  } catch (error) {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
};

/** 分享網址 */
const ShareUrl = async (url: string, title: string, text: string) => {
  if (!_IsClient()) return;
  if (!navigator.share || !url) return;
  await navigator.share({ title, text, url });
};

/* 隱藏滾動 */
const HiddenScrollbar = (canHide: boolean) => {
  if (!_IsClient()) return;
  const html = document.documentElement;
  const body = document.body;
  if (canHide) {
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
  } else {
    html.style.removeProperty('overflow');
    body.style.removeProperty('overflow');
  }
};

/* 首字母大寫 */
const FirstUpper = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1);

/* 調整陣列長度 */
const AdjustArrayLength = <T>(arr: T[], newLength: number, structure: T): T[] => {
  if (newLength < 0) return arr;

  while (arr.length < newLength) {
    arr.push(cloneDeep(structure));
  }

  if (arr.length > newLength) {
    arr.length = newLength;
  }

  return arr;
};

/* 創建測試圖片 */
const CreateDemoImg = (width = 600, height = 400, bgColor = '666', textColor = '000'): string => {
  return `https://dummyimage.com/${width}x${height}/${bgColor}/${textColor}`;
};

/* 創建隨機圖片 */
const CreateRandomImg = (width = 600, height = 400): string => {
  return `https://picsum.photos/${width}/${height}`;
};

/** 下載圖片 */
const DownloadLinkFile = async (url: string, filename: string): Promise<boolean> => {
  if (!_IsClient() || !url || !filename) return false;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(blobUrl);
    return true;
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
};

export default {
  /** 判斷 */
  HasKey,
  /** 判斷 Array */
  IsArray,
  /** 判斷 Object */
  IsObject,
  /** UUID 生成 */
  CreateUUID,
  /** 1000 => 1,000 */
  NumToMoney,
  /** 1,000 => 1000 */
  MoneyToNum,
  /** array Object 深度空元素過濾器 */
  ArrayObjectFilter,
  /** Array 加總 */
  ArraySum,
  /** 選取物件資料 A 轉 B */
  PickObjectA2B,
  /** 轉換為 FormData 格式 */
  JsonToFormData,
  /** FormData to json */
  FormDataToJson,
  /** 補零 */
  Zero,
  /** async await 等待 */
  Sleep,
  /** 滾動到頂部 */
  ScrollTop,
  /** 滾動到 element */
  ScrollToEl,
  /** 滾動到指定 id or class */
  ScrollToTag,
  /** 複製文字 */
  CopyText,
  /** 分享網址 */
  ShareUrl,
  /** 隱藏滾動 */
  HiddenScrollbar,
  /** 首字母大寫 */
  FirstUpper,
  /** 調整陣列長度 */
  AdjustArrayLength,
  /** 創建測試圖片 */
  CreateDemoImg,
  /** 創建隨機圖片 */
  CreateRandomImg,
  /** 下載連結檔案 */
  DownloadLinkFile
};
