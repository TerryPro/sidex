/*---------------------------------------------------------------------------------------------
 *  SideX: Built-in HTML language features.
 *
 *  Drives `vscode-html-languageservice` in the workbench. No diagnostics are
 *  produced because the HTML service itself does not validate documents (VS Code
 *  behaves the same way).
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import type { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { getLanguageService } from 'vscode-html-languageservice';
import type { LanguageService } from 'vscode-html-languageservice';
import {
	createDocumentContext,
	toCompletionItem,
	toDocumentSymbols,
	toEditorRange,
	toHighlightKind,
	toHoverContents,
	toLsPosition,
	toTextDocument,
	wordRangeAtPosition
} from './languageServiceUtils.js';

export const HTML_LANGUAGES = ['html', 'htm'];

export interface HtmlLanguageServiceDependencies {
	readonly languageFeatures: ILanguageFeaturesService;
	readonly modelService: IModelService;
	readonly markerService: IMarkerService;
	readonly logService: ILogService;
}

let htmlService: LanguageService | undefined;

export function registerHtmlLanguageFeatures(deps: HtmlLanguageServiceDependencies): IDisposable[] {
	htmlService ??= getLanguageService();
	const service = htmlService;
	const { languageFeatures } = deps;
	const disposables: IDisposable[] = [];

	disposables.push(languageFeatures.completionProvider.register(HTML_LANGUAGES, {
		_debugDisplayName: 'builtinHtmlLanguageService',
		triggerCharacters: ['<', '>', '"', '=', '/', ' ', ':', '.', '-', '(', ')', ';', '&', '\'', '{'],
		provideCompletionItems: (model, position) => {
			const document = toTextDocument(model);
			const htmlDocument = service.parseHTMLDocument(document);
			const list = service.doComplete(document, toLsPosition(position), htmlDocument, {
				useDefaultDataProvider: true,
				attributeDefaultValue: 'doublequotes'
			});
			if (!list?.items?.length) {
				return null;
			}
			const wordRange = wordRangeAtPosition(model, position);
			return {
				suggestions: list.items.map(item => toCompletionItem(item, wordRange)),
				incomplete: list.isIncomplete
			};
		}
	}));

	disposables.push(languageFeatures.hoverProvider.register(HTML_LANGUAGES, {
		provideHover: (model, position) => {
			const document = toTextDocument(model);
			const htmlDocument = service.parseHTMLDocument(document);
			const hover = service.doHover(document, toLsPosition(position), htmlDocument);
			if (!hover) {
				return null;
			}
			const contents = toHoverContents(hover);
			if (!contents.length) {
				return null;
			}
			return { contents, range: hover.range ? toEditorRange(hover.range) : undefined };
		}
	}));

	disposables.push(languageFeatures.documentHighlightProvider.register(HTML_LANGUAGES, {
		provideDocumentHighlights: (model, position) => {
			const document = toTextDocument(model);
			const htmlDocument = service.parseHTMLDocument(document);
			const highlights = service.findDocumentHighlights(document, toLsPosition(position), htmlDocument);
			if (!highlights?.length) {
				return null;
			}
			return highlights.map(highlight => ({
				range: toEditorRange(highlight.range),
				kind: toHighlightKind(highlight.kind)
			}));
		}
	}));

	disposables.push(languageFeatures.documentSymbolProvider.register(HTML_LANGUAGES, {
		displayName: 'HTML',
		provideDocumentSymbols: model => {
			const document = toTextDocument(model);
			const htmlDocument = service.parseHTMLDocument(document);
			const symbols = service.findDocumentSymbols2(document, htmlDocument);
			return symbols?.length ? toDocumentSymbols(symbols) : [];
		}
	}));

	disposables.push(languageFeatures.documentFormattingEditProvider.register(HTML_LANGUAGES, {
		displayName: 'HTML',
		provideDocumentFormattingEdits: (model, options) => {
			const document = toTextDocument(model);
			const edits = service.format(document, undefined, {
				tabSize: options.tabSize,
				insertSpaces: options.insertSpaces
			});
			return edits.map(edit => ({ range: toEditorRange(edit.range), text: edit.newText }));
		}
	}));

	disposables.push(languageFeatures.foldingRangeProvider.register(HTML_LANGUAGES, {
		provideFoldingRanges: model => {
			const ranges = service.getFoldingRanges(toTextDocument(model));
			return ranges.map(range => ({ start: range.startLine + 1, end: range.endLine + 1 }));
		}
	}));

	disposables.push(languageFeatures.selectionRangeProvider.register(HTML_LANGUAGES, {
		provideSelectionRanges: (model, positions) => {
			const ranges = service.getSelectionRanges(toTextDocument(model), positions.map(toLsPosition));
			return ranges.map(selection => {
				const chain: { range: ReturnType<typeof toEditorRange> }[] = [];
				let current: any = selection;
				while (current) {
					chain.push({ range: toEditorRange(current.range) });
					current = current.parent;
				}
				return chain;
			});
		}
	}));

	disposables.push(languageFeatures.linkProvider.register(HTML_LANGUAGES, {
		provideLinks: model => {
			const document = toTextDocument(model);
			const links = service.findDocumentLinks(document, createDocumentContext(model));
			const converted = links
				.filter(link => !!link.target)
				.map(link => ({ range: toEditorRange(link.range), url: link.target!, tooltip: link.tooltip ?? link.target! }));
			return converted.length ? { links: converted } : undefined;
		}
	}));

	return disposables;
}
