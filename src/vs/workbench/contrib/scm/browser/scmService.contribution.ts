/*---------------------------------------------------------------------------------------------
 *  SideX — 仅保留快速差异（Quick Diff）相关服务，不再注册任何 SCM 界面
 *
 *  原有的 scm.contribution 会注册活动栏「源代码管理」、视图容器、状态栏、菜单、
 *  命令与配置；SideX 不提供 Git 功能，因此只注册编辑器快速差异所需的服务。
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IQuickDiffService } from '../common/quickDiff.js';
import { QuickDiffService } from '../common/quickDiffService.js';
import { ISCMService } from '../common/scm.js';
import { SCMService } from '../common/scmService.js';
import { IQuickDiffModelService, QuickDiffModelService } from './quickDiffModel.js';

registerSingleton(ISCMService, SCMService, InstantiationType.Delayed);
registerSingleton(IQuickDiffService, QuickDiffService, InstantiationType.Delayed);
registerSingleton(IQuickDiffModelService, QuickDiffModelService, InstantiationType.Delayed);
