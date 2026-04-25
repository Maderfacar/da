#!/usr/bin/env node
import { cp, rm, mkdir, access, constants } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const srcDir = resolve(projectRoot, 'node_modules/tinymce');
const destDir = resolve(projectRoot, 'public/tinymce');
const langSrcDir = resolve(projectRoot, 'node_modules/tinymce-i18n/langs8');
const langDestDir = resolve(destDir, 'langs');

const entries = [
  'tinymce.min.js',
  'tinymce.js',
  'skins',
  'themes',
  'icons',
  'plugins',
  'models',
  'license.md',
  'LICENSE.TXT'
];

// 要複製的語系檔（與 i18n 的 code 對應）
const langs = ['zh-TW.js', 'en.js', 'ja.js'];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(srcDir))) {
    console.warn(`[copy-tinymce] skip: ${srcDir} not found. Run npm install first.`);
    return;
  }

  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  for (const name of entries) {
    const from = resolve(srcDir, name);
    const to = resolve(destDir, name);
    if (!(await exists(from))) continue;
    await cp(from, to, { recursive: true });
  }

  // 複製語系檔（from tinymce-i18n）
  if (await exists(langSrcDir)) {
    await mkdir(langDestDir, { recursive: true });
    for (const file of langs) {
      const from = resolve(langSrcDir, file);
      const to = resolve(langDestDir, file);
      if (!(await exists(from))) continue;
      await cp(from, to);
    }
  }

  console.log(`[copy-tinymce] copied TinyMCE assets to ${destDir}`);
}

main().catch((err) => {
  console.error('[copy-tinymce] failed:', err);
  process.exit(1);
});
