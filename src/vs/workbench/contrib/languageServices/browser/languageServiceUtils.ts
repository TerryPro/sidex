/*---------------------------------------------------------------------------------------------
 *  SideX: Shared helpers for the built-in CSS / HTML / JSON language services.
 *
 *  VS Code ships these features as Node based extensions that call the
 *  `vscode-*-languageservice` libraries in-process. Because SideX runs with the
 *  Node extension host disabled, the same libraries are driven from this
 *  workbench contribution instead.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import {
	CompletionItemInsertTextRule,
	CompletionItemKind,
	DocumentHighlightKind,
	SymbolKind
} from '../../../../editor/common/languages.js';
import type { CompletionItem, TextEdit } from '../../../../editor/common/languages.js';
import type { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import type { IMarkerData } from '../../../../platform/markers/common/markers.js';
import { TextDocument } from 'vscode-languageserver-textdocument';

/** Minimal structural shapes of the `vscode-languageserver-types` values we consume. */
export interface LsPosition {
	readonly line: number;
	readonly character: number;
}

export interface LsRange {
	readonly start: LsPosition;
	readonly end: LsPosition;
}

export function toTextDocument(model: ITextModel): TextDocument {
	return TextDocument.create(
		model.uri.toString(),
		model.getLanguageId(),
		model.getVersionId(),
		model.getValue()
	);
}

export function toLsPosition(position: Position): LsPosition {
	return { line: position.lineNumber - 1, character: position.column - 1 };
}

export function toEditorPosition(position: LsPosition): Position {
	return new Position(position.line + 1, position.character + 1);
}

export function toEditorRange(range: LsRange): Range {
	return new Range(
		range.start.line + 1,
		range.start.character + 1,
		range.end.line + 1,
		range.end.character + 1
	);
}

/** LSP completion kinds are 1-based, the editor's are 0-based and ordered differently. */
const completionKindMap = new Map<number, CompletionItemKind>([
	[1, CompletionItemKind.Text],
	[2, CompletionItemKind.Method],
	[3, CompletionItemKind.Function],
	[4, CompletionItemKind.Constructor],
	[5, CompletionItemKind.Field],
	[6, CompletionItemKind.Variable],
	[7, CompletionItemKind.Class],
	[8, CompletionItemKind.Interface],
	[9, CompletionItemKind.Module],
	[10, CompletionItemKind.Property],
	[11, CompletionItemKind.Unit],
	[12, CompletionItemKind.Value],
	[13, CompletionItemKind.Enum],
	[14, CompletionItemKind.Keyword],
	[15, CompletionItemKind.Snippet],
	[16, CompletionItemKind.Color],
	[17, CompletionItemKind.File],
	[18, CompletionItemKind.Reference],
	[19, CompletionItemKind.Folder],
	[20, CompletionItemKind.EnumMember],
	[21, CompletionItemKind.Constant],
	[22, CompletionItemKind.Struct],
	[23, CompletionItemKind.Event],
	[24, CompletionItemKind.Operator],
	[25, CompletionItemKind.TypeParameter]
]);

export function toCompletionKind(kind: number | undefined): CompletionItemKind {
	return (kind && completionKindMap.get(kind)) ?? CompletionItemKind.Text;
}

/** LSP symbol kinds happen to be the editor kinds shifted by one. */
export function toSymbolKind(kind: number | undefined): SymbolKind {
	const mapped = (kind ?? 1) - 1;
	return mapped >= SymbolKind.File && mapped <= SymbolKind.TypeParameter ? mapped : SymbolKind.Variable;
}

export function toHighlightKind(kind: number | undefined): DocumentHighlightKind {
	// 1 = Text, 2 = Read, 3 = Write
	return kind === 2 ? DocumentHighlightKind.Read : kind === 3 ? DocumentHighlightKind.Write : DocumentHighlightKind.Text;
}

function toMarkdown(value: string): IMarkdownString {
	return { value, isTrusted: false, supportThemeIcons: true };
}

