## ADDED Requirements

### Requirement: id_token 以標準函式庫本地驗證
系統 SHALL 使用標準 JWT 函式庫，在本地驗證 LINE id_token 的簽章、簽發者、對象與有效期，MUST NOT 由本專案自行撰寫簽發者或對象的比對邏輯。驗證 SHALL 將可接受的簽章演算法限定於明確白名單，白名單外一律拒絕。

#### Scenario: 合法 token 通過驗證並取出身分
- **WHEN** 收到簽章正確、簽發者與對象皆相符且未過期的 id_token
- **THEN** 驗證通過，回傳其中的使用者識別碼、顯示名稱與頭像

#### Scenario: 對象不符必須失敗
- **WHEN** id_token 的對象與本服務的 channel 不符
- **THEN** 驗證失敗，且失敗原因標示為 claims 類

#### Scenario: 簽章遭竄改必須失敗
- **WHEN** id_token 的簽章無法以簽發者公開金鑰驗證
- **THEN** 驗證失敗，且失敗原因標示為簽章類

#### Scenario: 已過期必須失敗
- **WHEN** id_token 已過有效期
- **THEN** 驗證失敗

### Requirement: 依 token 實際演算法選用金鑰
系統 SHALL 依 id_token 標頭實際宣告的簽章演算法選用對應金鑰，MUST NOT 假定單一演算法。LINE 的兩條登入路徑使用不同演算法：瀏覽器 OAuth（web login）為 `HS256`、以 channel secret 驗；LIFF / 原生 SDK 為 `ES256`、以簽發者公開金鑰驗。

#### Scenario: 瀏覽器 OAuth 流程的 token
- **WHEN** 收到 `alg` 為 `HS256` 的 id_token
- **THEN** 以 channel secret 完成驗簽，不得因演算法不符單一預期而拒絕

#### Scenario: LIFF / 原生流程的 token
- **WHEN** 收到 `alg` 為 `ES256` 的 id_token
- **THEN** 以簽發者公開金鑰完成驗簽

#### Scenario: 白名單外的演算法必須拒絕
- **WHEN** 收到 `alg` 不在白名單內的 id_token
- **THEN** 驗證失敗，且失敗原因標示為簽章類

### Requirement: 公開金鑰輪替不得導致驗證全面失效
系統 SHALL 依 token 標頭的金鑰識別碼查找對應公開金鑰，並在遇到未知識別碼時自動重新取得金鑰集。MUST NOT 只取得一次金鑰集後永久沿用。

#### Scenario: 簽發者輪替金鑰後仍能驗證
- **WHEN** 簽發者以先前未見過的金鑰識別碼簽發 id_token
- **THEN** 系統重新取得金鑰集並完成驗證，不得因此失敗

### Requirement: 驗證失敗原因可區分
系統 SHALL 將驗證失敗歸類為可機器判讀的原因，至少區分：金鑰取得失敗、簽章錯誤、宣告不符、nonce 不符。該原因 SHALL 寫入登入失敗紀錄。MUST NOT 將不同原因合併為同一訊息。失敗結果 SHALL 附帶實際觀測到的簽章演算法，MUST NOT 只陳述期望值。驗證成功時亦 SHALL 記錄實際演算法，否則無從判斷正常運作時走的是哪條路徑。

#### Scenario: 設定錯誤與網路異常可分辨
- **WHEN** 因對象設定錯誤而驗證失敗
- **THEN** 紀錄中的原因為宣告類，與金鑰取得失敗明確不同

#### Scenario: 失敗與成功皆須留下實際演算法
- **WHEN** 驗證失敗
- **THEN** 結果中附帶實際觀測到的 `alg`，使排查不需以推論還原
- **WHEN** 驗證成功
- **THEN** 登入成功紀錄中亦帶有實際 `alg`

### Requirement: 對象比對不受設定型別影響
系統 SHALL 在比對前將 channel 識別碼正規化為字串，即使呼叫端傳入數字型別亦不得靜默通過驗證。

#### Scenario: 傳入數字型別的 channel 識別碼
- **WHEN** channel 識別碼以數字型別傳入驗證函式
- **THEN** 比對結果 SHALL 與傳入等值字串時一致，MUST NOT 因型別差異而讓不相符的 token 通過

### Requirement: 登入行為不變
本變更 MUST NOT 改變登入的對外行為：三端使用者的登入流程、導向目標與既有的登入結果埋點皆維持不變。

#### Scenario: 瀏覽器登入成功後埋點不變
- **WHEN** 使用者以一般瀏覽器完成登入
- **THEN** 仍寫入登入成功紀錄，且路徑標示維持為瀏覽器 OAuth 路徑
