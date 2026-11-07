/*---------------------------------------------------------------------------------------------
 *  SideX — 文件列表缩略图：图片、视频封面与 PDF 首页。
 *
 *  生成在后台空闲时排队执行，只处理当前可见行；结果按 路径 + mtime + size
 *  缓存在内存和 IndexedDB，命中缓存时不再重新解码。
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { SideXExplorerEntry } from '../../../../platform/sidex/common/sidexExplorerService.js';
import { loadPdfjsCore } from '../../pdfPreview/browser/pdfjsRuntime.js';
import { assetUrl, imageMime, maxThumbnailBytes, thumbnailKindOf, type ThumbnailKind } from '../common/fileKind.js';

export const IThumbnailService = createDecorator<IThumbnailService>('sidexThumbnailService');

export interface IThumbnailService {
	readonly _serviceBrand: undefined;

	/** Resolves to a data URL, or `undefined` when the file has no usable thumbnail. */
	getThumbnail(entry: SideXExplorerEntry): Promise<string | undefined>;
}

const THUMBNAIL_SIZE = 48;
const MAX_CONCURRENT = 2;
const MEMORY_CACHE_LIMIT = 300;
const LOAD_TIMEOUT = 10_000;

interface IMemoryThumbnail {
	readonly mtime: number;
	readonly size: number;
	readonly dataUrl: string;
}

interface IThumbnailJob {
	readonly key: string;
	readonly entry: SideXExplorerEntry;
	readonly kind: ThumbnailKind;
	readonly resolve: (dataUrl: string | undefined) => void;
}

interface IStoredThumbnail {
	readonly path: string;
	readonly mtime: number;
	readonly size: number;
	readonly dataUrl: string;
	readonly created: number;
}

const FAILED = 'failed' as const;

export class ThumbnailService extends Disposable implements IThumbnailService {

	declare readonly _serviceBrand: undefined;

	private readonly memory = new Map<string, IMemoryThumbnail | typeof FAILED>();
	private readonly pending = new Map<string, Promise<string | undefined>>();
	private readonly queue: IThumbnailJob[] = [];
	private active = 0;
	private scheduled = false;
	private disposed = false;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	getThumbnail(entry: SideXExplorerEntry): Promise<string | undefined> {
		if (entry.isDir) {
			return Promise.resolve(undefined);
		}

		const kind = thumbnailKindOf(entry.name);
		if (!kind || entry.size > maxThumbnailBytes(kind)) {
			return Promise.resolve(undefined);
		}

		const key = entry.path.toLowerCase();
		const cached = this.memory.get(key);
		if (cached === FAILED) {
			return Promise.resolve(undefined);
		}
		if (cached && cached.mtime === entry.modified && cached.size === entry.size) {
			return Promise.resolve(cached.dataUrl);
		}

		const inflight = this.pending.get(key);
		if (inflight) {
			return inflight;
		}

		const promise = new Promise<string | undefined>(resolve => {
			this.queue.push({ key, entry, kind, resolve });
			this.schedule();
		}).finally(() => this.pending.delete(key));
		this.pending.set(key, promise);
		return promise;
	}

	override dispose(): void {
		this.disposed = true;
		for (const job of this.queue.splice(0)) {
			job.resolve(undefined);
		}
		super.dispose();
	}

	/** Yield to scrolling/input first; generation runs only when the main thread is idle. */
	private schedule(): void {
		if (this.scheduled || this.disposed) {
			return;
		}
		this.scheduled = true;
		const run = () => {
			this.scheduled = false;
			this.pump();
		};
		if (typeof window.requestIdleCallback === 'function') {
			window.requestIdleCallback(run, { timeout: 1000 });
		} else {
			window.setTimeout(run, 16);
		}
	}

	private pump(): void {
		while (!this.disposed && this.active < MAX_CONCURRENT && this.queue.length) {
			const job = this.queue.shift()!;
			this.active++;
			void this.runJob(job).finally(() => {
				this.active--;
				this.pump();
			});
		}
	}

