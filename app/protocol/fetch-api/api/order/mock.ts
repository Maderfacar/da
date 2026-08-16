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

export const GetDistance = () => {
  const data: DistanceRes = { distance_km: 25, duration_minutes: 40, origin: '起點', destination: '終點' };
  return mockRes.CreateRes(data, 400);
};
