/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { invoke } from '@tauri-apps/api/core';
import { Emitter } from '../../../../base/common/event.js';

export interface IRustExtensionInfo {
	id: string;
	name: string;
	version: string;
	path: string;
	wasmBinary: string;
	activationEvents: string[];
	loaded: boolean;
	sizeBytes: number;
}

/** Fires whenever a WASM extension is registered or activated. */
export const onDidChangeRustExtensions = new Emitter<void>();

export async function listRustExtensions(): Promise<IRustExtensionInfo[]> {
	return invoke<IRustExtensionInfo[]>('wasm_extension_details');
}
