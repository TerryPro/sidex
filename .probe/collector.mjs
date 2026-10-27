import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.probe/posted.json');

const server = http.createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
	if (req.method === 'OPTIONS') {
		res.writeHead(204).end();
		return;
	}
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		const entry = { at: new Date().toISOString(), method: req.method, url: req.url, body };
		fs.writeFileSync(OUT, JSON.stringify(entry, null, 2));
		console.log('[collector]', req.method, req.url, body.slice(0, 200));
		res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
	});
});

server.listen(8790, '127.0.0.1', () => console.log('[collector] listening on 8790'));
