import type { MessageType } from 'element-plus';
/** 詢問集合 */
export const UseAsk = () => {
  /** 通用 */
  const Any = (
    content: string, 
    title: string, 
    cancelButtonText:string ='取消',
    confirmButtonText = '確定', 
    type: MessageType = 'warning'
  ) => {
    return ElMessageBox.confirm(
      content,
      title,
      {
        cancelButtonText,
        confirmButtonText,
        type
      }
    ).then(() => true).catch(() => false);
  };

  /** 刪除詢問 */
  const Delete = (item: string = '') => {
    return ElMessageBox.confirm(
      `確定要刪除${item ? `『${item}』` : ''}嗎？`,
      '刪除詢問',
      {
        cancelButtonText: '取消',
        confirmButtonText: '確定',
        type: 'warning'
      }
    ).then(() => true).catch(() => false);
  };

  /** 登出詢問 */
  const SignOut = () => {
    return ElMessageBox.confirm(
      '是否要登出？',
      '登出詢問',
      {
        cancelButtonText: '取消',
        confirmButtonText: '登出',
        type: 'warning'
      }
    ).then(() => true).catch(() => false);
  };

  /** 取消詢問 */
  const Cancel = () => {
    return ElMessageBox.confirm(
      '確定要取消？',
      '取消詢問',
      {
        cancelButtonText: '關閉',
        confirmButtonText: '確定取消',
        type: 'warning'
      }
    ).then(() => true).catch(() => false);
  };

  /**  改變時關閉詢問 */
  const ChangeClose = () => {
    return ElMessageBox.confirm(
      '有變動尚未完成，確定是否要關閉?',
      '關閉詢問',
      {
        cancelButtonText: '取消',
        confirmButtonText: '確定',
        type: 'warning'
      }
    ).then(() => true).catch(() => false);
  };
  return {
    /** 通用 */
    Any,
    /** 刪除 */
    Delete,
    /** 登出 */
    SignOut,
    /** 取消 */
    Cancel,
    /** 改變時關閉詢問 */
    ChangeClose
  };
};
