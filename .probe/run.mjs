import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve('.probe');

function serve(port) {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			const file = path.join(ROOT, path.basename(new URL(req.url, 'http://x').pathname));
			if (!fs.existsSync(file)) {
				res.writeHead(404).end('not found');
				return;
			}
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fs.readFileSync(file));
		});
		server.listen(port, '127.0.0.1', () => resolve(server));
	});
}

const s1 = await serve(8781);
const s2 = await serve(8782);

let browser;
try {
	browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
} catch (e) {
	browser = await chromium.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
}

const page = await browser.newPage();
await page.goto('http://127.0.0.1:8781/parent.html');
await page.waitForFunction(() => window.__result, null, { timeout: 40000 });
const result = await page.evaluate(() => window.__result);

console.log('BROWSER:', browser.version());
console.log(JSON.stringify(result, null, 2));

await browser.close();
s1.close();
s2.close();
