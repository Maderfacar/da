import { describe, expect, it } from 'vitest';
import { extractRegion, formatLocationLabel, formatPlaceName, formatRegion } from './location-label';

describe('extractRegion', () => {
  it('優先採用 city / district 欄位', () => {
    // Arrange
    const loc = { city: '桃園市', district: '大園區', address: '33758台灣桃園市大園區航站南路9號' };

    // Act
    const region = extractRegion(loc);

    // Assert
    expect(region).toEqual({ city: '桃園市', district: '大園區' });
  });

  it('舊訂單無 city / district 欄位時從 address 解析', () => {
    const region = extractRegion({ address: '33758台灣桃園市大園區航站南路9號' });

    expect(region).toEqual({ city: '桃園市', district: '大園區' });
  });

  it('address 用「臺」字時照樣命中並保留原寫法', () => {
    const region = extractRegion({ address: '100臺灣臺北市中正區北平西路3號' });

    expect(region).toEqual({ city: '臺北市', district: '中正區' });
  });

  it('行政區為縣轄市時（如竹北市）也能解析', () => {
    const region = extractRegion({ address: '302台灣新竹縣竹北市光明六路10號' });

    expect(region).toEqual({ city: '新竹縣', district: '竹北市' });
  });

  it('行政區為鄉時也能解析', () => {
    const region = extractRegion({ address: '262台灣宜蘭縣礁溪鄉溫泉路1號' });

    expect(region).toEqual({ city: '宜蘭縣', district: '礁溪鄉' });
  });

  it('無法辨識的地址回空字串而非丟錯', () => {
    const region = extractRegion({ address: 'Narita International Airport, Japan' });

    expect(region).toEqual({ city: '', district: '' });
  });

  it('傳入 null / undefined 回空字串', () => {
    expect(extractRegion(null)).toEqual({ city: '', district: '' });
    expect(extractRegion(undefined)).toEqual({ city: '', district: '' });
  });
});

describe('formatRegion', () => {
  it('縣市與行政區連寫', () => {
    expect(formatRegion({ city: '台北市', district: '大安區' })).toBe('台北市大安區');
  });

  it('只有縣市時只回縣市', () => {
    expect(formatRegion({ city: '台北市' })).toBe('台北市');
  });

  it('兩者皆無回空字串', () => {
    expect(formatRegion({ address: 'somewhere' })).toBe('');
  });
});

describe('formatPlaceName', () => {
  it('displayName 為「名稱 (地址)」時只取名稱', () => {
    const name = formatPlaceName({
      displayName: '桃園國際機場 (33758台灣桃園市大園區航站南路9號)',
      address: '33758台灣桃園市大園區航站南路9號',
    });

    expect(name).toBe('桃園國際機場');
  });

  it('displayName 為純名稱時原樣回傳', () => {
    expect(formatPlaceName({ displayName: '桃園國際機場', address: 'x' })).toBe('桃園國際機場');
  });

  it('無 displayName 時退回 address 並清掉郵遞區號與國名', () => {
    expect(formatPlaceName({ address: '33758台灣桃園市大園區航站南路9號' })).toBe('桃園市大園區航站南路9號');
  });

  it('英文地址取第一個逗號前的段落', () => {
    expect(formatPlaceName({ address: 'No. 9, Hangzhan S Rd, Dayuan District' })).toBe('No. 9');
  });

  it('空地點回空字串', () => {
    expect(formatPlaceName(null)).toBe('');
    expect(formatPlaceName({})).toBe('');
  });
});

describe('formatLocationLabel', () => {
  it('組出「縣市行政區 地點名稱」', () => {
    const label = formatLocationLabel({
      displayName: '桃園國際機場',
      address: '33758台灣桃園市大園區航站南路9號',
      city: '桃園市',
      district: '大園區',
    });

    expect(label).toBe('桃園市大園區 桃園國際機場');
  });

  it('名稱本身已含縣市行政區時不重複前綴', () => {
    const label = formatLocationLabel({ address: '33758台灣桃園市大園區航站南路9號' });

    expect(label).toBe('桃園市大園區航站南路9號');
  });

  it('無縣市資訊時只回名稱', () => {
    expect(formatLocationLabel({ displayName: 'Narita Airport', address: 'Japan' })).toBe('Narita Airport');
  });

  it('無名稱時只回縣市', () => {
    expect(formatLocationLabel({ city: '台北市', district: '大安區' })).toBe('台北市大安區');
  });
});
