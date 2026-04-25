<script setup lang="ts">
// DemoTinymce：TinyMCE 富文本編輯器 Demo 頁面（左編輯器、右即時預覽）

const content = ref('<p>在此輸入內容...</p>');

const sampleHtml = `
<h2>TinyMCE 8 範例內容</h2>
<p>這是一段<strong>粗體文字</strong>、<em>斜體文字</em>、<u>底線文字</u>、<s>刪除線文字</s>。</p>
<p style="color: #e74c3c;">這是紅色文字。</p>
<p style="text-align: center;">置中對齊段落</p>
<ul>
  <li>無序清單項目 1</li>
  <li>無序清單項目 2</li>
</ul>
<ol>
  <li>有序清單項目 1</li>
  <li>有序清單項目 2</li>
</ol>
<p><a href="https://www.tiny.cloud/" target="_blank">TinyMCE 官方網站</a></p>
<p>YouTube 影片嵌入範例：</p>
<p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315" allowfullscreen></iframe></p>
`.trim();

const ClickClear = () => {
  content.value = '';
};

const ClickLoadSample = () => {
  content.value = sampleHtml;
};
</script>

<template lang="pug">
.DemoTinymce
  .DemoTinymce__header
    h1.DemoTinymce__title TinyMCE 8 富文本編輯器 Demo
    p.DemoTinymce__desc
      | 左側為編輯器、右側為即時預覽。支援字型、顏色、排版、清單、連結、圖片上傳（骨架 API）、YouTube 影片嵌入等。
    .DemoTinymce__actions
      ElButton(@click="ClickLoadSample") 載入範例
      ElButton(@click="ClickClear") 清空內容
      NuxtLink.DemoTinymce__back(to="/") ← 回首頁

  .DemoTinymce__body
    .DemoTinymce__editor
      .DemoTinymce__label 編輯器
      TinyEditor(v-model="content")

    .DemoTinymce__preview
      .DemoTinymce__label 即時預覽
      //- ⚠️ 正式業務使用時，v-html 應搭配 HTML sanitize（例如 DOMPurify），避免 XSS
      .DemoTinymce__previewContent.rich-content(v-html="content")
</template>

<style lang="scss" scoped>
.DemoTinymce {
  padding: 24px;
  max-width: 1600px;
  margin: 0 auto;
}

.DemoTinymce__header {
  margin-bottom: 24px;
}

.DemoTinymce__title {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 600;
}

.DemoTinymce__desc {
  margin: 0 0 16px 0;
  color: #666;
  font-size: 14px;
}

.DemoTinymce__actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.DemoTinymce__back {
  margin-left: auto;
  color: #409eff;
  text-decoration: none;
  font-size: 14px;
}

.DemoTinymce__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;

  @include rwd-mobile {
    grid-template-columns: 1fr;
  }
}

.DemoTinymce__editor,
.DemoTinymce__preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.DemoTinymce__label {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.DemoTinymce__previewContent {
  min-height: 500px;
  padding: 16px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  overflow: auto;
  word-break: break-word;
}

.DemoTinymce__previewContent :deep(img) {
  max-width: 100%;
  height: auto;
}
</style>
