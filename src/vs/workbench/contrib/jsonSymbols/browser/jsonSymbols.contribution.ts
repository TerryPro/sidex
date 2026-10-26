/*---------------------------------------------------------------------------------------------
 *  SideX: JSON / JSONC document symbols for the Outline view.
 *
 *  VS Code gets these from the Node based `json-language-features` extension. This
 *  contribution parses the document with the built-in JSONC parser instead, so the
 *  feature keeps working with the Node extension host disabled.
 *
 *  Like VS Code, every node is typed: objects use `{}`, arrays `[]`, strings `abc`,
 *  numbers `123`, booleans and null get their own icon, and scalar values are shown
 *  as the symbol detail.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Node as JsonNode, parseTree } from '../../../../base/common/json.js';
import { Range } from '../../../../editor/common/core/range.js';
import { DocumentSymbol, SymbolKind } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';

class JsonDocumentSymbols implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.jsonDocumentSymbols';

	private readonly _store = new DisposableStore();

	constructor(@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService) {
		const provider = {
			displayName: 'JSON Outline',
			provideDocumentSymbols: (model: ITextModel, token: CancellationToken) => this._provide(model, token)
		};

		this._store.add(languageFeatures.documentSymbolProvider.register({ language: 'json' }, provider));
		this._store.add(languageFeatures.documentSymbolProvider.register({ language: 'jsonc' }, provider));
	}

	private _provide(model: ITextModel, token: CancellationToken): DocumentSymbol[] {
		if (token.isCancellationRequested) {
			return [];
		}

		const root = parseTree(model.getValue());
		if (!root || root.type !== 'object') {
			return [];
		}

		return this._properties(root, model);
	}

	private _properties(node: JsonNode, model: ITextModel): DocumentSymbol[] {
		const symbols: DocumentSymbol[] = [];

		for (const property of node.children ?? []) {
			if (property.type !== 'property' || !property.children || property.children.length < 2) {
				continue;
			}

			const keyNode = property.children[0];
			const valueNode = property.children[1];
			const name = `${keyNode.value ?? ''}`;
			if (!name) {
				continue;
			}

			symbols.push({
				name,
				detail: this._detail(valueNode, model),
				kind: this._kind(valueNode),
				tags: [],
				range: this._range(property, model),
				selectionRange: this._range(keyNode, model),
				children: valueNode.type === 'object' ? this._properties(valueNode, model) : undefined
			});
		}

		return symbols;
	}

	private _kind(node: JsonNode): SymbolKind {
		switch (node.type) {
			case 'object': return SymbolKind.Object;
			case 'array': return SymbolKind.Array;
			case 'number': return SymbolKind.Number;
			case 'boolean': return SymbolKind.Boolean;
			case 'null': return SymbolKind.Null;
			default: return SymbolKind.String;
		}
	}

	/** Scalars show their value next to the key, the way VS Code does. */
	private _detail(node: JsonNode, model: ITextModel): string {
		if (node.type === 'object' || node.type === 'array') {
			return '';
		}
		if (node.type === 'null') {
			return 'null';
		}
		const text = model.getValueInRange(this._range(node, model));
		return node.type === 'string' ? text.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1') : text;
	}

	private _range(node: JsonNode, model: ITextModel): Range {
		return Range.fromPositions(
			model.getPositionAt(node.offset),
			model.getPositionAt(node.offset + node.length)
		);
	}
}

registerWorkbenchContribution2(JsonDocumentSymbols.ID, JsonDocumentSymbols, WorkbenchPhase.AfterRestored);
