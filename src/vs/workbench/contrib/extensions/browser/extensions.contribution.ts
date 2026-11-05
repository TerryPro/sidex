/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IExtensionsWorkbenchService } from '../common/extensions.js';
import { ExtensionsWorkbenchService } from './extensionsWorkbenchService.js';

// SideX 只保留内置声明式扩展。这里仅注册扩展工作台服务，
// 旧扩展管理视图、市场/安装命令、扩展详情编辑器与运行时视图均不再注册。
registerSingleton(IExtensionsWorkbenchService, ExtensionsWorkbenchService, InstantiationType.Delayed);
