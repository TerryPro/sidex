type Translations = Record<string, string>;

const sidexTranslations: Record<string, Translations> = {
	'zh-cn': {
		fileAndBrowsing: '文件与浏览',
		themeAndAppearance: '主题与外观',
		searchGroup: '搜索',
		theme: '主题',
		layout: '布局',
		imagePreview: '图片预览',
		mediaPreviewTitle: '媒体预览',
		'mediaPreview.maxZoom': '图片预览的最大缩放比例（%）。例如 `1200` 表示 1200%。',
		'mediaPreview.showInfo': '在图片预览下方显示信息栏（尺寸、文件大小、缩放比例）。',
		'keyboard.layout.config': '控制 Web 端使用的键盘布局。',
		'missing.keyboardlayout': '无法找到匹配的键盘布局',
		'keyboardLayoutMissing.configure': '配置',
		'remote.pick.placeholder': '选择一个选项来打开远程窗口',
		'remote.pick.connectToTunnel': '连接到隧道…',
		'remote.pick.tunnelsProvider': '远程隧道',
		'remote.pick.connectToHost': '连接到主机…',
		'remote.pick.sshProvider': '远程 SSH',
		'remote.pick.wsl': '连接到 WSL…',
		'remote.pick.wslProvider': '远程 WSL',
		'remote.pick.container': '在容器中打开文件夹…',
		'remote.pick.containerProvider': '开发容器',
		'remote.pick.codespace': '连接到 Codespace…',
		'remote.pick.codespaceProvider': 'GitHub Codespaces',
		'remote.codespace.tokenPrompt': '具有 codespace 范围的 GitHub 个人访问令牌',
		'remote.codespace.none': '未找到此帐户的 Codespace。',
		'remote.codespace.pick': '选择一个 Codespace',
		'remote.codespace.connected': '已连接到 Codespace: {0}',
		'remote.codespace.failed': 'Codespace 连接失败: {0}',
		'explorerViewlet.cloneRepository': '你可以在本地克隆一个仓库。\n{0}',
		remoteExplorer: '远程资源管理器',
		remoteExplorerViewIcon: '远程资源管理器视图图标。',
		'sidex.remote.refresh': '刷新远程资源管理器',
		'sidex.remote.openExplorer': '远程资源管理器',
		'remote.signInMicrosoft': '使用 Microsoft 登录',
		'remote.signInGitHub': '使用 GitHub 登录',
		'remote.ssh.noHosts': '未在 ~/.ssh/config 中找到 SSH 目标',
		'remote.ssh.empty': '~/.ssh/config 中没有 SSH 目标 — 在下方添加',
		'remote.codespaces.empty': '未找到 Codespace',
		'remote.containers.noContainers': '未找到运行中的容器',
		'remote.section.tunnels': '隧道',
		'remote.section.ssh': 'SSH',
		'remote.section.codespaces': 'GitHub Codespaces',
		'remote.section.containers': '开发容器',
		'remote.signIn': '登录',
		'remote.connect': '连接',
		'remote.tunnels': '隧道',
		'remote.ssh': 'SSH',
		'remote.codespaces': 'GitHub Codespaces',
		'remote.containers': '开发容器',
		'remote.wsl': 'WSL 目标',
		'remote.codespaces.signIn': '使用 GitHub 登录以查看你的 Codespace'
	},
	ja: {
		'remote.pick.placeholder': 'リモートウィンドウを開くオプションを選択',
		'remote.pick.connectToTunnel': 'トンネルに接続…',
		'remote.pick.connectToHost': 'ホストに接続…',
		'remote.pick.wsl': 'WSL に接続…',
		'remote.pick.container': 'コンテナーでフォルダーを開く…',
		'remote.pick.codespace': 'Codespace に接続…',
		remoteExplorer: 'リモート エクスプローラー'
	},
	ko: {
		'remote.pick.placeholder': '원격 창을 여는 옵션 선택',
		'remote.pick.connectToTunnel': '터널에 연결…',
		'remote.pick.connectToHost': '호스트에 연결…',
		'remote.pick.wsl': 'WSL에 연결…',
		'remote.pick.container': '컨테이너에서 폴더 열기…',
		'remote.pick.codespace': 'Codespace에 연결…',
		remoteExplorer: '원격 탐색기'
	}
};

const documentLanguageByLocale: Record<string, string> = {
	'zh-cn': 'zh-Hans',
	'zh-tw': 'zh-Hant'
};

function applyDocumentLanguage(locale: string | null): void {
	const normalized = (locale || 'en').toLowerCase();
	document.documentElement.lang = documentLanguageByLocale[normalized] ?? normalized;
}

/** 本次启动 NLS 的来源，仅用于启动诊断日志。 */
export let nlsLoadInfo = 'none';

async function fetchNlsIndex(): Promise<Array<{ key: string; msg: string }> | null> {
	try {
		const res = await fetch('/nls.messages.json');
		if (!res.ok) {
			return null;
		}
		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.includes('json')) {
			return null;
		}
		const entries: unknown = await res.json();
		return Array.isArray(entries) && entries.length > 0
			? (entries as Array<{ key: string; msg: string }>)
			: null;
	} catch {
		return null;
	}
}

/**
 * 语言包随应用一起打包在 `public/nls/<locale>.json`
 * （由 `node scripts/sync-nls-pack.mjs` 生成），启动时只读本地资源，不做任何外网请求。
 */
async function fetchLocalPack(locale: string): Promise<Translations | null> {
	try {
		const res = await fetch(`/nls/${locale.toLowerCase()}.json`);
		if (!res.ok) {
			return null;
		}
		const data: unknown = await res.json();
		return data && typeof data === 'object' ? (data as Translations) : null;
	} catch {
		return null;
	}
}

export async function loadNlsMessages(): Promise<void> {
	const locale = localStorage.getItem('vscode.nls.locale');
	applyDocumentLanguage(locale);

	if (!locale || locale.toLowerCase().startsWith('en')) {
		nlsLoadInfo = 'en';
		return;
	}

	const nlsEntries = await fetchNlsIndex();
	const translations = await fetchLocalPack(locale);

	if (!translations) {
		console.warn(`[SideX NLS] 未找到本地语言包 /nls/${locale.toLowerCase()}.json`);
		nlsLoadInfo = 'no-local-pack';
		return;
	}
	nlsLoadInfo = 'local';

	// 合并语言包里没有的 SideX 专属翻译
	const sidexExtra = sidexTranslations[locale.toLowerCase()];
	if (sidexExtra) {
		for (const [key, val] of Object.entries(sidexExtra)) {
			if (!(key in translations)) {
				translations[key] = val;
			}
		}
	}

	if (nlsEntries) {
		const messages = nlsEntries.map(({ key, msg }) => translations[key] ?? msg);
		(globalThis as any)._VSCODE_NLS_MESSAGES = messages;
		(globalThis as any)._VSCODE_NLS_LANGUAGE = locale;
		console.log(`[SideX NLS] Loaded ${messages.length} translations for ${locale} (local pack)`);
		return;
	}

	(globalThis as any)._VSCODE_NLS_TRANSLATIONS = translations;
	(globalThis as any)._VSCODE_NLS_LANGUAGE = locale;
	nlsLoadInfo = 'local-keys';
	console.log(`[SideX NLS] Loaded ${Object.keys(translations).length} translations for ${locale} (key mode)`);
}
