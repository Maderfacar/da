
// 登入 -----------------------------------------------------------------------------------------------
interface SignInParams {
  account: string // 帳號
  password: string // 密碼
}

interface SignInRes {
  token: string
}

// 忘記密碼 ---------------------------------------------------------------------------------------------
/** 忘記密碼請求參數。*/
interface ForgotPasswordParams {
  account: string // 帳號或 Email
}

/** 忘記密碼回傳資料結構。*/
interface ForgotPasswordRes {
  success?: boolean
}

// 註冊 -----------------------------------------------------------------------------------------------
/** 註冊請求參數。*/
interface SignUpParams {
  account: string // 帳號或 Email
  password: string // 密碼
}

/** 註冊回傳資料結構。*/
interface SignUpRes {
  success?: boolean
}
