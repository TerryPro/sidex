/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

export interface ITOCFilter {
	include?: {
		keyPatterns?: string[];
		tags?: string[];
	};
	exclude?: {
		keyPatterns?: string[];
		tags?: string[];
	};
}

export interface ITOCEntry<T> {
	id: string;
	label: string;
	order?: number;
	children?: ITOCEntry<T>[];
	settings?: Array<T>;
	hide?: boolean;
}

/**
 * SideX settings layout is intentionally limited to five groups:
 * files & browsing, editor, theme & appearance, keybindings and extensions.
 */
export const tocData: ITOCEntry<string> = {
	id: 'root',
	label: 'root',
	children: [
		{
			id: 'files',
			label: localize('fileAndBrowsing', 'Files & Browsing'),
			settings: ['files.*', 'explorer.*', 'search.*', 'output.*'],
			children: [
				{
					id: 'features/explorer',
					label: localize('fileExplorer', 'Explorer'),
					settings: ['explorer.*', 'files.*']
				},
				{
					id: 'features/search',
					label: localize('searchGroup', 'Search'),
					settings: ['search.*']
				},
				{
					id: 'features/output',
					label: localize('output', 'Output'),
					settings: ['output.*']
				}
			]
		},
		{
			id: 'editor',
			label: localize('textEditor', 'Text Editor'),
			settings: ['editor.*', 'terminal.*'],
			children: [
				{
					id: 'editor/cursor',
					label: localize('cursor', 'Cursor'),
					settings: ['editor.cursor*']
				},
				{
					id: 'editor/find',
					label: localize('find', 'Find'),
					settings: ['editor.find.*']
				},
				{
					id: 'editor/font',
					label: localize('font', 'Font'),
					settings: ['editor.font*']
				},
				{
					id: 'editor/format',
					label: localize('formatting', 'Formatting'),
					settings: ['editor.format*']
				},
				{
					id: 'editor/minimap',
					label: localize('minimap', 'Minimap'),
					settings: ['editor.minimap.*']
				},
				{
					id: 'editor/terminal',
					label: localize('terminal', 'Terminal'),
					settings: ['terminal.*']
				}
			]
		},
		{
			id: 'appearance',
			label: localize('themeAndAppearance', 'Theme & Appearance'),
			settings: ['workbench.*', 'window.*'],
			children: [
				{
					id: 'appearance/theme',
					label: localize('theme', 'Theme'),
					settings: [
						'workbench.colorTheme',
						'workbench.iconTheme',
						'workbench.productIconTheme',
						'workbench.*color*',
						'window.autoDetectColorScheme',
						'window.autoDetectHighContrast'
					]
				},
				{
					id: 'appearance/layout',
					label: localize('layout', 'Layout'),
					settings: [
						'workbench.activityBar.*',
						'workbench.statusBar.*',
						'workbench.sideBar.*',
						'workbench.layoutControl.*',
						'workbench.panel.*',
						'window.commandCenter',
						'window.menuBarVisibility',
						'window.titleBarStyle',
						'window.zoomLevel'
					]
				},
				{
					id: 'appearance/editorManagement',
					label: localize('editorManagement', 'Editor Management'),
					settings: ['workbench.editor.*', 'workbench.list.*', 'workbench.tree.*']
				}
			]
		},
		{
			id: 'keyboard',
			label: localize('keyboard', 'Keybindings'),
			settings: ['keyboard.*']
		},
		{
			id: 'extensions',
			label: localize('extensions', 'Extensions'),
			settings: ['extensions.*']
		}
	]
};
