// 乘客端訂單狀態管理
export const StoreOrder = defineStore('StoreOrder', () => {
  type OrderStatus = 'idle' | 'searching' | 'matched' | 'in_progress' | 'completed' | 'cancelled';

  interface Order {
    id: string;
    driver_id: string | null;
    origin: string;
    destination: string;
    estimated_minutes: number;
    estimated_fare: number;
    status: OrderStatus;
    created_at: string;
  }

  /** 當前進行中訂單 */
  const currentOrder = ref<Order | null>(null);

  /** 歷史訂單列表 */
  const orderHistory = ref<Order[]>([]);

  /** 當前訂單狀態 */
  const status = computed<OrderStatus>(() => currentOrder.value?.status ?? 'idle');

  /** 建立新訂單 */
  const CreateOrder = (order: Order) => {
    currentOrder.value = order;
  };

  /** 更新訂單狀態（由 Firestore 即時推播） */
  const UpdateStatus = (newStatus: OrderStatus) => {
    if (!currentOrder.value) return;
    currentOrder.value.status = newStatus;
  };

  /** 訂單完成，移入歷史紀錄 */
  const ArchiveOrder = () => {
    if (!currentOrder.value) return;
    orderHistory.value.unshift(currentOrder.value);
    currentOrder.value = null;
  };

  /** 取消訂單 */
  const CancelOrder = () => {
    UpdateStatus('cancelled');
    ArchiveOrder();
  };

  return {
    currentOrder,
    orderHistory,
    status,
    CreateOrder,
    UpdateStatus,
    ArchiveOrder,
    CancelOrder,
  };
});
