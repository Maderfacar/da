// 加密庫
import CryptoJS from 'crypto-js';

// -----------------------------------------------------------------------------------------------
/** 編碼：UTF-8 → Base64 */
export const Encode64 = (str: string): string => {
  try {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_match, p1) =>
      String.fromCharCode(Number('0x' + p1))
    ));
  } catch (error) {
    console.error('Encode64 failed:', error);
    return '';
  }
};

/** 解碼：Base64 → UTF-8 */
export const Decode64 = (str: string): string => {
  try {
    const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized);
    const utf8 = decoded.split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('');
    return decodeURIComponent(utf8);
  } catch (error) {
    console.error('Decode64 failed:', error);
    return '';
  }
};

// -----------------------------------------------------------------------------------------------
// 有加密功能的 useCookie，檔案太大會壞掉

const SECRET_KEY = 'my-secret-key';

// 加密 / 解密函式
const EncodeAES = (val: string) => CryptoJS.AES.encrypt(val, SECRET_KEY).toString();
const DecodeAES = (val: string) => CryptoJS.AES.decrypt(val, SECRET_KEY).toString(CryptoJS.enc.Utf8);

// -----------------------------------------------------------------------------------------------
export default {
  /** 加密 Base64 */
  Encode64,
  /** 解密 Base64 */
  Decode64,

  /** 加密 AES */
  EncodeAES,
  /** 解密 AES */
  DecodeAES,
};
