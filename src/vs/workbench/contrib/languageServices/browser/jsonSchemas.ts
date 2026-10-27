/*---------------------------------------------------------------------------------------------
 *  SideX: JSON schemas bundled with the built-in JSON language service.
 *
 *  Snapshots of json.schemastore.org, kept in the repository so schema based
 *  completion and validation also work offline. The tsconfig schema is large,
 *  so it is loaded on demand instead of inflating the main bundle.
 *
 *  The schemas are imported as raw text because the Vite config lists every JSON
 *  file in `assetsInclude`, which makes plain JSON imports resolve to asset URLs.
 *--------------------------------------------------------------------------------------------*/

import type { JSONSchema, SchemaConfiguration } from 'vscode-json-languageservice';
import packageSchemaSource from './schemas/package.schema.json?raw';

const PACKAGE_SCHEMA_URI = 'sidex://schemas/package.json';
const TSCONFIG_SCHEMA_URI = 'sidex://schemas/tsconfig.json';

function parseSchema(source: string): JSONSchema {
	return JSON.parse(source) as JSONSchema;
}

export const builtinSchemaConfigurations: SchemaConfiguration[] = [
	{
		uri: PACKAGE_SCHEMA_URI,
		fileMatch: ['**/package.json', 'package.json'],
		schema: parseSchema(packageSchemaSource)
	}
];

let tsconfigConfiguration: Promise<SchemaConfiguration> | undefined;

export function loadTsconfigSchemaConfiguration(): Promise<SchemaConfiguration> {
	if (!tsconfigConfiguration) {
		tsconfigConfiguration = import('./schemas/tsconfig.schema.json?raw').then(module => ({
			uri: TSCONFIG_SCHEMA_URI,
			fileMatch: ['**/tsconfig.json', '**/tsconfig.*.json'],
			schema: parseSchema(module.default)
		}));
	}
	return tsconfigConfiguration;
}
