// 有加密功能的 useCookie，檔案太大會壞掉
export const UseEncryptCookie = <T>(key: string, defaultValue: T) => {
  return useCookie<T>(key, {
    default: () => defaultValue,
    /** 加密 */
    encode: (val) => $encrypt.EncodeAES(JSON.stringify(val)),
    /** 解密 */
    decode: (val) => {
      try {
        return JSON.parse($encrypt.DecodeAES(val || ''));
      } catch {
        return defaultValue;
      }
    }
  });
};
