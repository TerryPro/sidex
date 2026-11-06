/*---------------------------------------------------------------------------------------------
 *  SideX: lazily loaded pdf.js runtime shared by the PDF preview and file thumbnails.
 *--------------------------------------------------------------------------------------------*/

export type PdfjsModule = typeof import('pdfjs-dist');

let corePromise: Promise<PdfjsModule> | undefined;

/**
 * Loads the pdf.js core module once. `pdf_viewer.mjs` reads `globalThis.pdfjsLib`
 * during module evaluation, so the worker path and global must be set first.
 */
export function loadPdfjsCore(): Promise<PdfjsModule> {
	if (!corePromise) {
		corePromise = (async () => {
			const pdfjs = await import('pdfjs-dist');
			// worker 由 scripts/copy-pdfjs-assets.js 复制到 public/pdfjs/，用 .js 后缀
			// 保证任何静态服务都会返回 JS 的 MIME 类型
			pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.js', document.baseURI).href;
			(globalThis as unknown as { pdfjsLib: PdfjsModule }).pdfjsLib = pdfjs;
			return pdfjs;
		})().catch(error => {
			corePromise = undefined;
			throw error;
		});
	}
	return corePromise;
}

/** Loads the viewer UI module after the core runtime is ready. */
export function loadPdfViewerModule(): Promise<typeof import('pdfjs-dist/web/pdf_viewer.mjs')> {
	return loadPdfjsCore().then(() => import('pdfjs-dist/web/pdf_viewer.mjs'));
}
