// 有加密功能的 local storage，會出現水合警告，可存大容量
export const UseEncryptStorage = <T>(key: string, defaultValue: T) => {
  const _data = ref<T>(defaultValue);

  const data = computed<T>({
    get: () => _data.value,
    set: (val: T) => Save(val)
  });

  /** 載入 */
  const Load = () => {
    if (import.meta.client) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          /** 解密 */
          _data.value = JSON.parse($encrypt.DecodeAES(raw));
        } catch {
          _data.value = defaultValue;
        }
      }
    }
  };

  /** 保存 */
  const Save = (val: T) => {
    _data.value = val;
    if (import.meta.client) {
      /** 加密 */
      localStorage.setItem(key, $encrypt.EncodeAES(JSON.stringify(val)));
    }
  };

  /** Init ，寫在 Mounted前 會爆出水合警告*/
  if (import.meta.client) Load();

  /** 使用 onMounted 初始，middleware 會讀不到值 */
  // onMounted(() => {
  //   Load();
  // });
  return data;
};
