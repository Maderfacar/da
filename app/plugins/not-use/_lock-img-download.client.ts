// 全局阻止圖片下載
export default defineNuxtPlugin(() => {
  const lockImgDownloadStyleId = 'lock-img-download-style';

  // 阻止圖片下載選單
  if (!document.getElementById(lockImgDownloadStyleId)) {
    const styleElement = document.createElement('style');
    styleElement.id = lockImgDownloadStyleId;
    styleElement.textContent = `
      img {
        -webkit-touch-callout: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
    `;
    document.head.appendChild(styleElement);
  }

  // 阻止圖片右鍵選單
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target && target.tagName.toLowerCase() === 'img') {
      e.preventDefault();
    }
  });

  // 阻止圖片拖曳
  document.addEventListener('dragstart', (e: DragEvent) => {
    const target = e.target as HTMLElement;
    if (target && target.tagName.toLowerCase() === 'img') {
      e.preventDefault();
    }
  });
});
