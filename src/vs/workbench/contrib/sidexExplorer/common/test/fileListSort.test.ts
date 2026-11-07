import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sortFileEntries } from '../fileListSort.ts';

interface Entry {
	readonly name: string;
	readonly path: string;
	readonly isDir: boolean;
	readonly size: number;
	readonly modified: number;
}

function entry(name: string, options: { isDir?: boolean; size?: number; modified?: number } = {}): Entry {
	return {
		name,
		path: `/${name}`,
		isDir: options.isDir ?? false,
		size: options.size ?? 0,
		modified: options.modified ?? 0
	};
}

// 输入顺序刻意与任何排序结果都不同，便于发现排序是否真正生效。
const entries: Entry[] = [
	entry('b.txt', { size: 200, modified: 2000 }),
	entry('a10.png', { size: 100, modified: 1000 }),
	entry('a2.txt', { size: 300, modified: 3000 }),
	entry('folder', { isDir: true, size: 0, modified: 500 })
];

const names = (sorted: readonly Entry[]) => sorted.map(item => item.name);

test('name 排序使用数字感知并按方向翻转', () => {
	assert.deepEqual(names(sortFileEntries(entries, 'name', true)), ['folder', 'a2.txt', 'a10.png', 'b.txt']);
	assert.deepEqual(names(sortFileEntries(entries, 'name', false)), ['folder', 'b.txt', 'a10.png', 'a2.txt']);
});

test('modified 排序按方向翻转', () => {
	assert.deepEqual(names(sortFileEntries(entries, 'modified', true)), ['folder', 'a10.png', 'b.txt', 'a2.txt']);
	assert.deepEqual(names(sortFileEntries(entries, 'modified', false)), ['folder', 'a2.txt', 'b.txt', 'a10.png']);
});

test('size 排序按方向翻转', () => {
	assert.deepEqual(names(sortFileEntries(entries, 'size', true)), ['folder', 'a10.png', 'b.txt', 'a2.txt']);
	assert.deepEqual(names(sortFileEntries(entries, 'size', false)), ['folder', 'a2.txt', 'b.txt', 'a10.png']);
});

test('type 排序取扩展名，等值时保持原顺序', () => {
	assert.deepEqual(names(sortFileEntries(entries, 'type', true)), ['folder', 'a10.png', 'b.txt', 'a2.txt']);
	assert.deepEqual(names(sortFileEntries(entries, 'type', false)), ['folder', 'b.txt', 'a2.txt', 'a10.png']);
});

test('目录分组恒在文件之前，方向只在本组内生效', () => {
	const mixed = [entry('a.txt'), entry('zeta', { isDir: true }), entry('b.txt'), entry('alpha', { isDir: true })];
	assert.deepEqual(names(sortFileEntries(mixed, 'name', true)), ['alpha', 'zeta', 'a.txt', 'b.txt']);
	assert.deepEqual(names(sortFileEntries(mixed, 'name', false)), ['zeta', 'alpha', 'b.txt', 'a.txt']);
});

test('不修改入参数组', () => {
	const original = [...entries];
	sortFileEntries(entries, 'size', false);
	assert.deepEqual(entries, original);
});
