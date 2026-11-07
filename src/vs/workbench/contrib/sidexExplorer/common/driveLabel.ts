/*---------------------------------------------------------------------------------------------
 *  SideX - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/** 驱动器类型标签；未知类型返回空串。 */
export function driveLabel(kind: string): string {
	switch (kind) {
		case 'fixed':
			return localize('sidex.drive.localDisk', '本地磁盘');
		case 'removable':
			return localize('sidex.drive.removableDisk', '可移动磁盘');
		case 'network':
			return localize('sidex.drive.networkDrive', '网络驱动器');
		case 'cdrom':
			return localize('sidex.drive.cdDrive', 'DVD 驱动器');
		default:
			return '';
	}
}
