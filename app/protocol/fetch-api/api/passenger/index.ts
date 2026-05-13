import methods from '@/protocol/fetch-api/methods';

// P35：乘客累積統計（profile 頁「我的旅程」用）

export interface PassengerStats {
  totalTrips: number;
  totalDistanceKm: number;
  totalSpent: number;
  firstTripAt: string | null;
}

/** 乘客累積統計（自己；passenger / driver / admin 都只能看自己） */
export const GetPassengerStats = () =>
  methods.get<PassengerStats>('/nuxt-api/passengers/me/stats', {});
