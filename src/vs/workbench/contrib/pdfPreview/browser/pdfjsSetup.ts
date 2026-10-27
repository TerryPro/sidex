/*---------------------------------------------------------------------------------------------
 *  SideX: pdf.js 运行时初始化
 *
 *  pdfjs-dist/web/pdf_viewer.mjs 是从官方 viewer 打包出来的，它在模块求值时会从
 *  `globalThis.pdfjsLib` 解构 getDocument、GlobalWorkerOptions 等内核 API。
 *  内核模块自己也会设置这个全局，这里显式再挂一次以确保求值顺序与新入口一致。
 *--------------------------------------------------------------------------------------------*/

import * as pdfjsLib from 'pdfjs-dist';

// worker 由 scripts/copy-pdfjs-assets.js 复制到 public/pdfjs/，用 .js 后缀
// 保证任何静态服务都会返回 JS 的 MIME 类型
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.js', document.baseURI).href;

(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;
