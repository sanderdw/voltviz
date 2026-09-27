/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {createReadStream, existsSync, statSync} from 'node:fs';
import {join, normalize} from 'node:path';

/**
 * Development only: serves evaluation audio from .cache/test-audio at /__testaudio/<file>
 * (same origin, with HTTP Range support so <audio> can seek). See scripts/eval.
 */
function testAudio(): Plugin {
  const root = join(import.meta.dirname, '.cache', 'test-audio');
  return {
    name: 'voltviz-test-audio',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__testaudio', (req, res, next) => {
        const file = normalize(join(root, decodeURIComponent((req.url ?? '/').split('?')[0])));
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return next();
        const size = statSync(file).size;
        const type = file.endsWith('.wav') ? 'audio/wav' : file.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', type);
        if (range) {
          const start = range[1] ? parseInt(range[1], 10) : 0;
          const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', end - start + 1);
          createReadStream(file, { start, end }).pipe(res);
        } else {
          res.setHeader('Content-Length', size);
          createReadStream(file).pipe(res);
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const appVersion = process.env.npm_package_version ?? 'dev';
  return {
    // Relative base so built asset URLs work when served under a path
    // prefix (e.g. Home Assistant ingress), not just at the site root.
    base: './',
    plugins: [react(), tailwindcss(), testAudio()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    build: {
      chunkSizeWarningLimit: 600,
    },
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      // keep memory predictable: at most two forked workers
      pool: 'forks',
      maxWorkers: 2,
      testTimeout: 60000,
    },
  };
});
