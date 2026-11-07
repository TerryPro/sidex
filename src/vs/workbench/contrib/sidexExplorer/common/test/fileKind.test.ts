import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ASSET_ORIGIN,
	assetUrl,
	classifyFile,
	extensionOf,
	formatBytes,
	imageMime,
	maxThumbnailBytes,
	thumbnailKindOf
} from '../fileKind.ts';

test('extensionOf 忽略大小写并处理无扩展名', () => {
	assert.equal(extensionOf('A.PNG'), 'png');
	assert.equal(extensionOf('archive.tar.gz'), 'gz');
	assert.equal(extensionOf('.gitignore'), '');
	assert.equal(extensionOf('README'), '');
});

test('classifyFile 覆盖五种类别', () => {
	assert.equal(classifyFile('logo.svg'), 'image');
	assert.equal(classifyFile('clip.mp4'), 'video');
	assert.equal(classifyFile('doc.pdf'), 'pdf');
	assert.equal(classifyFile('main.ts'), 'text');
	assert.equal(classifyFile('makefile'), 'text');
	assert.equal(classifyFile('.gitignore'), 'text');
	assert.equal(classifyFile('app.bin'), 'other');
});

test('thumbnailKindOf 只放行图片、视频与 PDF', () => {
	assert.equal(thumbnailKindOf('a.png'), 'image');
	assert.equal(thumbnailKindOf('a.mkv'), 'video');
	assert.equal(thumbnailKindOf('a.pdf'), 'pdf');
	assert.equal(thumbnailKindOf('a.ts'), undefined);
	assert.equal(thumbnailKindOf('a.bin'), undefined);
});

test('maxThumbnailBytes 按类别给上限', () => {
	assert.equal(maxThumbnailBytes('image'), 32 * 1024 * 1024);
	assert.equal(maxThumbnailBytes('video'), 512 * 1024 * 1024);
	assert.equal(maxThumbnailBytes('pdf'), 64 * 1024 * 1024);
});

test('imageMime 只认识图片扩展名', () => {
	assert.equal(imageMime('a.png'), 'image/png');
	assert.equal(imageMime('a.JPG'), 'image/jpeg');
	assert.equal(imageMime('a.svg'), 'image/svg+xml');
	assert.equal(imageMime('a.txt'), undefined);
	assert.equal(imageMime('noext'), undefined);
});

test('assetUrl 编码路径片段并可附加版本号', () => {
	assert.equal(assetUrl('C:\\pics\\a b.png'), `${ASSET_ORIGIN}/C%3A/pics/a%20b.png`);
	// POSIX 绝对路径首字符是 `/`，拼接后与原来的两处实现一致，保留双斜杠形态。
	assert.equal(assetUrl('/tmp/a.png', 42), `${ASSET_ORIGIN}//tmp/a.png?v=42`);
	assert.equal(assetUrl('/tmp/图片.png'), `${ASSET_ORIGIN}//tmp/%E5%9B%BE%E7%89%87.png`);
});

test('formatBytes 保留原有输出格式', () => {
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(-1), '0 B');
	assert.equal(formatBytes(1023), '1023 B');
	assert.equal(formatBytes(1024), '1 KB');
	assert.equal(formatBytes(2 * 1024 * 1024), '2 MB');
	assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1.5 GB');
});
