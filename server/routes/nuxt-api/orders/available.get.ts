import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError } from '@@/utils/response';

export default defineEventHandler(async (event) => {
  const { firebaseServiceAccountJson } = useRuntimeConfig();

  if (!firebaseServiceAccountJson) {
    return successResponse([] as object[]);
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db
      .collection('orders')
      .where('orderStatus', '==', 'pending')
      .orderBy('pickupDateTime', 'asc')
      .limit(50)
      .get();

    const orders = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        orderId: d.orderId as string,
        orderType: d.orderType as string,
        pickupDateTime: d.pickupDateTime as string,
        pickupLocation: d.pickupLocation as { address: string; lat: number; lng: number; displayName?: string },
        dropoffLocation: d.dropoffLocation as { address: string; lat: number; lng: number; displayName?: string },
        vehicleType: d.vehicleType as string,
        passengerCount: (d.passengerCount as number) ?? 1,
        estimatedFare: (d.estimatedFare as number) ?? 0,
        distanceKm: (d.distanceKm as number) ?? 0,
      };
    });

    return successResponse(orders);
  } catch (err) {
    console.error('[orders/available] Firestore query failed:', err);
    return serverError();
  }
});
