// Form 驗證集合
// https://github.com/yiminghe/async-validator

const CheckAge18 = (_rule: any, value: string, callback: any) => {
  if (!value) {
    callback();
    return;
  }
  // 年齡不可低於18歲
  const minAgeDate = $dayjs().subtract(18, 'year');
  if ($dayjs(value).isAfter(minAgeDate)) {
    callback(new Error('年齡必須滿18歲'));
  } else {
    callback();
  }
};

export const UseVerify = () => {
  const enter = computed(() => ({ required: true, message: '請輸入', trigger: 'change' }));
  const select = computed(() => ({ required: true, message: '請選擇', trigger: 'change' }));
  const string = computed(() => ({ required: true, message: '請輸入', type: 'string', trigger: 'change' }));
  const boolean = computed(() => ({ required: true, message: '請選擇', type: 'boolean', trigger: 'change' }));
  const number = computed(() => ({ required: true, message: '請輸入數字', type: 'number', trigger: 'change' }));
  const numberText = computed(() => ({ required: true, message: '請輸入數字', pattern: /^\d+$/, trigger: 'change' }));
  const mail = computed(() => ({ required: true, message: '請輸入電子郵件', type: 'email', trigger: 'change' }));

  const age18 = computed(() => ({ required: true, validator: CheckAge18, trigger: 'change' }));

  return {
    enter,
    select,
    string,
    boolean,
    number,
    numberText,
    mail,
    age18
  };
};
