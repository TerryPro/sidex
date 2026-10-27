/**
 * 把 pdf.js 的 CMap 与标准字体资源复制到 public/pdfjs/ 下，
 * 供内置 PDF 预览在运行时按 URL 加载（打包时再随 public 一起进 dist）。
 * 只复制 pdfjs-dist 包里的静态资源，不涉及任何代码。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = resolve(__dirname, '..');
const source = resolve(root, 'node_modules', 'pdfjs-dist');
const target = resolve(root, 'public', 'pdfjs');
const marker = join(target, '.version');

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

const version = readVersion();
if (!version) {
  console.warn('[pdfjs] pdfjs-dist 未安装，跳过资源复制');
  process.exit(0);
}

if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === version) {
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const dir of ['cmaps', 'standard_fonts']) {
  const from = join(source, dir);
  if (!existsSync(from)) {
    console.warn(`[pdfjs] 缺少目录 ${dir}，跳过`);
    continue;
  }
  cpSync(from, join(target, dir), { recursive: true });
}

// pdf.js 以 `new Worker(url, { type: 'module' })` 加载 worker，浏览器要求
// 服务端返回 JS 的 MIME，`.mjs` 在部分环境会被当成 octet-stream，
// 因此这里统一落成 `.js` 后缀。
cpSync(join(source, 'build', 'pdf.worker.min.mjs'), join(target, 'pdf.worker.min.js'));

writeFileSync(marker, version);
console.log(`[pdfjs] 已复制 CMap 与标准字体资源（pdfjs-dist ${version}）到 public/pdfjs/`);
