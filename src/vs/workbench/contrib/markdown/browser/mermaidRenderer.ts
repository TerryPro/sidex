/*---------------------------------------------------------------------------------------------
 *  SideX: Mermaid rendering shared by the markdown preview and the .mmd preview.
 *--------------------------------------------------------------------------------------------*/

let mermaidPromise: Promise<typeof import('mermaid')> | undefined;
let mermaidRenderId = 0;

export function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders a Mermaid diagram source to inline SVG. */
export async function renderMermaid(source: string, isLight: boolean): Promise<string> {
	try {
		if (!mermaidPromise) {
			mermaidPromise = import('mermaid') as Promise<typeof import('mermaid')>;
		}
		const mermaid = await mermaidPromise;
		mermaid.default.initialize({
			startOnLoad: false,
			theme: isLight ? 'default' : 'dark',
			securityLevel: 'strict'
		});
		const result = await mermaid.default.render(`sidex-mermaid-${++mermaidRenderId}`, source);
		return result.svg;
	} catch (error) {
		console.error('[Mermaid] render failed', error);
		return `<pre class="mermaid-error">${escapeHtml(source)}</pre>`;
	}
}
