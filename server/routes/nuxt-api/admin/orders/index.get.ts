import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

export default defineEventHandler(async (event) => {
  // P14：必須登入；P18：套 canManageOrders 權限（admin/assistant 都有此權限）
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const query = getQuery(event);
  const { status } = query as { status?: string };

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    let q = db.collection('orders').orderBy('createdAt', 'desc').limit(200) as FirebaseFirestore.Query;
    if (status) q = q.where('orderStatus', '==', status);

    const snapshot = await q.get();

    const orders = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        orderId: d.orderId as string,
        userId: d.userId as string,
        lineUserId: (d.lineUserId as string) ?? '',
        orderType: d.orderType as string,
        pickupDateTime: d.pickupDateTime as string,
        pickupLocation: d.pickupLocation as { address: string; displayName?: string },
        dropoffLocation: d.dropoffLocation as { address: string; displayName?: string },
        vehicleType: d.vehicleType as string,
        estimatedFare: (d.estimatedFare as number) ?? 0,
        distanceKm: (d.distanceKm as number) ?? 0,
        orderStatus: (d.orderStatus as string) ?? 'pending',
        assignedDriverId: (d.assignedDriverId as string) ?? '',
        createdAt: d.createdAt?.toMillis?.() ?? 0,
      };
    });

    return successResponse(orders);
  } catch (err) {
    console.error('[admin/orders] Firestore query failed:', err);
    return serverError();
  }
});
