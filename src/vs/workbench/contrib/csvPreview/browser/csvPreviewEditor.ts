/*---------------------------------------------------------------------------------------------
 *  SideX: 内置 CSV 表格编辑器（原生实现，替代原 WASM csv-editor 扩展）
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { $, addDisposableListener, Dimension, EventType } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CsvPreviewEditorInput } from './csvPreviewEditorInput.js';
import './media/csvPreview.css';

const MAX_ROWS = 5000;
const MAX_COLUMNS = 100;
const SAVE_DELAY = 400;

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (inQuotes) {
			if (character === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index++;
				} else {
					inQuotes = false;
				}
			} else {
				field += character;
			}
			continue;
		}
		if (character === '"') {
			inQuotes = true;
		} else if (character === ',') {
			row.push(field);
			field = '';
		} else if (character === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (character !== '\r') {
			field += character;
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const width = rows.reduce((max, current) => Math.max(max, current.length), 0);
	for (const line of rows) {
		while (line.length < width) {
			line.push('');
		}
	}
	return rows;
}

function stringifyCsv(rows: string[][]): string {
	return rows
		.map(row => row
			.map(cell => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
			.join(','))
		.join('\n');
}

export class CsvPreviewEditor extends EditorPane {

	static readonly ID = 'workbench.editor.csvPreview';

	private container!: HTMLElement;
	private scrollContainer!: HTMLElement;
	private tableHost!: HTMLElement;
	private nameLabel!: HTMLElement;
	private metaLabel!: HTMLElement;
	private statusLabel!: HTMLElement;

	private currentInput: CsvPreviewEditorInput | undefined;
	private rows: string[][] = [];
	private saveTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(CsvPreviewEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = $('.csv-preview-editor');
		this.container.tabIndex = 0;

		const toolbar = $('.csv-preview-toolbar');
		this.nameLabel = $('span.csv-preview-name');
		this.metaLabel = $('span.csv-preview-meta');
		this.statusLabel = $('span.csv-preview-status');
		const spacer = $('span.csv-preview-spacer');

		const textButton = $('button.csv-preview-button');
		textButton.title = localize('csv.openAsText', '用文本编辑器打开');
		const icon = $('span.codicon');
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.fileText));
		textButton.appendChild(icon);
		const label = $('span');
		label.textContent = localize('csv.openAsTextLabel', '文本');
		textButton.appendChild(label);
		this._register(addDisposableListener(textButton, EventType.CLICK, () => this.openAsText()));

		toolbar.appendChild(this.nameLabel);
		toolbar.appendChild(this.metaLabel);
		toolbar.appendChild(spacer);
		toolbar.appendChild(this.statusLabel);
		toolbar.appendChild(textButton);

		this.scrollContainer = $('.csv-preview-scroll');
		this.tableHost = $('.csv-preview-table-host');
		this.scrollContainer.appendChild(this.tableHost);

		this.container.appendChild(toolbar);
		this.container.appendChild(this.scrollContainer);
		parent.appendChild(this.container);
	}

	override async setInput(input: CsvPreviewEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.currentInput = input;
		this.nameLabel.textContent = input.getName();
		await this.reload();
	}

	private async reload(): Promise<void> {
		const input = this.currentInput;
		if (!input) {
			return;
		}
		try {
			const content = await this.fileService.readFile(input.resource);
			this.rows = parseCsv(content.value.toString());
			this.renderTable();
		} catch (error) {
			this.setStatus(localize('csv.readFailed', '读取失败'));
			this.notificationService.error(String(error));
		}
	}

	private renderTable(): void {
		this.tableHost.replaceChildren();
		const rows = this.rows;
		const rowCount = rows.length;
		const columnCount = rowCount > 0 ? rows[0].length : 0;
		const tooLarge = rowCount > MAX_ROWS || columnCount > MAX_COLUMNS;
		const visibleRows = tooLarge ? rows.slice(0, MAX_ROWS) : rows;

		this.metaLabel.textContent = localize('csv.size', '{0} 行 × {1} 列', rowCount, columnCount);

		if (rowCount === 0) {
			const empty = $('.csv-preview-empty');
			empty.textContent = localize('csv.empty', '这个 CSV 文件没有内容');
			this.tableHost.appendChild(empty);
			return;
		}

		if (tooLarge) {
			this.setStatus(localize('csv.tooLarge', '文件过大，仅显示前 {0} 行且不可编辑', MAX_ROWS));
		}

		const table = $('table.csv-preview-table');
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		rows[0].forEach((cell, column) => {
			const th = document.createElement('th');
			th.textContent = cell;
			th.contentEditable = tooLarge ? 'false' : 'true';
			th.spellcheck = false;
			this.wireCell(th, 0, column);
			headerRow.appendChild(th);
		});
		thead.appendChild(headerRow);
		table.appendChild(thead);

		const tbody = document.createElement('tbody');
		for (let rowIndex = 1; rowIndex < visibleRows.length; rowIndex++) {
			const tr = document.createElement('tr');
			visibleRows[rowIndex].forEach((cell, column) => {
				const td = document.createElement('td');
				td.textContent = cell;
				td.contentEditable = tooLarge ? 'false' : 'true';
				td.spellcheck = false;
				this.wireCell(td, rowIndex, column);
				tr.appendChild(td);
			});
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		this.tableHost.appendChild(table);
	}

	private wireCell(cell: HTMLElement, row: number, column: number): void {
		this._register(addDisposableListener(cell, EventType.BLUR, () => {
			const value = cell.textContent ?? '';
			if (this.rows[row]?.[column] === value) {
				return;
			}
			if (!this.rows[row]) {
				this.rows[row] = [];
			}
			this.rows[row][column] = value;
			this.scheduleSave();
		}));
		this._register(addDisposableListener(cell, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				cell.blur();
			}
		}));
	}

	private scheduleSave(): void {
		if (this.saveTimer !== undefined) {
			clearTimeout(this.saveTimer);
		}
		this.setStatus(localize('csv.saving', '保存中…'));
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			void this.save();
		}, SAVE_DELAY);
	}

	private async save(): Promise<void> {
		const input = this.currentInput;
		if (!input) {
			return;
		}
		try {
			const text = stringifyCsv(this.rows);
			await this.fileService.writeFile(input.resource, VSBuffer.fromString(text));
			this.setStatus(localize('csv.saved', '已保存'));
		} catch (error) {
			this.setStatus(localize('csv.saveFailed', '保存失败'));
			this.notificationService.error(String(error));
		}
	}

	private setStatus(text: string): void {
		if (this.statusLabel) {
			this.statusLabel.textContent = text;
		}
	}

	private openAsText(): void {
		const input = this.currentInput;
		if (!input) {
			return;
		}
		void this.editorService.openEditor({
			resource: input.resource,
			options: { pinned: true }
		}, this.group);
	}

	layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}

	override focus(): void {
		super.focus();
		this.container?.focus();
	}

	override clearInput(): void {
		if (this.saveTimer !== undefined) {
			clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		this.tableHost?.replaceChildren();
		this.currentInput = undefined;
		this.rows = [];
		this.setStatus('');
		super.clearInput();
	}
}
