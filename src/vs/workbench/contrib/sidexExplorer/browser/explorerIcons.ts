/*---------------------------------------------------------------------------------------------
 *  SideX — 资源管理器图标（内联 SVG，避免依赖系统图标）
 *--------------------------------------------------------------------------------------------*/

export function pcIconSvg(): string {
	return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
		+ '<rect x="1.5" y="2" width="13" height="8.5" rx="1.2" fill="#3b8df1"/>'
		+ '<rect x="2.8" y="3.3" width="10.4" height="5.9" rx="0.7" fill="#dfeaf8"/>'
		+ '<path d="M6.2 11h3.6l0.7 2.6H5.5z" fill="#9aa7b4"/>'
		+ '<rect x="4.2" y="13.6" width="7.6" height="1.2" rx="0.6" fill="#9aa7b4"/>'
		+ '</svg>';
}

export function driveIconSvg(kind: string): string {
	const body = kind === 'network' ? '#5b7da6' : kind === 'removable' ? '#6b6b6b' : '#545454';
	return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
		+ `<rect x="1" y="3.6" width="14" height="8.8" rx="1.4" fill="${body}"/>`
		+ '<rect x="2.4" y="4.9" width="9" height="6.2" rx="0.8" fill="#8b8b8b"/>'
		+ '<rect x="2.4" y="4.9" width="9" height="1.4" rx="0.6" fill="#a6a6a6"/>'
		+ '<circle cx="12.9" cy="10.4" r="1" fill="#74e08f"/>'
		+ '</svg>';
}

export function folderIconSvg(): string {
	return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
		+ '<path d="M1.2 4.2h4.6l1.3 1.6h8.1v7.7H1.2z" fill="#e5b34a"/>'
		+ '<path d="M1.2 5.9h13.9v1.2H1.2z" fill="#f0c96e"/>'
		+ '</svg>';
}

export function fileIconSvg(): string {
	return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">'
		+ '<path d="M3 1h6.6l3.4 3.4V15H3z" fill="#f7f7f7" stroke="#cfcfcf" stroke-width="0.8"/>'
		+ '<path d="M9.6 1v3.4h3.4" fill="#e8e8e8" stroke="#cfcfcf" stroke-width="0.8"/>'
		+ '<rect x="4.6" y="7" width="6.8" height="0.9" fill="#c9c9c9"/>'
		+ '<rect x="4.6" y="9" width="6.8" height="0.9" fill="#d8d8d8"/>'
		+ '<rect x="4.6" y="11" width="4.6" height="0.9" fill="#d8d8d8"/>'
		+ '</svg>';
}