	private async runJob(job: IThumbnailJob): Promise<void> {
		try {
			const stored = await readStoredThumbnail(job.key, job.entry.modified, job.entry.size);
			if (stored) {
				this.remember(job.key, {
					mtime: job.entry.modified,
					size: job.entry.size,
					dataUrl: stored
				});
				job.resolve(stored);
				return;
			}

			const dataUrl = await this.generate(job.entry, job.kind);
			if (!dataUrl) {
				this.memory.set(job.key, FAILED);
				job.resolve(undefined);
				return;
			}
			this.remember(job.key, { mtime: job.entry.modified, size: job.entry.size, dataUrl });
			await writeStoredThumbnail({
				path: job.key,
				mtime: job.entry.modified,
				size: job.entry.size,
				dataUrl,
				created: Date.now()
			});
			job.resolve(dataUrl);
		} catch (error) {
			this.logService.trace('[thumbnails] failed for', job.entry.path, error);
			this.memory.set(job.key, FAILED);
			job.resolve(undefined);
		}
	}

	private remember(key: string, thumbnail: IMemoryThumbnail): void {
		this.memory.set(key, thumbnail);
		if (this.memory.size > MEMORY_CACHE_LIMIT) {
			const oldest = this.memory.keys().next();
			if (!oldest.done) {
				this.memory.delete(oldest.value);
			}
		}
	}

	private async generate(entry: SideXExplorerEntry, kind: ThumbnailKind): Promise<string | undefined> {
		switch (kind) {
			case 'image':
				return this.generateImage(entry);
			case 'video':
				return this.generateVideo(entry);
			case 'pdf':
				return this.generatePdf(entry);
		}
	}

	private async generateImage(entry: SideXExplorerEntry): Promise<string | undefined> {
		const file = await this.fileService.readFile(URI.file(entry.path));
		const blob = new Blob([file.value.buffer as unknown as BlobPart], { type: imageMime(entry.name) });
		const url = URL.createObjectURL(blob);
		try {
			const image = new Image();
			image.decoding = 'async';
			image.src = url;
			await waitForImage(image, LOAD_TIMEOUT);
			return renderImage(image, image.naturalWidth, image.naturalHeight);
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	private async generateVideo(entry: SideXExplorerEntry): Promise<string | undefined> {
		const video = document.createElement('video');
		video.preload = 'metadata';
		video.muted = true;
		video.playsInline = true;
		video.crossOrigin = 'anonymous';

		try {
			video.src = assetUrl(entry.path, entry.modified);
			await waitForEvent(video, 'loadedmetadata', LOAD_TIMEOUT);
			if (video.videoWidth === 0 || video.videoHeight === 0) {
				return undefined;
			}

			const duration = Number.isFinite(video.duration) ? video.duration : 0;
			const target = duration > 0 ? Math.min(1, duration / 10) : 0;
			video.currentTime = target === 0 ? 0.001 : target;
			await waitForEvent(video, 'seeked', LOAD_TIMEOUT);
			return renderImage(video, video.videoWidth, video.videoHeight);
		} finally {
			video.removeAttribute('src');
			video.load();
		}
	}

	private async generatePdf(entry: SideXExplorerEntry): Promise<string | undefined> {
		const [pdfjs, file] = await Promise.all([
			loadPdfjsCore(),
			this.fileService.readFile(URI.file(entry.path))
		]);

		const documentProxy = await pdfjs.getDocument({
			data: new Uint8Array(file.value.buffer.slice(0)),
			cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
			cMapPacked: true,
			standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
			isEvalSupported: false
		}).promise;

		try {
			const page = await documentProxy.getPage(1);
			const baseViewport = page.getViewport({ scale: 1 });
			const scale = THUMBNAIL_SIZE / Math.max(baseViewport.width, baseViewport.height);
			const viewport = page.getViewport({ scale });
			const canvas = document.createElement('canvas');
			canvas.width = THUMBNAIL_SIZE;
			canvas.height = THUMBNAIL_SIZE;
			const context = canvas.getContext('2d');
			if (!context) {
				return undefined;
			}
			await page.render({
				canvasContext: context,
				viewport,
				transform: [
					1,
					0,
					0,
					1,
					(THUMBNAIL_SIZE - viewport.width) / 2,
					(THUMBNAIL_SIZE - viewport.height) / 2
				]
			}).promise;
			return canvas.toDataURL('image/png');
		} finally {
			void documentProxy.destroy();
		}
	}
}

function renderImage(source: CanvasImageSource, width: number, height: number): string | undefined {
	if (!width || !height) {
		return undefined;
	}
	const canvas = document.createElement('canvas');
	canvas.width = THUMBNAIL_SIZE;
	canvas.height = THUMBNAIL_SIZE;
	const context = canvas.getContext('2d');
	if (!context) {
		return undefined;
	}

	const scale = Math.min(THUMBNAIL_SIZE / width, THUMBNAIL_SIZE / height);
	const drawWidth = Math.max(1, Math.round(width * scale));
	const drawHeight = Math.max(1, Math.round(height * scale));
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(source, (THUMBNAIL_SIZE - drawWidth) / 2, (THUMBNAIL_SIZE - drawHeight) / 2, drawWidth, drawHeight);
	return canvas.toDataURL('image/png');
}

function waitForImage(image: HTMLImageElement, timeout: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error('image load timed out')), timeout);
		image.onload = () => {
			window.clearTimeout(timer);
			resolve();
		};
		image.onerror = () => {
			window.clearTimeout(timer);
			reject(new Error('image load failed'));
		};
		// Start loading only after handlers are installed.
		if (image.complete && image.naturalWidth) {
			window.clearTimeout(timer);
			resolve();
		}
	});
}

