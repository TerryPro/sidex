/*---------------------------------------------------------------------------------------------
 *  SideX: Outline view for the active editor (symbols from language providers).
 *--------------------------------------------------------------------------------------------*/

import './media/outline.css';

import { $, append } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import {
	Extensions as ViewExtensions,
	IViewContainersRegistry,
	IViewsRegistry,
	IViewDescriptorService,
	ViewContainerLocation
} from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import type { DocumentSymbol } from '../../../../editor/common/languages.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import type { IRange } from '../../../../editor/common/core/range.js';

const VIEW_ID = 'workbench.view.outline';

interface OutlineEntry {
	readonly name: string;
	readonly detail: string;
	readonly kind: number;
	readonly range: IRange;
	depth: number;
}

/** Maps SymbolKind to the same codicons VS Code's outline uses. */
function iconForKind(kind: number): string {
	switch (kind) {
		case 0: return 'codicon-symbol-file';
		case 1: return 'codicon-symbol-module';
		case 2: return 'codicon-symbol-namespace';
		case 3: return 'codicon-symbol-package';
		case 4: return 'codicon-symbol-class';
		case 5: return 'codicon-symbol-method';
		case 6: return 'codicon-symbol-property';
		case 7: return 'codicon-symbol-field';
		case 8: return 'codicon-symbol-constructor';
		case 9: return 'codicon-symbol-enum';
		case 10: return 'codicon-symbol-interface';
		case 11: return 'codicon-symbol-function';
		case 12: return 'codicon-symbol-variable';
		case 13: return 'codicon-symbol-constant';
		case 14: return 'codicon-symbol-string';
		case 15: return 'codicon-symbol-number';
		case 16: return 'codicon-symbol-boolean';
		case 17: return 'codicon-symbol-array';
		case 18: return 'codicon-symbol-object';
		case 19: return 'codicon-symbol-key';
		case 20: return 'codicon-symbol-null';
		case 21: return 'codicon-symbol-enum-member';
		case 22: return 'codicon-symbol-structure';
		case 23: return 'codicon-symbol-event';
		case 24: return 'codicon-symbol-operator';
		case 25: return 'codicon-symbol-type-parameter';
		default: return 'codicon-symbol-misc';
	}
}

/** VS Code sorts the outline by position, while some providers (tsserver) sort by name. */
function sortByPosition(symbols: DocumentSymbol[]): void {
	symbols.sort((a, b) =>
		(a.range.startLineNumber - b.range.startLineNumber)
		|| (a.range.startColumn - b.range.startColumn)
		|| a.name.localeCompare(b.name)
	);
	for (const symbol of symbols) {
		if (symbol.children && symbol.children.length > 0) {
			sortByPosition(symbol.children);
		}
	}
}

function flatten(symbol: DocumentSymbol, depth: number, out: OutlineEntry[]): void {
	if (!symbol || typeof symbol.name !== 'string' || !symbol.range) {
		return;
	}
	out.push({
		name: symbol.name,
		detail: typeof symbol.detail === 'string' ? symbol.detail : '',
		kind: typeof symbol.kind === 'number' ? symbol.kind : 0,
		range: symbol.range as IRange,
		depth
	});
	for (const child of symbol.children ?? []) {
		flatten(child, depth + 1, out);
	}
}

class OutlineView extends ViewPane {
	static readonly ID = VIEW_ID;

