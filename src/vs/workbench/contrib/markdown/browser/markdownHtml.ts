/*---------------------------------------------------------------------------------------------
 *  SideX — Markdown 到 HTML 的共用渲染器
 *
 *  主编辑器里的 Markdown 预览（webview）与侧栏预览面板共用这一份渲染逻辑，
 *  代码高亮、table/任务列表、KaTeX 公式与 Mermaid 图表的处理保持一致。
 *--------------------------------------------------------------------------------------------*/

import { sanitizeHtml } from '../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlAttributes, allowedMarkdownHtmlTags } from '../../../../base/browser/markdownRenderer.js';
import * as marked from '../../../../base/common/marked/marked.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { tokenizeToString } from '../../../../editor/common/languages/textToHtmlTokenizer.js';
import { MarkedKatexExtension } from '../common/markedKatexExtension.js';
import { markedGfmHeadingIdPlugin } from './markedGfmHeadingIdPlugin.js';
import { MarkedKatexSupport } from './markedKatexSupport.js';
import { escapeHtml, renderMermaid } from './mermaidRenderer.js';

const HAS_SCHEME = /^\w[\w\d+.-]*:/;

export interface IMarkdownRenderOptions {
	readonly languageService: ILanguageService;
	readonly isLight: boolean;
}

export interface IMarkdownRenderResult {
	/** 已清洗的 HTML；Mermaid 代码块已替换为内联 SVG。 */
	readonly html: string;
	/** 是否包含数学公式，调用方据此决定是否注入 KaTeX 样式。 */
	readonly hasMath: boolean;
}

/** 文档里是否可能出现 `$...$` 公式。 */
export function markdownHasMath(text: string): boolean {
	return /\$(?!\s)[^$\n]+\$|\$\$/.test(text);
}

/** 相对链接基于文档所在目录解析；带协议的原样返回。 */
export function resolveMarkdownUri(baseDir: URI, href: string): URI {
	if (HAS_SCHEME.test(href)) {
		return URI.parse(href);
	}
	return URI.joinPath(baseDir, href);
}

/**
 * 渲染 Markdown 文本。返回的 HTML 已经过安全清洗，调用方可以直接插入 DOM。
 */
export async function renderMarkdownToHtml(text: string, options: IMarkdownRenderOptions): Promise<IMarkdownRenderResult> {
	const diagrams = new Map<string, string>();
	const instance = new marked.Marked(
		markedHighlight({
			async: true,
			highlight: async (code: string, lang: string) => {
				const languageName = lang.split(/\s+|:|,|(?!^)\{|\?]/, 1)[0];
				const languageId =
					options.languageService.getLanguageIdByLanguageName(lang) ??
					options.languageService.getLanguageIdByLanguageName(languageName) ??
					null;
				return tokenizeToString(options.languageService, code, languageId);
			},
			diagram: source => {
				const token = `SIDEXDIAGRAM${diagrams.size}TOKEN`;
				diagrams.set(token, source);
				return token;
			}
		}),
		markedGfmHeadingIdPlugin()
	);

	const katexExtension = await loadKatexExtension();
	if (katexExtension) {
		instance.use(katexExtension);
	}

	const raw = await instance.parse(text, { async: true }) as string;
	let html = sanitize(raw);
	for (const [token, source] of diagrams) {
		const svg = await renderMermaid(source, options.isLight);
		html = html.replace(token, () => svg);
	}
	return { html, hasMath: markdownHasMath(text) };
}

/**
 * Local copy of the `marked-highlight` extension. `renderMarkdownDocument` uses
 * the same helper, but it waits for the extension service to register, which
 * never resolves when no Node extension host is running.
 */
function markedHighlight(options: {
	async: boolean;
	highlight: (code: string, lang: string) => Promise<string>;
	/** Turns a diagram source into a placeholder token that is expanded after sanitizing. */
	diagram?: (code: string) => string;
}): marked.MarkedExtension {
	return {
		async: options.async,
		walkTokens(token: marked.Token): Promise<void> | void {
			if (token.type !== 'code') {
				return;
			}
			const codeToken = token as marked.Tokens.Code;
			const lang = codeToken.lang;
			if (typeof lang !== 'string') {
				return;
			}
			if (options.diagram && lang.trim().toLowerCase() === 'mermaid') {
				codeToken.text = options.diagram(codeToken.text);
				codeToken.escaped = true;
				return;
			}
			return options.highlight(codeToken.text, lang).then(html => {
				codeToken.text = html;
				codeToken.escaped = true;
			});
		},
		renderer: {
			code({ text, lang, escaped }: marked.Tokens.Code) {
				text = text.replace(/\n$/, '');
				// Diagram placeholders are expanded into SVG after sanitizing.
				if (/^SIDEXDIAGRAM\d+TOKEN$/.test(text)) {
					return text;
				}
				const classAttr = lang ? ` class="language-${escapeAttr(lang)}"` : '';
				return `<pre><code${classAttr}>${escaped ? text : escapeHtml(text)}\n</code></pre>`;
			}
		}
	};
}

function escapeAttr(value: string): string {
	return escapeHtml(value).replace(/"/g, '&quot;');
}

let katexExtensionPromise: Promise<marked.MarkedExtension | undefined> | undefined;

/** Lazily loads KaTeX the first time a markdown preview is rendered. */
function loadKatexExtension(): Promise<marked.MarkedExtension | undefined> {
	if (!katexExtensionPromise) {
		katexExtensionPromise = import('katex')
			.then(module => {
				const katex = ((module as unknown as { default?: typeof import('katex') }).default ?? module) as typeof import('katex');
				return MarkedKatexExtension.extension(katex);
			})
			.catch(error => {
				console.error('[Markdown Preview] failed to load katex', error);
				return undefined;
			});
	}
	return katexExtensionPromise;
}

function sanitize(html: string): string {
	const katexConfig = MarkedKatexSupport.getSanitizerOptions({
		allowedTags: allowedMarkdownHtmlTags,
		allowedAttributes: allowedMarkdownHtmlAttributes
	});
	return sanitizeHtml(html, {
		allowedLinkProtocols: { override: [Schemas.http, Schemas.https, Schemas.file] },
		allowRelativeLinkPaths: true,
		allowedMediaProtocols: { override: [Schemas.http, Schemas.https, Schemas.data, Schemas.file] },
		allowRelativeMediaPaths: true,
		allowedTags: katexConfig.allowedTags,
		allowedAttributes: {
			override: [
				...katexConfig.allowedAttributes!.override,
				'name', 'id', 'role', 'tabindex', 'placeholder'
			]
		}
	}).toString();
}
