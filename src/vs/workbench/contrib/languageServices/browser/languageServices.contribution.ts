/*---------------------------------------------------------------------------------------------
 *  SideX: Registers the built-in CSS / HTML / JSON language services.
 *
 *  These replace the Node based `css-language-features`, `html-language-features`
 *  and `json-language-features` extensions that VS Code ships, and keep working
 *  with the Node extension host disabled.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { registerCssLanguageFeatures } from './cssLanguageFeatures.js';
import { registerHtmlLanguageFeatures } from './htmlLanguageFeatures.js';
import { registerJsonLanguageFeatures } from './jsonLanguageFeatures.js';

class BuiltinLanguageServicesContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.builtinLanguageServices';

	private readonly _store = new DisposableStore();

	constructor(
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		@IModelService modelService: IModelService,
		@IMarkerService markerService: IMarkerService,
		@ILogService logService: ILogService
	) {
		const dependencies = { languageFeatures, modelService, markerService, logService };
		for (const disposable of [
			...registerCssLanguageFeatures(dependencies),
			...registerHtmlLanguageFeatures(dependencies),
			...registerJsonLanguageFeatures(dependencies)
		]) {
			this._store.add(disposable);
		}
	}

	dispose(): void {
		this._store.dispose();
	}
}

registerWorkbenchContribution2(BuiltinLanguageServicesContribution.ID, BuiltinLanguageServicesContribution, WorkbenchPhase.AfterRestored);