function waitForEvent(target: HTMLVideoElement, event: string, timeout: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			cleanup();
			reject(new Error(`${event} timed out`));
		}, timeout);
		const cleanup = () => {
			window.clearTimeout(timer);
			target.removeEventListener(event, onEvent);
			target.removeEventListener('error', onError);
		};
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error('video load failed'));
		};
		target.addEventListener(event, onEvent, { once: true });
		target.addEventListener('error', onError, { once: true });
	});
}

// --- persistent cache (IndexedDB; silently degrades to memory-only) ---

const DB_NAME = 'sidex-thumbnails';
const STORE_NAME = 'thumbs';
let databasePromise: Promise<IDBDatabase | undefined> | undefined;
let writesSincePrune = 0;

function openDatabase(): Promise<IDBDatabase | undefined> {
	if (!databasePromise) {
		databasePromise = new Promise(resolve => {
			try {
				const request = indexedDB.open(DB_NAME, 1);
				request.onupgradeneeded = () => {
					const database = request.result;
					if (!database.objectStoreNames.contains(STORE_NAME)) {
						database.createObjectStore(STORE_NAME, { keyPath: 'path' });
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(undefined);
				request.onblocked = () => resolve(undefined);
			} catch {
				resolve(undefined);
			}
		});
	}
	return databasePromise;
}

async function readStoredThumbnail(path: string, mtime: number, size: number): Promise<string | undefined> {
	const database = await openDatabase();
	if (!database) {
		return undefined;
	}
	return new Promise(resolve => {
		try {
			const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(path);
			request.onsuccess = () => {
				const stored = request.result as IStoredThumbnail | undefined;
				resolve(stored && stored.mtime === mtime && stored.size === size ? stored.dataUrl : undefined);
			};
			request.onerror = () => resolve(undefined);
		} catch {
			resolve(undefined);
		}
	});
}

async function writeStoredThumbnail(thumbnail: IStoredThumbnail): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		return;
	}
	await new Promise<void>(resolve => {
		try {
			const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(thumbnail);
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
		} catch {
			resolve();
		}
	});
	if (++writesSincePrune >= 200) {
		writesSincePrune = 0;
		void pruneStoredThumbnails(database);
	}
}

async function pruneStoredThumbnails(database: IDBDatabase): Promise<void> {
	try {
		const count = await new Promise<number>(resolve => {
			const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(0);
		});
		if (count <= 1000) {
			return;
		}

		const transaction = database.transaction(STORE_NAME, 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		let remaining = count;
		const request = store.openCursor();
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor || remaining <= 700) {
				return;
			}
			cursor.delete();
			remaining--;
			cursor.continue();
		};
	} catch {
		// Cache pruning is best-effort.
	}
}
