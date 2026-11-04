/*---------------------------------------------------------------------------------------------
 *  SideX — native outline and folding providers.
 *
 *  SideX intentionally runs without language servers. These providers use the
 *  Rust syntax layer to keep document symbols and folding ranges available for
 *  common languages while TextMate grammars handle keyword colouring.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import {
	DocumentSymbol,
	FoldingRange,
	FoldingRangeKind,
	SymbolKind
} from '../../../../editor/common/languages.js';
import { Range } from '../../../../editor/common/core/range.js';
import type { IRange } from '../../../../editor/common/core/range.js';
import {
	ISideXSyntaxBrowserService,
	SideXLineRange,
	SideXOutlineSymbol
} from '../../../../platform/sidex/browser/sidexSyntaxService.js';
import {
	IWorkbenchContribution,
	WorkbenchPhase,
	registerWorkbenchContribution2
} from '../../../common/contributions.js';

function toRange(range: SideXLineRange): IRange {
	return new Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
}

function toDocumentSymbol(symbol: SideXOutlineSymbol): DocumentSymbol {
	return {
		name: symbol.name,
		detail: symbol.detail,
		kind: symbol.kind as SymbolKind,
		tags: [],
		range: toRange(symbol.range),
		selectionRange: toRange(symbol.selectionRange),
		children: symbol.children.map(toDocumentSymbol)
	};
}

class SidexLanguageFeaturesContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sidexLanguageFeatures';

	constructor(
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		@ISideXSyntaxBrowserService syntaxService: ISideXSyntaxBrowserService
	) {
		super();

		const selector = [{ scheme: 'file' }];

		this._register(languageFeatures.documentSymbolProvider.register(selector, {
			displayName: 'SideX Syntax',
			provideDocumentSymbols: async (model, token) => {
				if (token.isCancellationRequested) {
					return [];
				}
				const symbols = await syntaxService.getDocumentSymbols(model.getLanguageId(), model.getValue());
				if (token.isCancellationRequested) {
					return [];
				}
				return symbols.map(toDocumentSymbol);
			}
		}));

		this._register(languageFeatures.foldingRangeProvider.register(selector, {
			provideFoldingRanges: async (model, _context, token) => {
				if (token.isCancellationRequested) {
					return [];
				}
				const ranges = await syntaxService.getFoldingRanges(model.getLanguageId(), model.getValue());
				if (token.isCancellationRequested) {
					return [];
				}
				// Returning undefined lets Monaco fall back to indentation-based folding
				// for languages without native brace/Markdown ranges (Python, YAML, ...).
				if (ranges.length === 0) {
					return undefined;
				}
				return ranges.map<FoldingRange>(range => ({
					start: range.start,
					end: range.end,
					kind: range.kind ? FoldingRangeKind.fromValue(range.kind) : undefined
				}));
			}
		}));
	}
}

registerWorkbenchContribution2(
	SidexLanguageFeaturesContribution.ID,
	SidexLanguageFeaturesContribution,
	WorkbenchPhase.AfterRestored
);
