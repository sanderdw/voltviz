/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {createReadStream, existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
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

/**
 * Production only: emits `third-party-notices.txt` next to index.html. It starts with
 * THIRD_PARTY_NOTICES.md (hand-written: adapted code, model, data) and appends the license
 * texts of every npm package that actually ended up in the bundle — main build and workers —
 * because the minifier drops the license comments from the shipped JavaScript.
 */
const bundledPackages = new Map<string, string>(); // package name -> directory
type Bundle = Record<string, { type: string; moduleIds?: readonly string[]; originalFileNames?: readonly string[] }>;
function collect(bundle: Bundle) {
  for (const out of Object.values(bundle)) {
    for (const id of [...(out.moduleIds ?? []), ...(out.originalFileNames ?? [])]) {
      const path = id.split('?')[0].replace(/\\/g, '/');
      const i = path.lastIndexOf('/node_modules/');
      if (i < 0) continue;
      const parts = path.slice(i + 14).split('/');
      const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      bundledPackages.set(name, `${path.slice(0, i + 14)}${name}`);
    }
  }
}
function collectPackages(): Plugin {
  return { name: 'voltviz-collect-packages', apply: 'build', generateBundle(_, bundle) { collect(bundle); } };
}
function thirdPartyNotices(): Plugin {
  // Packages that ship without a license file; the text comes from their repository.
  const missing: Record<string, string> = {
    'onnxruntime-web': 'MIT License\n\nCopyright (c) Microsoft Corporation\n\n(no license file in the npm package; full text and the notices of the bundled WebAssembly build: https://github.com/microsoft/onnxruntime/blob/main/LICENSE and https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt)',
    'onnxruntime-common': 'MIT License\n\nCopyright (c) Microsoft Corporation\n\n(no license file in the npm package; see https://github.com/microsoft/onnxruntime/blob/main/LICENSE)',
    'guid-typescript': 'ISC License\n\n(no license file in the npm package; see https://github.com/NicolasDeveloper/guid-typescript)',
  };
  return {
    name: 'voltviz-third-party-notices',
    apply: 'build',
    generateBundle(_, bundle) {
      collect(bundle);
      const sections = [...bundledPackages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const files = readdirSync(dir).filter(f => /^(licen[cs]e|notice|copying)/i.test(f)).sort();
        const texts = files.map(f => readFileSync(join(dir, f), 'utf8').trim());
        const license = typeof pkg.license === 'string' ? pkg.license : 'see below';
        return `${'-'.repeat(80)}\n${pkg.name}@${pkg.version} (${license})\n\n${texts.join('\n\n') || missing[name] || '(no license text found)'}\n`;
      });
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-notices.txt',
        source: `${readFileSync(join(import.meta.dirname, 'THIRD_PARTY_NOTICES.md'), 'utf8').trim()}\n\n\n`
          + `npm packages bundled in this build\n${'='.repeat(80)}\n\n${sections.join('\n')}`,
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
    plugins: [react(), tailwindcss(), testAudio(), thirdPartyNotices()],
    worker: {
      plugins: () => [collectPackages()],
    },
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