function toDocumentation(documentation: unknown): string | IMarkdownString | undefined {
	if (!documentation) {
		return undefined;
	}
	if (typeof documentation === 'string') {
		return toMarkdown(documentation);
	}
	if (Array.isArray(documentation)) {
		const joined = documentation
			.map(part => (typeof part === 'string' ? part : part?.value))
			.filter((part): part is string => typeof part === 'string')
			.join('\n\n');
		return joined ? toMarkdown(joined) : undefined;
	}
	if (typeof documentation === 'object' && typeof (documentation as { value?: unknown }).value === 'string') {
		const content = documentation as { value: string; kind?: string };
		return toMarkdown(content.kind === 'markdown' ? content.value : `\`\`\`\n${content.value}\n\`\`\``);
	}
	return undefined;
}

function toAdditionalEdits(edits: readonly any[] | undefined): TextEdit[] | undefined {
	if (!edits?.length) {
		return undefined;
	}
	const converted = edits.map(edit => ({ range: toEditorRange(edit.range), text: edit.newText }));
	return converted.length > 0 ? converted : undefined;
}

function toCommand(command: any): { id: string; title: string; arguments?: unknown[] } | undefined {
	if (!command || typeof command.command !== 'string') {
		return undefined;
	}
	return { id: command.command, title: command.title, arguments: command.arguments };
}

/**
 * Converts an LSP completion item into an editor completion item. `wordRange` is
 * the fallback replace range for items that do not carry a text edit.
 */
export function toCompletionItem(item: any, wordRange: Range): CompletionItem {
	const textEdit = item.textEdit;
	const range = textEdit
		? toEditorRange(textEdit.range ?? textEdit.replace ?? textEdit.insert)
		: wordRange;
	const label = typeof item.label === 'string' ? item.label : item.label?.label ?? '';
	const insertText: string =
		textEdit?.newText ?? item.insertText ?? (typeof item.label === 'string' ? item.label : label);

	const converted: CompletionItem = {
		label,
		kind: toCompletionKind(item.kind),
		detail: item.detail,
		documentation: toDocumentation(item.documentation),
		sortText: item.sortText,
		filterText: item.filterText,
		preselect: item.preselect,
		insertText,
		range,
		commitCharacters: item.commitCharacters,
		additionalTextEdits: toAdditionalEdits(item.additionalTextEdits),
		command: toCommand(item.command)
	};

	if (item.insertTextFormat === 2) {
		converted.insertTextRules = CompletionItemInsertTextRule.InsertAsSnippet;
	}
	if (Array.isArray(item.tags) && item.tags.includes(1)) {
		converted.tags = [1];
	}

	return converted;
}

/** Converts LSP hover contents into the editor's markdown shape. */
export function toHoverContents(hover: any): IMarkdownString[] {
	const contents = hover?.contents;
	if (!contents) {
		return [];
	}
	const parts = Array.isArray(contents) ? contents : [contents];
	const out: IMarkdownString[] = [];
	for (const part of parts) {
		if (typeof part === 'string') {
			out.push(toMarkdown(part));
		} else if (typeof part?.value === 'string') {
			out.push(toMarkdown(part.kind === 'markdown' ? part.value : `\`\`\`\n${part.value}\n\`\`\``));
		} else if (typeof part?.language === 'string' && typeof part?.value === 'string') {
			out.push(toMarkdown(`\`\`\`${part.language}\n${part.value}\n\`\`\``));
		}
	}
	return out;
}

export function toDocumentSymbols(symbols: readonly any[]): any[] {
	return symbols.map(symbol => ({
		name: symbol.name,
		detail: symbol.detail ?? '',
		kind: toSymbolKind(symbol.kind),
		tags: [],
		range: toEditorRange(symbol.range),
		selectionRange: toEditorRange(symbol.selectionRange ?? symbol.range),
		children: symbol.children?.length ? toDocumentSymbols(symbol.children) : undefined
	}));
}

