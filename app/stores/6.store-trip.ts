// 司機端任務狀態機
// 狀態流轉：Pending → Confirmed → Processing → Completed
export const StoreTrip = defineStore('StoreTrip', () => {
  type TripStatus = 'idle' | 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled';

  interface Trip {
    id: string;
    passenger_id: string;
    origin: string;
    destination: string;
    estimated_minutes: number;
    status: TripStatus;
    created_at: string;
  }

  /** 當前行程資料 */
  const currentTrip = ref<Trip | null>(null);

  /** 當前狀態 */
  const status = computed<TripStatus>(() => currentTrip.value?.status ?? 'idle');

  /** 接受行程（Pending → Confirmed） */
  const Confirm = () => {
    if (!currentTrip.value) return;
    currentTrip.value.status = 'confirmed';
  };

  /** 開始行程（Confirmed → Processing） */
  const Start = () => {
    if (!currentTrip.value) return;
    currentTrip.value.status = 'processing';
  };

  /** 完成行程（Processing → Completed） */
  const Complete = () => {
    if (!currentTrip.value) return;
    currentTrip.value.status = 'completed';
  };

  /** 取消行程 */
  const Cancel = () => {
    if (!currentTrip.value) return;
    currentTrip.value.status = 'cancelled';
  };

  /** 清除行程資料 */
  const Reset = () => {
    currentTrip.value = null;
  };

  /** 設定新行程（由 Firestore 推播觸發） */
  const SetTrip = (trip: Trip) => {
    currentTrip.value = trip;
  };

  return {
    currentTrip,
    status,
    Confirm,
    Start,
    Complete,
    Cancel,
    Reset,
    SetTrip,
  };
});
