/** 儲存打開的組件（不用調整） */
export const StoreOpen = defineStore('StoreOpen', () => {

  const openList = ref<OpenItem<any>[]>([]);

  /** 開啟 */
  const OnOpen = <T>(openItem: OpenItem<T>) => {
    openList.value.push(openItem);
  };

  /** 關閉 */
  const OnClose = (uuid: string | string[]) => {
    const uuidList = Array.isArray(uuid) ? uuid : [uuid];
    const findIndex = openList.value.findIndex((item) => uuidList.includes(item.uuid));
    if (findIndex === -1) return;
    const item = openList.value[findIndex];
    item?.resolve(false); // 釋放
    openList.value.splice(findIndex, 1);
  };

  /** 關閉所有 */
  const OnCloseAll = () => {
    openList.value.forEach((item) => item?.resolve(false)); // 釋放
    openList.value.length = 0;
  };

  return {
    /** 開啟清單 */
    openList,
    /** 打開 */
    OnOpen,
    /** 關閉 */
    OnClose,
    /** 關閉所有 */
    OnCloseAll
  };
});