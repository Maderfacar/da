// 組件群 -----------------------------------------------------------------------------------------------
type OpenComponent = 
  'OpenDialogDemo' 
  | 'OpenDrawerDemoInfo'
  | 'OpenDialogVideoRecording' // 影片錄製
  | 'OpenDialogImageSelect' // 圖片選擇
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
// TODO 組件加完後，要設定