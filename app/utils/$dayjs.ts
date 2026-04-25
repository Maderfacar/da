/** 日期工具 */
import dayjs from 'dayjs';

/** 格式化日期 */
const FormatDate = (date: string, format: string = 'YYYY-MM-DD') => {
  if (!date) return '';
  return dayjs(date).format(format);
};

// 將方法添加到 dayjs 的靜態方法中
const dayjsWithPlugins = dayjs as typeof dayjs & {
  FormatDate: typeof FormatDate;
};

dayjsWithPlugins.FormatDate = FormatDate;

export default dayjsWithPlugins;
