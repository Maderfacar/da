// （不用動）
/** 抽屜參數 */
interface OpenItem<T> {
  /** UUID */
  uuid: string
  /** 可以開的組件 */
  componentName: OpenComponent
  /** 參數 */
  params: OpenParams
  /** 回傳用 */
  resolve: (value: T | PromiseLike<T>) => void
  /** 等級 */
  level?: number
}