export function toMarkers(diagnostics: readonly any[], source: string): IMarkerData[] {
	return diagnostics.map(diagnostic => ({
		severity:
			diagnostic.severity === 1 ? MarkerSeverity.Error
				: diagnostic.severity === 2 ? MarkerSeverity.Warning
					: diagnostic.severity === 3 ? MarkerSeverity.Info
						: MarkerSeverity.Hint,
		message: diagnostic.message ?? '',
		source,
		code: typeof diagnostic.code === 'object' && diagnostic.code !== null
			? String(diagnostic.code.value ?? '')
			: diagnostic.code !== undefined ? String(diagnostic.code) : undefined,
		startLineNumber: (diagnostic.range?.start?.line ?? 0) + 1,
		startColumn: (diagnostic.range?.start?.character ?? 0) + 1,
		endLineNumber: (diagnostic.range?.end?.line ?? 0) + 1,
		endColumn: (diagnostic.range?.end?.character ?? 0) + 1
	}));
}

export function wordRangeAtPosition(model: ITextModel, position: Position): Range {
	const word = model.getWordUntilPosition(position);
	return new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
}

/** Resolves `url()` / `href` references relative to the document they appear in. */
export function createDocumentContext(model: ITextModel): { resolveReference(ref: string, baseUrl: string): string | undefined } {
	return {
		resolveReference(ref: string, baseUrl: string): string | undefined {
			try {
				const base = baseUrl || model.uri.toString();
				return URI.parse(base).with({ query: null, fragment: null }).toString();
			} catch {
				return ref;
			}
		}
	};
}

/**
 * Pushes language-service diagnostics into the Problems panel.
 *
 * The services are pull based, so this schedules a debounced re-validation
 * whenever a matching model is created, edited, or changes language.
 */
export class LanguageServiceDiagnostics extends Disposable {

	private readonly _listeners = new Map<string, IDisposable>();
	private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly _models = new Map<string, ITextModel>();

	constructor(
		private readonly _owner: string,
		private readonly _appliesTo: (model: ITextModel) => boolean,
		private readonly _compute: (model: ITextModel) => IMarkerData[] | Promise<IMarkerData[]>,
		private readonly _modelService: IModelService,
		private readonly _markerService: IMarkerService,
		private readonly _logService: ILogService
	) {
		super();

		this._register(this._modelService.onModelAdded(model => this._attach(model)));
		this._register(this._modelService.onModelLanguageChanged(event => {
			this._detach(event.model);
			this._attach(event.model);
		}));
		this._register(this._modelService.onModelRemoved(model => this._detach(model)));

		for (const model of this._modelService.getModels()) {
			this._attach(model);
		}
	}

	override dispose(): void {
		for (const timer of this._timers.values()) {
			clearTimeout(timer);
		}
		this._timers.clear();
		super.dispose();
	}

	private _attach(model: ITextModel): void {
		const key = model.uri.toString();
		if (this._listeners.has(key) || !this._appliesTo(model)) {
			return;
		}
		this._models.set(key, model);
		this._listeners.set(key, model.onDidChangeContent(() => this._schedule(model)));
		this._schedule(model);
	}

	private _detach(model: ITextModel): void {
		const key = model.uri.toString();
		this._models.delete(key);
		this._listeners.get(key)?.dispose();
		this._listeners.delete(key);
		this._clearTimer(key);
		this._markerService.remove(this._owner, [model.uri]);
	}

	/** Re-validates every tracked model, e.g. after new schemas became available. */
	refreshAll(): void {
		for (const model of this._models.values()) {
			this._schedule(model);
		}
	}

	private _schedule(model: ITextModel): void {
		const key = model.uri.toString();
		this._clearTimer(key);
		this._timers.set(key, setTimeout(() => {
			this._timers.delete(key);
			this._run(model);
		}, 300));
	}

	private _run(model: ITextModel): void {
		try {
			const result = this._compute(model);
			if (result instanceof Promise) {
				result.then(
					markers => this._markerService.changeOne(this._owner, model.uri, markers),
					error => this._logService.warn(`[${this._owner}] validation failed: ${(error as Error)?.message ?? String(error)}`)
				);
			} else {
				this._markerService.changeOne(this._owner, model.uri, result);
			}
		} catch (error) {
			this._logService.warn(`[${this._owner}] validation failed: ${(error as Error)?.message ?? String(error)}`);
		}
	}

	private _clearTimer(key: string): void {
		const timer = this._timers.get(key);
		if (timer !== undefined) {
			clearTimeout(timer);
			this._timers.delete(key);
		}
	}
}
