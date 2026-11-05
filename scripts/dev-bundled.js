#!/usr/bin/env node
/**
 * 预打包的 dev 前端：`vite build --watch` 输出到 dist，再用本地静态服务托管 dist。
 *
 * 为什么不用 Vite dev server：src/vs 有两千多个源文件，dev 模式下 WebView 要逐个
 * 发起请求并逐个转译，首屏要约 15s；打包成 bundle 后同样的界面只要 1~2s。
 * 代价是改完前端代码要等一次增量打包，然后按 Ctrl+R 刷新窗口。
 *
 * 需要热更新时改用 `npm run dev:hmr`（原来的纯 Vite dev server）。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const indexFile = path.join(distDir, 'index.html');
const assetsDir = path.join(distDir, 'assets');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const PORT = 1420;
const BUILD_TIMEOUT_MS = 300_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

let viteProcess;
let server;

function startBuild() {
  // 先删掉旧的 index.html：只有这一次打包真正写完后，才会重新出现。
  fs.rmSync(indexFile, { force: true });

  viteProcess = spawn(process.execPath, ['--max-old-space-size=12288', viteBin, 'build', '--watch'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SIDEX_DEV_BUNDLE: '1' }
  });

  viteProcess.on('exit', (code, signal) => {
    if (signal) {
      return;
    }
    console.error(`[dev] 前端打包进程退出（code ${code}）`);
    shutdown(code ?? 1);
  });
}

function waitForFirstBuild() {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(indexFile)) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`等待首次打包超时（${BUILD_TIMEOUT_MS / 1000}s）`));
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  let filePath = path.resolve(distDir, `.${urlPath}`);
  if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    // 交给下面的 readFile 报 404
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function startServer() {
  server = http.createServer(serveStatic);
  server.on('error', error => {
    console.error(`[dev] 无法监听 ${PORT} 端口：${error.message}`);
    shutdown(1);
  });
  server.listen(PORT, () => {
    console.log(`[dev] 已托管 dist：http://localhost:${PORT}`);
  });
}

/** 增量打包完成后提示刷新窗口（没有 HMR，需要手动 Ctrl+R）。 */
function watchRebuilds() {
  let last = 0;
  try {
    last = fs.statSync(assetsDir).mtimeMs;
  } catch {
    // 首次打包刚结束，下一次轮询会补上
  }

  setInterval(() => {
    try {
      const mtime = fs.statSync(assetsDir).mtimeMs;
      if (mtime !== last) {
        last = mtime;
        console.log('[dev] 前端已重新打包 —— 按 Ctrl+R 重新加载窗口');
      }
    } catch {
      // 打包过程中目录可能短暂不存在
    }
  }, 1000);
}

function shutdown(code = 0) {
  try {
    server?.close();
  } catch {
    // ignore
  }
  try {
    viteProcess?.kill();
  } catch {
    // ignore
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  try {
    viteProcess?.kill();
  } catch {
    // ignore
  }
});

async function main() {
  console.log('[dev] 预打包模式：首次打包完成后启动静态服务');
  startBuild();
  await waitForFirstBuild();
  startServer();
  watchRebuilds();
}

main().catch(error => {
  console.error(`[dev] 启动失败：${error.message}`);
  shutdown(1);
});
