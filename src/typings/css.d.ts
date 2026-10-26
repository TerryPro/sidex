/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// Recognize all CSS files as valid module imports
declare module "vs/css!*" { }
declare module "*.css" { }

// Vite: `import css from './file.css?inline'` yields the stylesheet as a string
declare module "*?inline" {
	const content: string;
	export default content;
}