	private list!: HTMLElement;
	private empty!: HTMLElement;
	private scrollableElement: DomScrollableElement | undefined;
	private readonly viewDisposables = this._register(new DisposableStore());
	private readonly modelListeners = this._register(new DisposableStore());
	private refreshCts: CancellationTokenSource | undefined;
	private emptyRetry: ReturnType<typeof setTimeout> | undefined;
	private emptyRetryIndex = 0;
	// The first requests usually land before the language extension has been
	// activated, so start fast and back off once the server is clearly busy.
	private static readonly EMPTY_RETRY_DELAYS = [400, 1000, 2500, 5000, 10000, 20000];

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@ILanguageFeaturesService private readonly languageFeatures: ILanguageFeaturesService
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		this.viewDisposables.add(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				void this.refresh();
			}
		}));
		this.viewDisposables.add(this.editorService.onDidActiveEditorChange(() => {
			this.emptyRetryIndex = 0;
			void this.refresh();
		}));
		this.viewDisposables.add(this.editorService.onDidVisibleEditorsChange(() => void this.refresh()));
		// Providers register after the workbench restores its editors; refresh again
		// once they show up so the outline is not left empty on startup.
		this.viewDisposables.add(this.languageFeatures.documentSymbolProvider.onDidChange(() => void this.refresh()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const root = append(container, $('.outline-view'));
		this.list = $('.outline-list');
		this.scrollableElement = new DomScrollableElement(this.list, {
			alwaysConsumeMouseWheel: true,
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			verticalScrollbarSize: 10,
			useShadows: false
		});
		this.viewDisposables.add(this.scrollableElement);
		const scrollableNode = this.scrollableElement.getDomNode();
		scrollableNode.classList.add('outline-scrollable');
		append(root, scrollableNode);

		this.empty = append(root, $('.outline-empty'));
		this.updateEmptyState('');
		void this.refresh();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.scrollableElement?.scanDomNode();
	}

	private updateEmptyState(text: string): void {
		this.empty.textContent = text;
		this.empty.style.display = text ? '' : 'none';
		const scrollableNode = this.scrollableElement?.getDomNode();
		if (scrollableNode) {
			scrollableNode.style.display = text ? 'none' : '';
		}
	}

	private get activeModel(): ITextModel | null {
		return this.codeEditorService.getActiveCodeEditor()?.getModel() ?? null;
	}

	private async refresh(): Promise<void> {
		if (!this.list) {
			return;
		}

		this.clearEmptyRetry();
		this.modelListeners.clear();
		const model = this.activeModel;
		if (model) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			this.modelListeners.add(model.onDidChangeContent(() => {
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				timer = setTimeout(() => void this.refresh(), 500);
			}));
			// Restored editors start with an unresolved language id, so symbols can only
			// be resolved once the model's language is known.
			this.modelListeners.add(model.onDidChangeLanguage(() => void this.refresh()));
			this.modelListeners.add({ dispose: () => { if (timer !== undefined) { clearTimeout(timer); } } });
		}

		this.list.replaceChildren();
		this.updateEmptyState('');

		if (!model) {
			this.updateEmptyState(localize('outline.noEditor', '没有活动的文本编辑器'));
			this.scrollableElement?.scanDomNode();
			return;
		}

		this.refreshCts?.cancel();
		const cts = new CancellationTokenSource();
		this.refreshCts = cts;

		const entries: OutlineEntry[] = [];
		for (const provider of this.languageFeatures.documentSymbolProvider.ordered(model)) {
			try {
				const result = await provider.provideDocumentSymbols(model, cts.token);
				if (cts.token.isCancellationRequested) {
					return;
				}
				if (!result) {
					continue;
				}
				const symbols = (Array.isArray(result) ? result : [result]) as DocumentSymbol[];
				sortByPosition(symbols);
				for (const symbol of symbols) {
					flatten(symbol, 0, entries);
				}
			} catch {
				// A broken provider should not blank the whole outline.
			}
			if (entries.length > 0) {
				break;
			}
		}

		if (entries.length === 0) {
			let message = localize('outline.noSymbols', '没有可显示的大纲符号');
			// Language servers can miss the first request while they are still
			// indexing the project, which used to leave the outline empty.
			if (this.emptyRetryIndex < OutlineView.EMPTY_RETRY_DELAYS.length) {
				message = localize('outline.loading', '正在加载大纲符号…');
				const delay = OutlineView.EMPTY_RETRY_DELAYS[this.emptyRetryIndex];
				this.emptyRetryIndex++;
				this.emptyRetry = setTimeout(() => void this.refresh(), delay);
			}
			this.updateEmptyState(message);
			this.scrollableElement?.scanDomNode();
			return;
		}

		const rows = document.createDocumentFragment();
		for (const entry of entries) {
			const row = $('.outline-row');
			row.style.paddingLeft = `${8 + entry.depth * 12}px`;
			row.title = entry.detail ? `${entry.name} — ${entry.detail}` : entry.name;

			const icon = $('span.codicon.codicon-colored');
			icon.classList.add(iconForKind(entry.kind));
			row.appendChild(icon);

			const label = $('span.outline-label');
			label.textContent = entry.name;
			row.appendChild(label);

			if (entry.detail) {
				const detail = $('span.outline-detail');
				detail.textContent = entry.detail;
				row.appendChild(detail);
			}

			row.addEventListener('click', () => {
				const editor = this.codeEditorService.getActiveCodeEditor();
				const target = editor?.getModel();
				if (!editor || !target) {
					return;
				}
				const { startLineNumber, startColumn } = entry.range;
				editor.setSelection(new Selection(startLineNumber, startColumn, startLineNumber, startColumn));
				editor.revealPositionInCenter({ lineNumber: startLineNumber, column: startColumn });
				editor.focus();
			});

			rows.appendChild(row);
		}
		this.list.appendChild(rows);
		this.updateEmptyState('');
		this.scrollableElement?.scanDomNode();
	}

	private clearEmptyRetry(): void {
		if (this.emptyRetry) {
			clearTimeout(this.emptyRetry);
			this.emptyRetry = undefined;
		}
	}

	override dispose(): void {
		this.clearEmptyRetry();
		this.refreshCts?.cancel();
		super.dispose();
	}
}

const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
const containersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);

const OUTLINE_CONTAINER_ID = 'sidex.outline';
const isSidex = !!(globalThis as any).__SIDEX_TAURI__;

const container = isSidex
	? (containersRegistry.get(OUTLINE_CONTAINER_ID) ?? containersRegistry.registerViewContainer(
		{
			id: OUTLINE_CONTAINER_ID,
			title: localize2('outline.container', '大纲'),
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OUTLINE_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
			storageId: 'sidex.outline.state',
			icon: Codicon.symbolClass,
			hideIfEmpty: false,
			order: 2
		},
		ViewContainerLocation.Sidebar,
		{ isDefault: false }
	))
	: (containersRegistry.get('workbench.view.explorer')
		?? containersRegistry.getViewContainers(ViewContainerLocation.Sidebar)[0]);

if (container) {
	viewsRegistry.registerViews([{
		id: VIEW_ID,
		name: localize2('outline.title', '大纲'),
		containerIcon: Codicon.symbolClass,
		ctorDescriptor: new SyncDescriptor(OutlineView),
		canToggleVisibility: !isSidex,
		canMoveView: true,
		// SideX 下大纲是独立面板；其余情况仍作为资源管理器的折叠分区。
		order: isSidex ? 0 : 99,
		collapsed: !isSidex
	}], container);
}
