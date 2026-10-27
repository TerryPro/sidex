/*---------------------------------------------------------------------------------------------
 *  SideX: Built-in JSON / JSONC language features.
 *
 *  Drives `vscode-json-languageservice` in the workbench. Schema based
 *  completion and validation use the schemas bundled in `jsonSchemas.ts`:
 *  `package.json` is always available, `tsconfig.json` is loaded on demand.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import type { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { getLanguageService } from 'vscode-json-languageservice';
import type { DocumentLanguageSettings, LanguageService, SchemaConfiguration } from 'vscode-json-languageservice';
import { builtinSchemaConfigurations, loadTsconfigSchemaConfiguration } from './jsonSchemas.js';
import {
	LanguageServiceDiagnostics,
	toCompletionItem,
	toDocumentSymbols,
	toEditorRange,
	toHoverContents,
	toLsPosition,
	toMarkers,
	toTextDocument,
	wordRangeAtPosition
} from './languageServiceUtils.js';

export const JSON_LANGUAGES = ['json', 'jsonc'];

const OWNER = 'json-language-features';

export interface JsonLanguageServiceDependencies {
	readonly languageFeatures: ILanguageFeaturesService;
	readonly modelService: IModelService;
	readonly markerService: IMarkerService;
	readonly logService: ILogService;
}

let jsonService: LanguageService | undefined;

function documentSettings(model: { getLanguageId(): string }): DocumentLanguageSettings {
	const jsonc = model.getLanguageId() === 'jsonc';
	return {
		comments: jsonc ? 'ignore' : 'error',
		trailingCommas: jsonc ? 'ignore' : 'error',
		schemaValidation: 'warning',
		schemaRequest: 'warning'
	};
}

export function registerJsonLanguageFeatures(deps: JsonLanguageServiceDependencies): IDisposable[] {
	jsonService ??= getLanguageService({
		clientCapabilities: {
			textDocument: {
				completion: { completionItem: { documentationFormat: ['markdown', 'plaintext'] } },
				hover: { contentFormat: ['markdown', 'plaintext'] }
			}
		}
	});
	const service = jsonService;
	const { languageFeatures, modelService, markerService, logService } = deps;
	const disposables: IDisposable[] = [];

	const schemaConfigurations: SchemaConfiguration[] = [...builtinSchemaConfigurations];
	const configureService = () => service.configure({
		validate: true,
		allowComments: true,
		schemas: schemaConfigurations
	});
	configureService();

	const diagnostics = new LanguageServiceDiagnostics(
		OWNER,
		model => JSON_LANGUAGES.includes(model.getLanguageId()),
		async model => {
			const document = toTextDocument(model);
			const jsonDocument = service.parseJSONDocument(document);
			const result = await service.doValidation(document, jsonDocument, documentSettings(model));
			return toMarkers(result ?? [], 'json');
		},
		modelService,
		markerService,
		logService
	);
	disposables.push(diagnostics);

	// The tsconfig schema is ~400 kB, so it is fetched on demand and applied to
	// every open document once it arrives.
	let tsconfigSchemaRequested = false;
	const requestTsconfigSchema = (model: ITextModel) => {
		if (tsconfigSchemaRequested) {
			return;
		}
		const fileName = model.uri.path.split('/').pop() ?? '';
		if (!/^tsconfig(\.[\w-]+)?\.json$/.test(fileName)) {
			return;
		}
		tsconfigSchemaRequested = true;
		loadTsconfigSchemaConfiguration().then(configuration => {
			schemaConfigurations.push(configuration);
			configureService();
			diagnostics.refreshAll();
		}, (error: Error) => {
			logService.warn(`[${OWNER}] failed to load tsconfig schema: ${error?.message ?? String(error)}`);
		});
	};
	disposables.push(modelService.onModelAdded(requestTsconfigSchema));
	for (const model of modelService.getModels()) {
		requestTsconfigSchema(model);
	}

	disposables.push(languageFeatures.completionProvider.register(JSON_LANGUAGES, {
		_debugDisplayName: 'builtinJsonLanguageService',
		triggerCharacters: ['"', ':', ',', '{', '[', ' '],
		provideCompletionItems: async (model, position) => {
			const document = toTextDocument(model);
			const jsonDocument = service.parseJSONDocument(document);
			const list = await service.doComplete(document, toLsPosition(position), jsonDocument);
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

	disposables.push(languageFeatures.hoverProvider.register(JSON_LANGUAGES, {
		provideHover: async (model, position) => {
			const document = toTextDocument(model);
			const jsonDocument = service.parseJSONDocument(document);
			const hover = await service.doHover(document, toLsPosition(position), jsonDocument);
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

	disposables.push(languageFeatures.documentSymbolProvider.register(JSON_LANGUAGES, {
		displayName: 'JSON',
		provideDocumentSymbols: model => {
			const document = toTextDocument(model);
			const jsonDocument = service.parseJSONDocument(document);
			const symbols = service.findDocumentSymbols2(document, jsonDocument);
			return symbols?.length ? toDocumentSymbols(symbols) : [];
		}
	}));

	disposables.push(languageFeatures.documentFormattingEditProvider.register(JSON_LANGUAGES, {
		displayName: 'JSON',
		provideDocumentFormattingEdits: (model, options) => {
			const document = toTextDocument(model);
			const lastLine = model.getLineCount();
			const fullRange = {
				start: { line: 0, character: 0 },
				end: { line: lastLine - 1, character: model.getLineMaxColumn(lastLine) - 1 }
			};
			const edits = service.format(document, fullRange, {
				tabSize: options.tabSize,
				insertSpaces: options.insertSpaces
			});
			return edits.map(edit => ({ range: toEditorRange(edit.range), text: edit.newText }));
		}
	}));

	disposables.push(languageFeatures.selectionRangeProvider.register(JSON_LANGUAGES, {
		provideSelectionRanges: (model, positions) => {
			const document = toTextDocument(model);
			const jsonDocument = service.parseJSONDocument(document);
			const ranges = service.getSelectionRanges(document, positions.map(toLsPosition), jsonDocument);
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
	return disposables;
}
