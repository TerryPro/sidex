import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DirectoryViewMetadata } from '../directoryViewState.ts';
import { isDirectoryDataCurrent, isDirectoryViewCurrent } from '../directoryViewState.ts';

function view(overrides: Partial<DirectoryViewMetadata> = {}): DirectoryViewMetadata {
	return {
		renderedLocation: '/work',
		renderedRefreshToken: 1,
		renderedQuery: '',
		searchRoot: undefined,
		...overrides
	};
}

const tab = { location: '/work', refreshToken: 1 };

test('同目录未刷新、无搜索词时视图是最新的', () => {
	assert.equal(isDirectoryViewCurrent(view(), tab, ''), true);
});

test('同目录刷新后视图过期', () => {
	assert.equal(isDirectoryViewCurrent(view(), { ...tab, refreshToken: 2 }, ''), false);
});

test('换目录后视图过期', () => {
	assert.equal(isDirectoryViewCurrent(view(), { location: '/other', refreshToken: 1 }, ''), false);
});

test('换搜索词后视图过期', () => {
	const searching = view({ renderedQuery: 'abc', searchRoot: '/work' });
	assert.equal(isDirectoryViewCurrent(searching, tab, 'abc'), true);
	assert.equal(isDirectoryViewCurrent(searching, tab, 'abcd'), false);
});

test('清空搜索后视图过期，目录缓存仍可用', () => {
	const searching = view({ renderedQuery: 'abc', searchRoot: '/work' });
	assert.equal(isDirectoryViewCurrent(searching, tab, ''), false);
	assert.equal(isDirectoryDataCurrent(searching, tab), true);
});

test('切换目录后目录缓存不可复用', () => {
	assert.equal(isDirectoryDataCurrent(view(), { location: '/other', refreshToken: 1 }), false);
});
