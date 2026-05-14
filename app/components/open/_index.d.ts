// 組件群 -----------------------------------------------------------------------------------------------
type OpenComponent =
  'OpenDialogDemo'
  | 'OpenDrawerDemoInfo'
  | 'OpenDialogVideoRecording' // 影片錄製
  | 'OpenDialogImageSelect' // 圖片選擇
  | 'OpenDialogAnnouncementEdit' // P37：公告編輯
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
// TODO 組件加完後，要設定