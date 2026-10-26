/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { invoke } from '@tauri-apps/api/core';
import { Range } from '../../../../editor/common/core/range.js';
import {
	IModelDecorationOptions,
	ITextModel,
	OverviewRulerLane,
	TrackedRangeStickiness
} from '../../../../editor/common/model.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';

interface IWasmPosition {
	line: number;
	character: number;
}

interface IWasmRange {
	start: IWasmPosition;
	end: IWasmPosition;
}

interface IWasmDecorationAttachment {
	contentText?: string;
	color?: string;
	backgroundColor?: string;
	margin?: string;
	width?: string;
	height?: string;
}

interface IWasmDecorationRenderOptions {
	backgroundColor?: string;
	outlineColor?: string;
	outlineStyle?: string;
	outlineWidth?: string;
	borderColor?: string;
	borderRadius?: string;
	borderSpacing?: string;
	borderStyle?: string;
	borderWidth?: string;
	fontStyle?: string;
	fontWeight?: string;
	textDecoration?: string;
	cursor?: string;
	color?: string;
	letterSpacing?: string;
	gutterIconPath?: string;
	gutterIconSize?: string;
	overviewRulerColor?: string;
	before?: IWasmDecorationAttachment;
	after?: IWasmDecorationAttachment;
}

interface IWasmDecorationInstance {
	range: IWasmRange;
	hoverMessage?: string;
	renderOptions?: IWasmDecorationRenderOptions;
}

interface IWasmDecorationGroup {
	extensionId: string;
	typeId: number;
	options?: IWasmDecorationRenderOptions;
	instances: IWasmDecorationInstance[];
}

/** decoration ids per `${model uri}|${extensionId}:${typeId}` */
const appliedDecorationIds = new Map<string, string[]>();

function groupKey(uri: string, group: IWasmDecorationGroup): string {
	return `${uri}|${group.extensionId}:${group.typeId}`;
}

function toRange(range: IWasmRange): Range {
	return new Range(
		range.start.line + 1,
		range.start.character + 1,
		range.end.line + 1,
		range.end.character + 1
	);
}

function toBorderColor(options: IWasmDecorationRenderOptions): string | undefined {
	if (!options.borderColor) {
		return undefined;
	}
	const width = options.borderWidth ?? '1px';
	const style = options.borderStyle ?? 'solid';
	return `${width} ${style} ${options.borderColor}`;
}

// `IModelDecorationOptions` only accepts CSS class names (colors are not part
// of the options object any more), so styles are generated on demand.
let decorationStyleElement: HTMLStyleElement | undefined;
const generatedClasses = new Map<string, string>();
let generatedClassSequence = 0;

function classForCss(css: string): string | undefined {
	if (!css.trim()) {
		return undefined;
	}
	const cached = generatedClasses.get(css);
	if (cached) {
		return cached;
	}
	if (!decorationStyleElement?.isConnected) {
		decorationStyleElement = document.createElement('style');
		decorationStyleElement.id = 'sidex-wasm-decorations';
		document.head.appendChild(decorationStyleElement);
	}
	const name = `sidex-wasm-deco-${++generatedClassSequence}`;
	generatedClasses.set(css, name);
	decorationStyleElement.textContent += `.${name} { ${css} }\n`;
	return name;
}

function attachmentCss(attachment: IWasmDecorationAttachment | undefined): string {
	if (!attachment) {
		return '';
	}
	const parts: string[] = [];
	if (attachment.color) {
		parts.push(`color: ${attachment.color};`);
	}
	if (attachment.backgroundColor) {
		parts.push(`background-color: ${attachment.backgroundColor};`);
	}
	if (attachment.margin) {
		parts.push(`margin: ${attachment.margin};`);
	}
	if (attachment.width) {
		parts.push(`width: ${attachment.width};`);
	}
	if (attachment.height) {
		parts.push(`height: ${attachment.height};`);
	}
	return parts.join(' ');
}

function toDecorationOptions(
	groupOptions: IWasmDecorationRenderOptions | undefined,
	instance: IWasmDecorationInstance
): IModelDecorationOptions {
	const options = instance.renderOptions ?? groupOptions ?? {};

	const result: IModelDecorationOptions = {
		description: 'wasm-extension',
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
	};

	const lineCss: string[] = [];
	if (options.backgroundColor) {
		lineCss.push(`background-color: ${options.backgroundColor};`);
	}
	const border = toBorderColor(options);
	if (border) {
		lineCss.push(`border: ${border};`);
	}
	const className = classForCss(lineCss.join(' '));
	if (className) {
		result.className = className;
	}

	if (options.overviewRulerColor) {
		result.overviewRuler = {
			color: options.overviewRulerColor,
			position: OverviewRulerLane.Center
		};
	}
	if (options.before?.contentText) {
		result.before = {
			content: options.before.contentText,
			inlineClassName: classForCss(attachmentCss(options.before))
		};
	}
	if (options.after?.contentText) {
		result.after = {
			content: options.after.contentText,
			inlineClassName: classForCss(attachmentCss(options.after))
		};
	}
	if (instance.hoverMessage) {
		result.hoverMessage = new MarkdownString(instance.hoverMessage);
	}

	return result;
}

function applyGroup(model: ITextModel, key: string, decorations: { range: Range; options: IModelDecorationOptions }[]): void {
	model.changeDecorations(accessor => {
		const previous = appliedDecorationIds.get(key) ?? [];
		const next = accessor.deltaDecorations(previous, decorations);
		appliedDecorationIds.set(key, next);
	});
}

/**
 * Pull the decoration groups a WASM extension registered for this document and
 * apply them through the text model's decoration API.
 */
export async function refreshWasmDecorations(model: ITextModel): Promise<void> {
	const uri = model.uri.toString();
	let groups: IWasmDecorationGroup[] = [];
	try {
		groups = await invoke<IWasmDecorationGroup[]>('wasm_get_decorations', { uri });
	} catch {
		return;
	}
	if (model.isDisposed()) {
		return;
	}

	const seen = new Set<string>();
	for (const group of groups ?? []) {
		const key = groupKey(uri, group);
		seen.add(key);
		const decorations = (group.instances ?? []).map(instance => ({
			range: toRange(instance.range),
			options: toDecorationOptions(group.options, instance)
		}));
		applyGroup(model, key, decorations);
	}

	for (const key of Array.from(appliedDecorationIds.keys())) {
		if (key.startsWith(`${uri}|`) && !seen.has(key)) {
			applyGroup(model, key, []);
			appliedDecorationIds.delete(key);
		}
	}
}

/** Drop all decorations previously applied to a document. */
export function clearWasmDecorations(model: ITextModel): void {
	const uri = model.uri.toString();
	for (const key of Array.from(appliedDecorationIds.keys())) {
		if (key.startsWith(`${uri}|`)) {
			applyGroup(model, key, []);
			appliedDecorationIds.delete(key);
		}
	}
}
