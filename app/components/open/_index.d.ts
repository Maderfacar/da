// 組件群 -----------------------------------------------------------------------------------------------
type OpenComponent =
  'OpenDialogDemo'
  | 'OpenDrawerDemoInfo'
  | 'OpenDialogVideoRecording' // 影片錄製
  | 'OpenDialogImageSelect' // 圖片選擇
  | 'OpenDialogAnnouncementEdit' // P37：公告編輯
  | 'OpenDialogLineRichmenuEdit' // P38：LINE richmenu 編輯
  | 'OpenDialogTagEdit' // Phase 1A：車輛 / 司機標籤編輯
  // | 'OpenDialogDemo2'
  // TODO 組件加完後，要設定

// 參數群 -----------------------------------------------------------------------------------------------
type OpenParams =
  OpenDialogDemo
  // | OpenDialogDemo2
  // TODO 組件加完後，要設定

// 組件參數 ---------------------------------------------------------------------------------------------
type DialogDemoParams = {
  demo: string
}

/** P37：公告編輯彈窗參數 */
type DialogAnnouncementEditParams = {
  mode: 'create' | 'edit' | 'republish' | 'duplicate'
  id?: string // edit / republish / duplicate 模式必填（duplicate = 載入 source 內容後 POST 新 doc）
}

/** P38：LINE richmenu 編輯彈窗參數（P42：加 lang 維度 + 從其他 lang 複製） */
type DialogLineRichmenuEditParams = {
  mode: 'create' | 'edit'
  channel: 'passenger' | 'driver' // create 模式必填；edit 模式由 server 既有 doc 決定（忽略此值）
  lang?: 'zh_tw' | 'en' | 'ja' // P42 create 模式必填；edit 模式由 server 既有 doc 決定（忽略此值）
  id?: string // edit 模式必填
  copyFromId?: string // P42 create 模式可選：從來源 doc 複製 areas + chatBarText + image objectPath
}

/** Phase 1A：標籤編輯彈窗參數 */
type DialogTagEditParams = {
  mode: 'create' | 'edit'
  /** create 模式：預設帶入的群組（scope 由群組自動推導） */
  group?: 'power' | 'vehicleType' | 'origin' | 'interior' | 'equipment' | 'driverSkill'
  /** edit 模式必填：標籤 id */
  id?: string
}
// TODO 組件加完後，要設定