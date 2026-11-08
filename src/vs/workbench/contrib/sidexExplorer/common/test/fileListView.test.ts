import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DEFAULT_FILE_VIEW_STATE,
	displayEntryName,
	normalizeFileViewState,
	parseFileViewStates,
	stripFileExtension
} from '../fileListView.ts';

test('非法或缺失的视图状态回退默认值', () => {
	assert.equal(normalizeFileViewState(undefined), DEFAULT_FILE_VIEW_STATE);
	assert.deepEqual(normalizeFileViewState({ sortKey: 'nope', viewMode: 1 }), DEFAULT_FILE_VIEW_STATE);
});

test('合法字段被保留，缺失字段单独回退', () => {
	assert.deepEqual(
		normalizeFileViewState({ sortKey: 'size', viewMode: 'icons' }),
		{ sortKey: 'size', sortAscending: true, viewMode: 'icons' }
	);
});

test('视图状态记录按目录标签解析，坏项被丢弃', () => {
	assert.deepEqual(parseFileViewStates('not json'), {});
	assert.deepEqual(parseFileViewStates('[]'), {});
	assert.deepEqual(parseFileViewStates(undefined), {});
	const parsed = parseFileViewStates(JSON.stringify({
		'tab-1': { sortKey: 'modified', sortAscending: false, viewMode: 'list' },
		'tab-2': { sortKey: 'bogus', viewMode: 'bogus' }
	}));
	assert.deepEqual(parsed['tab-1'], { sortKey: 'modified', sortAscending: false, viewMode: 'list' });
	assert.deepEqual(parsed['tab-2'], DEFAULT_FILE_VIEW_STATE);
});

test('隐藏扩展名只影响文件，目录与无扩展名文件保持原样', () => {
	assert.equal(stripFileExtension('archive.tar.gz'), 'archive.tar');
	assert.equal(stripFileExtension('.gitignore'), '.gitignore');
	assert.equal(stripFileExtension('README'), 'README');
	assert.equal(displayEntryName({ name: 'main.ts', isDir: false }, false), 'main');
	assert.equal(displayEntryName({ name: 'main.ts', isDir: false }, true), 'main.ts');
	assert.equal(displayEntryName({ name: 'src.v2', isDir: true }, false), 'src.v2');
});
