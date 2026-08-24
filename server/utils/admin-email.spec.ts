import { describe, it, expect } from 'vitest';
import { parseEmailList, mergeRecipients, groupByLang, isValidEmail } from './admin-email';

describe('parseEmailList', () => {
  it('逗號分隔多個地址', () => {
    expect(parseEmailList('a@x.com,b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('容忍空白、分號與換行（人手貼上的環境變數很少乾淨）', () => {
    expect(parseEmailList(' a@x.com ; b@y.com \n c@z.com ')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('過濾明顯不是 email 的字串，不讓一個錯字連累整批', () => {
    expect(parseEmailList('a@x.com, 這不是信箱, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('去重且不分大小寫', () => {
    expect(parseEmailList('A@X.com, a@x.com')).toEqual(['a@x.com']);
  });

  it('空字串 / undefined 回空陣列', () => {
    expect(parseEmailList('')).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe('isValidEmail', () => {
  it('基本判定', () => {
    expect(isValidEmail('youcool15@gmail.com')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });
});

describe('mergeRecipients', () => {
  it('admins doc 的 email 與環境變數清單合併去重', () => {
    const merged = mergeRecipients(
      [{ email: 'boss@x.com', lang: 'zh_tw' }, { email: 'ops@x.com', lang: 'en' }],
      ['boss@x.com', 'extra@y.com'],
    );
    expect(merged.map((r) => r.email).sort()).toEqual(['boss@x.com', 'extra@y.com', 'ops@x.com']);
  });

  it('環境變數帶進來的地址沒有語系資訊 → 用預設 zh_tw', () => {
    const merged = mergeRecipients([], ['extra@y.com']);
    expect(merged).toEqual([{ email: 'extra@y.com', lang: 'zh_tw' }]);
  });

  it('同一地址同時出現在兩邊時，保留 admins doc 的語系（比環境變數精確）', () => {
    const merged = mergeRecipients([{ email: 'ops@x.com', lang: 'ja' }], ['ops@x.com']);
    expect(merged).toEqual([{ email: 'ops@x.com', lang: 'ja' }]);
  });

  it('admins doc 沒填 email 的略過，不產生空字串收件人', () => {
    const merged = mergeRecipients([{ email: '', lang: 'zh_tw' }, { email: 'a@x.com', lang: 'zh_tw' }], []);
    expect(merged).toEqual([{ email: 'a@x.com', lang: 'zh_tw' }]);
  });
});

describe('groupByLang', () => {
  it('依語系分組 —— 一種語系寄一封，內容才會是對的語言', () => {
    const groups = groupByLang([
      { email: 'a@x.com', lang: 'zh_tw' },
      { email: 'b@x.com', lang: 'en' },
      { email: 'c@x.com', lang: 'zh_tw' },
    ]);
    expect(groups).toEqual([
      { lang: 'zh_tw', emails: ['a@x.com', 'c@x.com'] },
      { lang: 'en', emails: ['b@x.com'] },
    ]);
  });

  it('空清單回空陣列（caller 據此判斷不寄）', () => {
    expect(groupByLang([])).toEqual([]);
  });
});
