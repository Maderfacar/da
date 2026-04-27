import * as mockRes from '@/protocol/fetch-api/mock-res';

export const CreateOrder = () => {
  const data: CreateOrderRes = {
    orderId: 'mock-order-' + Date.now(),
    estimatedFare: 850,
    estimatedTime: 45,
    distanceKm: 22,
    orderStatus: 'pending',
  };
  return mockRes.CreateRes(data, 800);
};

export const GetOrderList = () => mockRes.CreateRes<OrderItem[]>([], 300);

export const GetAutocomplete = (input: string) => {
  const data: PlacePrediction[] = [
    { placeId: 'mock-tpe', description: '台灣桃園國際機場, 大園區, 桃園市, 台灣', mainText: '台灣桃園國際機場', secondaryText: '大園區, 桃園市' },
    { placeId: 'mock-tsa', description: '台北松山機場, 松山區, 台北市, 台灣', mainText: '台北松山機場', secondaryText: '松山區, 台北市' },
    { placeId: 'mock-addr', description: `${input} 路, 台北市, 台灣`, mainText: `${input} 路`, secondaryText: '台北市' },
  ];
  return mockRes.CreateRes(data, 300);
};

export const GetGeocode = () => {
  const data: GeocodeRes = { lat: 25.0797, lng: 121.2322, address: '台灣桃園國際機場', placeId: 'mock-tpe' };
  return mockRes.CreateRes(data, 200);
};

export const GetDistance = () => {
  const data: DistanceRes = { distance_km: 25, duration_minutes: 40, origin: '起點', destination: '終點' };
  return mockRes.CreateRes(data, 400);
};
