/**
 * Live in-app evaluation: plays a slice of a test excerpt through the real app (dev server,
 * `?testAudio=` source, `?probe=1`) for each visualizer and measures
 *   - real-time beat accuracy of the engine as displayed (fired `isBeat` frames vs reference),
 *   - beat locking of the picture (modulation depth of the beat-folded frame motion /
 *     luminance vs. independently jittered beat grids),
 *   - coupling of the picture to the audio (best correlation of a visual feature with an audio
 *     feature, circular-shift permutation test),
 *   - health (renders, moves, no console errors) and a clean frame rate (canvas readback off).
 * Raw per-frame data is kept in .cache/eval/live-raw/ so metrics can be recomputed with
 * `--reanalyze` without a browser.
 *
 *   node scripts/eval/live.ts [--base http://127.0.0.1:3101] [--ids a,b] [--deep] [--out path] [--reanalyze]
 *
 * Requires the dev server (DISABLE_HMR=true npx vite --port 3101 --strictPort) and system
 * Chrome. Runs one page at a time (memory).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { visualizers } from '../../src/visualizers/registry.ts';
import { fMeasure, median, offsetsMs } from './lib/metrics.ts';
import { beatLock, coupling, type Sample } from './lib/visual.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const BASE = arg('base', 'http://127.0.0.1:3101');
const EXCERPT = arg('excerpt', 'uto-0-120');
const OUT = arg('out', has('deep') ? 'docs/reports/data/live-deep.json' : 'docs/reports/data/live-all.json');
const SECONDS = parseFloat(arg('seconds', '20'));
const WARMUP = parseFloat(arg('warmup', '8'));
const RAW = '.cache/eval/live-raw';
const ids = arg('ids', '') ? arg('ids', '').split(',') : visualizers.map(v => v.id);

/** Visualizers whose effects are meant to hit on the beat (engine beat triggers). */
export const BEAT_DRIVEN = new Set(['anunakisphere', 'cybercity', 'aurumleaf', 'fractalorb', 'razor1911', 'icons', 'yourlogo',
  'festivalstage', 'fireworksshow', 'defqonmainstage', 'mossball', 'msdefrag', 'disneydroneshow', 'audiodebug', 'halftonepulse']);
/** Visualizers that show nothing until the user uploads something (the harness uploads). */
const UPLOADS: Record<string, string> = {
  yourlogo: 'src/images/GitHub_Invertocat_White.svg',
  glitchbackground: 'images/dummycover.png', // shows only an "UPLOAD IMAGE" caption without one
  blurimage: 'images/dummycover.png', // same
};

export const DEEP = ['audiodebug', 'cybercity', 'aurumleaf', 'fractalorb', 'festivalstage', 'fireworksshow',
  'defqonmainstage', 'razor1911', 'milkdrop', 'bars'];
export const SEGMENTS = [
  { name: 'steady groove', start: 20 },
  { name: 'pickup section', start: 45 },
  { name: 'break → drop', start: 85 },
];

const ref: { beats: number[] } = JSON.parse(readFileSync(`tests/fixtures/${EXCERPT}.reference.json`, 'utf8'));

interface Raw {
  id: string; start: number; samples: Sample[]; errors: string[]; fpsClean: number;
  shots: { kind: string; media: number; dataUrl: string }[]; renderer: string | null;
}

async function capture(browser: Browser, id: string, start: number, shots: boolean): Promise<Raw> {
  const end = start + WARMUP + SECONDS;
  const excerptSeconds = JSON.parse(readFileSync('scripts/eval/excerpts.json', 'utf8')).excerpts.find((e: { id: string }) => e.id === EXCERPT)?.seconds ?? 120;
  if (end > excerptSeconds - 0.5) throw new Error(`segment ${start}+${WARMUP}+${SECONDS}s runs past the ${excerptSeconds}s excerpt`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(`${BASE}/?viz=${id}&testAudio=/__testaudio/${EXCERPT}.wav&testAudioStart=${start}&probe=1&transition=instant&aibeat=1`);
    await page.waitForFunction(() => (window as any).__voltviz?.probe?.samples?.length > 5, null, { timeout: 30000 });
    if (UPLOADS[id]) await page.locator('input[type=file]').first().setInputFiles(UPLOADS[id]);
    await page.locator('header').getByRole('button', { name: 'Hide UI' }).click().catch(() => {});
    if (shots) await page.evaluate(after => { (window as any).__voltviz.probe.shotPlan = { after, perKind: 2 }; }, start + WARMUP);
    await page.waitForFunction(e => ((window as any).__voltvizTestAudio?.currentTime ?? 0) >= e, end, { timeout: (WARMUP + SECONDS + 30) * 1000, polling: 500 });
    const data = await page.evaluate(() => {
      const v = (window as any).__voltviz;
      const gl = document.createElement('canvas').getContext('webgl');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      const out = {
        samples: v.probe.samples.slice(),
        shots: v.probe.shots.slice(),
        renderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      };
      v.probe.canvasSampling = false; // measure the frame rate without the readback cost
      return out;
    });
    await page.waitForTimeout(4000);
    const fpsClean = await page.evaluate(id2 => ((window as any).__voltviz.host.stats().find((s: { id: string }) => s.id === id2)?.fps ?? 0), id);
    return { id, start, samples: data.samples, errors, fpsClean, shots: data.shots, renderer: data.renderer };
  } finally {
    // never leave a page running: an abandoned page keeps playing and rendering
    await page.close().catch(() => {});
  }
}

