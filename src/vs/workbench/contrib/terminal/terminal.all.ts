/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Primary workbench contribution
import './browser/terminal.contribution.js';

// Misc extensions to the workbench contribution
import './common/environmentVariable.contribution.js';
import './common/terminalExtensionPoints.contribution.js';
import './browser/terminalView.js';

// Terminal contributions - Standalone extensions to the terminal, these cannot be imported from the
// primary workbench contribution)
// SideX：只保留基础终端 + 无障碍 + 查找，移除自动回复、命令指南、链接、通知、缩放、
// 粘性滚动、快速访问、快速修复、typeAhead、发送序列、建议、WSL 推荐等 IDE 子特性。
import '../terminalContrib/accessibility/browser/terminal.accessibility.contribution.js';
import '../terminalContrib/find/browser/terminal.find.contribution.js';
// Removed: voice contribution (AI/speech feature not used in SideX)
