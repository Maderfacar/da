import * as mock from './mock';
import methods from '@/protocol/fetch-api/methods';

const IsMock = () => {
  const { public: { testMode } } = useRuntimeConfig();
  return testMode === 'T';
};

// -----------------------------------------------------------------------------------------------
/** 登入 */
export const SignIn = (params: SignInParams) => {
  if (IsMock()) return mock.SignIn(); // Mock
  return methods.post<SignInRes>('/apiurl/sign-in', params);
};
/** 忘記密碼 */
export const ForgotPassword = (params: ForgotPasswordParams) => {
  if (IsMock()) return mock.ForgotPassword(); // Mock
  return methods.post<ForgotPasswordRes>('/apiurl/forgot-password', params);
};

/** 註冊 */
export const SignUp = (params: SignUpParams) => {
  if (IsMock()) return mock.SignUp(); // Mock
  return methods.post<SignUpRes>('/apiurl/sign-up', params);
};
