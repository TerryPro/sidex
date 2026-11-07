import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DirectoryViewContent } from '../directoryViewContent.ts';

function entry(name: string) {
	return { name, path: `/${name}`, isDir: false, size: 0, modified: 0 };
}

const names = (content: DirectoryViewContent) => content.entries?.map(item => item.name);

test('开始搜索后不再对外暴露旧目录数据', () => {
	const content = new DirectoryViewContent();
	content.accept(content.beginDirectoryLoad('/work', 1), [entry('a')]);
	assert.deepEqual(names(content), ['a']);

	const search = content.beginSearch('/work', 1, 'abc');
	assert.equal(content.loading, true);
	// 回归点：搜索在途时视图拿不到上一次的数据，切换图标主题也不会用旧结果重绘。
	assert.equal(content.entries, undefined);

	content.acceptSearch(search, [entry('abc.txt')]);
	assert.deepEqual(names(content), ['abc.txt']);
});

test('目录加载与搜索共用一个请求号，后发请求胜出', () => {
	const content = new DirectoryViewContent();
	const search = content.beginSearch('/work', 1, 'abc');
	const load = content.beginDirectoryLoad('/work', 1);

	assert.equal(content.acceptSearch(search, [entry('old')]), false);
	assert.equal(content.accept(load, [entry('new')]), true);
	assert.deepEqual(names(content), ['new']);
});

test('过期搜索结果不能覆盖新搜索', () => {
	const content = new DirectoryViewContent();
	const first = content.beginSearch('/work', 1, 'a');
	const second = content.beginSearch('/work', 1, 'ab');

	assert.equal(content.acceptSearch(first, [entry('a')]), false);
	assert.equal(content.acceptSearch(second, [entry('ab')]), true);
	assert.equal(content.query, 'ab');
});

test('清空搜索后目录缓存可复用', () => {
	const content = new DirectoryViewContent();
	content.accept(content.beginDirectoryLoad('/work', 1), [entry('a')]);
	content.acceptSearch(content.beginSearch('/work', 1, 'abc'), [entry('abc')]);

	assert.equal(content.isCurrent('/work', 1, ''), false);
	assert.equal(content.useDirectoryCache('/work', 1), true);
	assert.deepEqual(names(content), ['a']);
	assert.equal(content.isCurrent('/work', 1, ''), true);
});

test('换目录后目录缓存不可复用', () => {
	const content = new DirectoryViewContent();
	content.accept(content.beginDirectoryLoad('/work', 1), [entry('a')]);
	content.acceptSearch(content.beginSearch('/work', 1, 'abc'), [entry('abc')]);

	assert.equal(content.useDirectoryCache('/other', 1), false);
});

test('isCurrent 覆盖同目录刷新、换目录与换搜索词', () => {
	const content = new DirectoryViewContent();
	content.accept(content.beginDirectoryLoad('/work', 1), [entry('a')]);

	assert.equal(content.isCurrent('/work', 1, ''), true);
	assert.equal(content.isCurrent('/work', 2, ''), false);
	assert.equal(content.isCurrent('/other', 1, ''), false);

	content.acceptSearch(content.beginSearch('/work', 1, 'abc'), [entry('abc')]);
	assert.equal(content.isCurrent('/work', 1, 'abc'), true);
	assert.equal(content.isCurrent('/work', 1, 'abcd'), false);
});

test('加载中永远不是 current，失败后可重新发起', () => {
	const content = new DirectoryViewContent();
	const first = content.beginDirectoryLoad('/work', 1);

	assert.equal(content.isCurrent('/work', 1, ''), false);
	assert.equal(content.fail(first), true);
	assert.equal(content.loading, false);
	assert.equal(content.isCurrent('/work', 1, ''), false);

	content.invalidate();
	assert.equal(content.accept(first, [entry('a')]), false);
});

test('revision 在每次状态变化后递增', () => {
	const content = new DirectoryViewContent();
	const initial = content.revision;
	const afterBegin = (content.beginDirectoryLoad('/work', 1), content.revision);
	content.accept(1, [entry('a')]);

	assert.ok(afterBegin > initial);
	assert.ok(content.revision > afterBegin);
});
