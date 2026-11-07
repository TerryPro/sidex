import { defineConfig, type Plugin } from 'vite';
import * as path from 'path';
import { nlsPlugin } from './scripts/vite-plugin-nls';

// 移除 Mermaid 的 ELK 布局注册，避免产出约 1.4 MB 的 elk 懒加载块。
// 请求 ELK 布局的图示由 Mermaid 自动回退到 dagre（仅控制台警告），渲染不受影响。
// 关键点是 `elkLayoutLoaders` 有 @__PURE__ 标注，移除唯一调用后整段（含 elk 的
// 动态 import）会被 Rollup 当做死代码摇掉。
function stripMermaidElk(): Plugin {
	return {
		name: 'sidex-strip-mermaid-elk',
		enforce: 'pre',
		transform(code, id) {
			if (!id.includes('node_modules/mermaid/') || !id.endsWith('.mjs')) {
				return null;
			}
			if (!code.includes('elkLayoutLoaders') || !code.includes('...true ?')) {
				return null;
			}
			const patched = code.replace('...elkLayoutLoaders()', '...[]');
			return patched === code ? null : { code: patched, map: null };
		},
	};
}

function quietMissingSourceMaps() {
  const skip = [/\/vscode-textmate\/.*\.js\.map$/];
  return {
    name: 'sidex-quiet-missing-source-maps',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (skip.some((re) => re.test(url))) {
          res.statusCode = 204;
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// `npm run dev` 走预打包模式：保留 sourcemap 且不压缩，方便在 WebView 里调试。
const devBundle = process.env.SIDEX_DEV_BUNDLE === '1';

export default defineConfig({
  clearScreen: false,
  assetsInclude: ['**/*.wasm', '**/*.json', '**/*.tmLanguage.json'],
  publicDir: 'public',
  plugins: [nlsPlugin(), stripMermaidElk(), quietMissingSourceMaps()],
  server: {
    port: 1420,
    strictPort: true,
    // Webviews are served from `<uuid>.webview.localhost` so they run in a
    // different origin than the workbench.
    allowedHosts: ['.webview.localhost', 'localhost', '127.0.0.1'],
    watch: {
      // `target/` is the workspace cargo output dir; watching it on Windows
      // throws EBUSY while rustc is writing build artifacts.
      // Binary artifacts under the workspace root can also be locked by other
      // apps (e.g. a PDF viewer), which would crash the dev server watcher.
      ignored: ['**/src-tauri/**', '**/target/**', '**/*.pdf', '**/*.zip', '**/*.vsix', '**/*.bin'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      'vs': path.resolve(__dirname, 'src/vs'),
    },
  },
  build: {
    target: ['es2022', 'chrome100', 'safari15'],
    minify: devBundle ? false : 'esbuild',
    sourcemap: devBundle ? true : false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        textMateWorker: path.resolve(__dirname, 'src/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.ts'),
        editorWorker: path.resolve(__dirname, 'src/vs/editor/common/services/editorWebWorkerMain.ts'),
        extensionHostWorker: path.resolve(__dirname, 'src/vs/workbench/api/worker/extensionHostWorkerMain.ts'),
        // Force the NLS runtime (localize/localize2) into its own chunk so it
        // loads first and has its global translation tables in place before any
        // module evaluates `localize()` at top-level module scope.
        nls: path.resolve(__dirname, 'src/vs/nls.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'editorWorker') {
            return 'assets/editorWorker.js';
          }
          if (chunkInfo.name === 'textMateWorker') {
            return 'assets/textMateWorker.js';
          }
          if (chunkInfo.name === 'extensionHostWorker') {
            return 'assets/extensionHostWorker.js';
          }
          if (chunkInfo.name === 'nls') {
            return 'assets/nls.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if ((assetInfo.name ?? '').endsWith('.ts')) {
            const base = (assetInfo.name ?? 'asset').slice(0, -3);
            return `assets/${base}-[hash].js`;
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks(id, { getModuleInfo }) {
          const isWorkerDep = (moduleId: string, visited = new Set<string>()): boolean => {
            if (visited.has(moduleId)) return false;
            visited.add(moduleId);
            const info = getModuleInfo(moduleId);
            if (!info) return false;
            if (info.isEntry && (moduleId.includes('WorkerMain') || moduleId.includes('workerMain'))) {
              return true;
            }
            for (const importer of info.importers) {
              if (isWorkerDep(importer, visited)) return true;
            }
            return false;
          };

          if (isWorkerDep(id)) {
            return undefined;
          }

          if (id.endsWith('/vs/nls.ts') || id.endsWith('/vs/nls.js')) {
            return 'nls';
          }
          if (id.endsWith('/vs/nls.mock.js')) {
            return 'nls';
          }
          if (
            id.includes('/vs/base/') ||
            id.endsWith('/vs/amdX.ts') || id.endsWith('/vs/amdX.js') ||
            id.endsWith('/vs/sidex-bridge.ts') || id.endsWith('/vs/sidex-bridge.js') ||
            id.includes('xterm') || id.includes('/terminal/') ||
            (id.includes('/vs/editor/') && !id.includes('/workbench/')) ||
            id.includes('/vs/platform/')
          ) {
            return 'core';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vscode-textmate', 'vscode-oniguruma'],
    exclude: ['@tauri-apps/api'],
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'workers/[name]-[hash].js',
        chunkFileNames: 'workers/[name]-[hash].js',
      },
    },
  },
});
