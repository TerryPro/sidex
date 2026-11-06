/*---------------------------------------------------------------------------------------------
 *  SideX — 文件列表命令与快捷键
 *
 *  只有文件列表获得焦点时才响应，避免与编辑器快捷键冲突；
 *  通过 KeybindingsRegistry 注册，用户可在键位设置中覆盖。
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';

/** 文件列表是否拥有键盘焦点。 */
export const FILE_LIST_FOCUS_CONTEXT = new RawContextKey<boolean>('sidexFileListFocus', false);

export interface IFileListCommandHost {
	rename(): Promise<void>;
	delete(permanent: boolean): Promise<void>;
	copy(cut: boolean): void;
	paste(): Promise<void>;
	open(): void;
	goUp(): void;
	properties(): Promise<void>;
	undo(): Promise<void>;
	refresh(): void;
	selectAll(): void;
}

let activeHost: IFileListCommandHost | undefined;

export function setActiveFileListHost(host: IFileListCommandHost | undefined): void {
	activeHost = host;
}

const when = ContextKeyExpr.has(FILE_LIST_FOCUS_CONTEXT.key);

function register(id: string, handler: () => unknown): void {
	CommandsRegistry.registerCommand(id, () => handler());
}

register('sidex.files.rename', () => activeHost?.rename());
register('sidex.files.delete', () => activeHost?.delete(false));
register('sidex.files.deletePermanent', () => activeHost?.delete(true));
register('sidex.files.copy', () => activeHost?.copy(false));
register('sidex.files.cut', () => activeHost?.copy(true));
register('sidex.files.paste', () => activeHost?.paste());
register('sidex.files.open', () => activeHost?.open());
register('sidex.files.goUp', () => activeHost?.goUp());
register('sidex.files.properties', () => activeHost?.properties());
register('sidex.files.undo', () => activeHost?.undo());
register('sidex.files.refresh', () => activeHost?.refresh());
register('sidex.files.selectAll', () => activeHost?.selectAll());

interface KeyRule {
	readonly id: string;
	readonly primary: number;
	readonly mac?: { readonly primary: number };
}

const rules: readonly KeyRule[] = [
	{ id: 'sidex.files.rename', primary: KeyCode.F2 },
	{ id: 'sidex.files.delete', primary: KeyCode.Delete },
	{ id: 'sidex.files.deletePermanent', primary: KeyMod.Shift | KeyCode.Delete },
	{ id: 'sidex.files.copy', primary: KeyMod.CtrlCmd | KeyCode.KeyC },
	{ id: 'sidex.files.cut', primary: KeyMod.CtrlCmd | KeyCode.KeyX },
	{ id: 'sidex.files.paste', primary: KeyMod.CtrlCmd | KeyCode.KeyV },
	{ id: 'sidex.files.open', primary: KeyCode.Enter },
	{ id: 'sidex.files.goUp', primary: KeyCode.Backspace },
	{ id: 'sidex.files.properties', primary: KeyMod.Alt | KeyCode.Enter },
	{ id: 'sidex.files.undo', primary: KeyMod.CtrlCmd | KeyCode.KeyZ },
	{ id: 'sidex.files.refresh', primary: KeyCode.F5 },
	{ id: 'sidex.files.selectAll', primary: KeyMod.CtrlCmd | KeyCode.KeyA }
];

for (const rule of rules) {
	KeybindingsRegistry.registerKeybindingRule({
		id: rule.id,
		weight: KeybindingWeight.WorkbenchContrib + 100,
		when,
		primary: rule.primary,
		mac: rule.mac
	});
}
