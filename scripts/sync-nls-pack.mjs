#!/usr/bin/env node
/**
 * 下载 VS Code 语言包翻译，整理成 key → 译文 的扁平字典，写入 public/nls/<locale>.json。
 * 运行后前端只读取本地资源，不再有任何外网请求。
 *
 * 用法：
 *   node scripts/sync-nls-pack.mjs            # 默认 zh-cn
 *   node scripts/sync-nls-pack.mjs ja
 *
 * 需要更新语言包（例如 VS Code 版本升级）时重新执行一次。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PACKS = {
	'zh-cn': 'MS-CEINTL.vscode-language-pack-zh-hans',
	'zh-tw': 'MS-CEINTL.vscode-language-pack-zh-hant',
	ja: 'MS-CEINTL.vscode-language-pack-ja',
	ko: 'MS-CEINTL.vscode-language-pack-ko',
	de: 'MS-CEINTL.vscode-language-pack-de',
	fr: 'MS-CEINTL.vscode-language-pack-fr',
	es: 'MS-CEINTL.vscode-language-pack-es'
};

const locale = (process.argv[2] ?? 'zh-cn').toLowerCase();
const extensionId = PACKS[locale];

if (!extensionId) {
	console.error(`不支持的语言：${locale}（可选：${Object.keys(PACKS).join(', ')}）`);
	process.exit(1);
}

const [publisher, name] = extensionId.split('.');

async function main() {
	console.log(`[nls] 查询 ${extensionId} 最新版本…`);
	const metaRes = await fetch(`https://open-vsx.org/api/${publisher}/${name}/latest`);
	if (!metaRes.ok) {
		throw new Error(`查询版本失败：HTTP ${metaRes.status}`);
	}
	const meta = await metaRes.json();

	const url = `https://open-vsx.org/vscode/unpkg/${publisher}/${name}/${meta.version}/extension/translations/main.i18n.json`;
	console.log(`[nls] 下载 ${meta.version}：${url}`);
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`下载翻译失败：HTTP ${res.status}`);
	}

	const bundle = await res.json();
	const messages = {};
	for (const contents of Object.values(bundle.contents ?? {})) {
		Object.assign(messages, contents);
	}

	const count = Object.keys(messages).length;
	if (count === 0) {
		throw new Error('语言包内容为空');
	}

	const outDir = path.join(root, 'public', 'nls');
	fs.mkdirSync(outDir, { recursive: true });
	const outFile = path.join(outDir, `${locale}.json`);
	fs.writeFileSync(outFile, JSON.stringify(messages));

	console.log(
		`[nls] 已写入 ${path.relative(root, outFile)}：${count} 条，${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB`
	);
}

main().catch(error => {
	console.error(`[nls] 失败：${error.message}`);
	process.exit(1);
});