function analyze(raw: Raw, withShots: boolean) {
  const { id, start } = raw;
  const from = start + WARMUP, end = start + WARMUP + SECONDS;
  const samples = raw.samples.filter(s => s.media >= from && s.media < end && s.layer === id);
  const beatsIn = ref.beats.filter(b => b >= from && b < end);
  const beatsGrid = ref.beats.filter(b => b >= from - 1 && b < end + 1);
  const fired = samples.filter(s => s.isBeat).map(s => s.media);
  const fps = samples.map(s => s.fps).filter(f => f > 0);
  const motionMean = samples.reduce((a, s) => a + s.motion, 0) / Math.max(1, samples.length);
  const lumMax = Math.max(0, ...samples.map(s => s.lum));
  const lockMotion = beatLock(samples, 'motion', beatsGrid);
  const lockLum = beatLock(samples, 'lum', beatsGrid);
  const coup = coupling(samples);
  const healthy = samples.length > 100 && lumMax > 0.01 && motionMean > 1e-4 && raw.errors.length === 0;
  const beatDriven = BEAT_DRIVEN.has(id);
  const sig = (l: { ratio: number; p: number }) => (l.p < 0.05 && Number.isFinite(l.ratio) ? l.ratio : 0);
  const lock = Math.max(sig(lockMotion), sig(lockLum));
  const coupled = coup.p < 0.05 && Math.abs(coup.r) >= 0.25;
  const pass = healthy && (beatDriven ? lock >= 1.3 : lock >= 1.1 || coupled);
  const why = !healthy ? (raw.errors.length ? 'console errors' : lumMax <= 0.01 ? 'blank' : 'frozen')
    : pass ? (lock >= (beatDriven ? 1.3 : 1.1) ? 'beat-locked' : `follows ${coup.which}`)
      : beatDriven ? 'beat not visible' : 'no audio coupling found';
  return {
    id, start, seconds: SECONDS, frames: samples.length,
    fpsProbe: fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : 0,
    fpsClean: raw.fpsClean,
    errors: raw.errors.slice(0, 5),
    lumMax, motionMean, healthy,
    beat: { fired: fired.length, reference: beatsIn.length, fMeasure: fMeasure(beatsIn, fired), medianOffsetMs: median(offsetsMs(beatsIn, fired)) },
    lockMotion, lockLum, lock, coupling: coup, coupled, beatDriven, pass, why,
    shots: withShots ? raw.shots : undefined,
    renderer: raw.renderer,
  };
}

const plan = has('deep')
  ? ids.filter(id => DEEP.includes(id)).flatMap(id => SEGMENTS.map(seg => ({ id, start: seg.start, segment: seg.name })))
  : ids.map(id => ({ id, start: parseFloat(arg('start', '85')), segment: 'break → drop' }));
mkdirSync(RAW, { recursive: true });
const rawPath = (id: string, start: number) => `${RAW}/${EXCERPT}-${id}-${start}.json`;

let browser: Browser | null = null;
if (!has('reanalyze')) {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: !has('headed'),
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'],
  });
}
const results = [];
for (const job of plan) {
  const t = Date.now();
  try {
    let raw: Raw;
    if (browser) {
      raw = await capture(browser, job.id, job.start, has('deep'));
      writeFileSync(rawPath(job.id, job.start), JSON.stringify(raw));
    } else {
      if (!existsSync(rawPath(job.id, job.start))) { console.log(`skip ${job.id} (no raw data)`); continue; }
      raw = JSON.parse(readFileSync(rawPath(job.id, job.start), 'utf8'));
    }
    const r = analyze(raw, has('deep'));
    results.push({ ...r, segment: job.segment });
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${job.id.padEnd(26)} @${job.start}s ${r.why.padEnd(24)} beatF=${r.beat.fMeasure.toFixed(2)} ` +
      `lock m×${r.lockMotion.ratio.toFixed(2)}(p=${r.lockMotion.p.toFixed(3)}) l×${r.lockLum.ratio.toFixed(2)}(p=${r.lockLum.p.toFixed(3)}) ` +
      `r=${r.coupling.r.toFixed(2)} ${r.coupling.which}(p=${r.coupling.p.toFixed(3)}) fps=${r.fpsClean.toFixed(0)}/${r.fpsProbe.toFixed(0)} err=${r.errors.length} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  } catch (err) {
    console.log(`ERROR ${job.id}: ${err}`);
    results.push({ id: job.id, start: job.start, segment: job.segment, pass: false, error: String(err) });
  }
}
await browser?.close();
mkdirSync('docs/reports/data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), excerpt: EXCERPT, seconds: SECONDS, warmup: WARMUP, results }));
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed -> ${OUT}`);
