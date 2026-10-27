/*---------------------------------------------------------------------------------------------
 *  SideX: Built-in CSS / SCSS / LESS language features.
 *
 *  Drives `vscode-css-languageservice` directly in the workbench, because the
 *  bundled Rust "css-language-extension" only proxied requests to a server
 *  script that is not shipped. See `languageServiceUtils.ts` for the rationale.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import type { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { getCSSLanguageService, getLESSLanguageService, getSCSSLanguageService } from 'vscode-css-languageservice';
import type { LanguageService } from 'vscode-css-languageservice';
import {
	createDocumentContext,
	LanguageServiceDiagnostics,
	toCompletionItem,
	toDocumentSymbols,
	toEditorRange,
	toHighlightKind,
	toHoverContents,
	toLsPosition,
	toMarkers,
	toTextDocument,
	wordRangeAtPosition
} from './languageServiceUtils.js';

export const CSS_LANGUAGES = ['css', 'scss', 'less'];

const OWNER = 'css-language-features';

export interface LanguageServiceDependencies {
	readonly languageFeatures: ILanguageFeaturesService;
	readonly modelService: IModelService;
	readonly markerService: IMarkerService;
	readonly logService: ILogService;
}

function serviceFor(languageId: string): LanguageService | undefined {
	// Each flavour keeps its own cache/validation settings, so they are created lazily once.
	if (languageId === 'css') {
		return cssService;
	}
	if (languageId === 'scss') {
		return scssService;
	}
	if (languageId === 'less') {
		return lessService;
	}
	return undefined;
}

let cssService: LanguageService | undefined;
let scssService: LanguageService | undefined;
let lessService: LanguageService | undefined;

function ensureServices(): void {
	cssService ??= getCSSLanguageService();
	scssService ??= getSCSSLanguageService();
	lessService ??= getLESSLanguageService();
}

export function registerCssLanguageFeatures(deps: LanguageServiceDependencies): IDisposable[] {
	ensureServices();
	const { languageFeatures, modelService, markerService, logService } = deps;
	const disposables: IDisposable[] = [];

	const context = (model: ITextModel) => {
		const service = serviceFor(model.getLanguageId());
		if (!service) {
			throw new Error(`unsupported language: ${model.getLanguageId()}`);
		}
		const document = toTextDocument(model);
		return { service, document, stylesheet: service.parseStylesheet(document) };
	};

	disposables.push(languageFeatures.completionProvider.register(CSS_LANGUAGES, {
		_debugDisplayName: 'builtinCssLanguageService',
		triggerCharacters: ['.', '#', ':', ' ', '!', '@', '-', '_', '/', '$', '*', '=', '>', '+', '~', '%', "'", '"'],
		provideCompletionItems: (model, position) => {
			const { service, document, stylesheet } = context(model);
			const list = service.doComplete(document, toLsPosition(position), stylesheet);
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

	disposables.push(languageFeatures.hoverProvider.register(CSS_LANGUAGES, {
		provideHover: (model, position) => {
			const { service, document, stylesheet } = context(model);
			const hover = service.doHover(document, toLsPosition(position), stylesheet, { documentation: true });
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

	disposables.push(languageFeatures.definitionProvider.register(CSS_LANGUAGES, {
		provideDefinition: (model, position) => {
			const { service, document, stylesheet } = context(model);
			const location = service.findDefinition(document, toLsPosition(position), stylesheet);
			if (!location) {
				return null;
			}
			return [{ uri: model.uri, range: toEditorRange(location.range) }];
		}
	}));

	disposables.push(languageFeatures.referenceProvider.register(CSS_LANGUAGES, {
		provideReferences: (model, position) => {
			const { service, document, stylesheet } = context(model);
			const locations = service.findReferences(document, toLsPosition(position), stylesheet);
			if (!locations?.length) {
				return null;
			}
			return locations.map(location => ({ uri: model.uri, range: toEditorRange(location.range) }));
		}
	}));

	disposables.push(languageFeatures.documentHighlightProvider.register(CSS_LANGUAGES, {
		provideDocumentHighlights: (model, position) => {
			const { service, document, stylesheet } = context(model);
			const highlights = service.findDocumentHighlights(document, toLsPosition(position), stylesheet);
			if (!highlights?.length) {
				return null;
			}
			return highlights.map(highlight => ({
				range: toEditorRange(highlight.range),
				kind: toHighlightKind(highlight.kind)
			}));
		}
	}));

	disposables.push(languageFeatures.documentSymbolProvider.register(CSS_LANGUAGES, {
		displayName: 'CSS/SCSS/LESS',
		provideDocumentSymbols: model => {
			const { service, document, stylesheet } = context(model);
			const symbols = service.findDocumentSymbols2(document, stylesheet);
			return symbols?.length ? toDocumentSymbols(symbols) : [];
		}
	}));

	disposables.push(languageFeatures.colorProvider.register(CSS_LANGUAGES, {
		provideDocumentColors: model => {
			const { service, document, stylesheet } = context(model);
			const colors = service.findDocumentColors(document, stylesheet);
			return colors.map(color => ({
				range: toEditorRange(color.range),
				color: color.color
			}));
		},
		provideColorPresentations: (model, colorInfo) => {
			const { service, document, stylesheet } = context(model);
			const range = {
				start: { line: colorInfo.range.startLineNumber - 1, character: colorInfo.range.startColumn - 1 },
				end: { line: colorInfo.range.endLineNumber - 1, character: colorInfo.range.endColumn - 1 }
			};
			const presentations = service.getColorPresentations(document, stylesheet, colorInfo.color, range);
			return presentations.map(presentation => ({
				label: presentation.label,
				textEdit: presentation.textEdit
					? { range: toEditorRange(presentation.textEdit.range), text: presentation.textEdit.newText }
					: undefined
			}));
		}
	}));

	disposables.push(languageFeatures.documentFormattingEditProvider.register(CSS_LANGUAGES, {
		displayName: 'CSS/SCSS/LESS',
		provideDocumentFormattingEdits: (model, options) => {
			const { service, document } = context(model);
			const edits = service.format(document, undefined, { tabSize: options.tabSize, insertSpaces: options.insertSpaces });
			return edits.map(edit => ({ range: toEditorRange(edit.range), text: edit.newText }));
		}
	}));

	disposables.push(languageFeatures.documentRangeFormattingEditProvider.register(CSS_LANGUAGES, {
		displayName: 'CSS/SCSS/LESS',
		provideDocumentRangeFormattingEdits: (model, range, options) => {
			const { service, document } = context(model);
			const lsRange = {
				start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
				end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
			};
			const edits = service.format(document, lsRange, { tabSize: options.tabSize, insertSpaces: options.insertSpaces });
			return edits.map(edit => ({ range: toEditorRange(edit.range), text: edit.newText }));
		}
	}));

	disposables.push(languageFeatures.foldingRangeProvider.register(CSS_LANGUAGES, {
		provideFoldingRanges: model => {
			const { service, document } = context(model);
			const ranges = service.getFoldingRanges(document);
			return ranges.map(range => ({ start: range.startLine + 1, end: range.endLine + 1 }));
		}
	}));

	disposables.push(languageFeatures.selectionRangeProvider.register(CSS_LANGUAGES, {
		provideSelectionRanges: (model, positions) => {
			const { service, document, stylesheet } = context(model);
			const ranges = service.getSelectionRanges(document, positions.map(toLsPosition), stylesheet);
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

	disposables.push(languageFeatures.linkProvider.register(CSS_LANGUAGES, {
		provideLinks: model => {
			const { service, document, stylesheet } = context(model);
			const links = service.findDocumentLinks(document, stylesheet, createDocumentContext(model));
			const converted = links
				.filter(link => !!link.target)
				.map(link => ({ range: toEditorRange(link.range), url: link.target!, tooltip: link.target! }));
			return converted.length ? { links: converted } : undefined;
		}
	}));

	disposables.push(new LanguageServiceDiagnostics(
		OWNER,
		model => CSS_LANGUAGES.includes(model.getLanguageId()),
		model => {
			const { service, document, stylesheet } = context(model);
			return toMarkers(service.doValidation(document, stylesheet), 'css');
		},
		modelService,
		markerService,
		logService
	));

	return disposables;
}
