/**
 * Live in-app evaluation: plays a slice of a test excerpt through the real app (dev server,
 * `?testAudio=` source, `?probe=1`) for each visualizer and measures
 *   - real-time beat accuracy of the engine as displayed (fired `isBeat` frames vs reference),
 *   - beat-locked visual response (event-related average of frame motion / luminance around
 *     reference beats vs. randomly shifted beat grids, with a bootstrap p-value),
 *   - coupling of the visual activity with the audio level,
 *   - health: not blank, not frozen, no console errors, frame rate.
 *
 *   node scripts/eval/live.ts [--base http://127.0.0.1:3101] [--ids a,b] [--deep] [--out path]
 *
 * Requires the dev server (DISABLE_HMR=true npx vite --port 3101 --strictPort) and system
 * Chrome. Runs one page at a time (memory).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { visualizers } from '../../src/visualizers/registry.ts';
import { fMeasure, median, offsetsMs } from './lib/metrics.ts';

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
const ids = arg('ids', '') ? arg('ids', '').split(',') : visualizers.map(v => v.id);

/** Visualizers whose effects are meant to hit on the beat (engine beat triggers). */
export const BEAT_DRIVEN = new Set(['anunakisphere', 'cybercity', 'aurumleaf', 'fractalorb', 'razor1911', 'icons', 'yourlogo',
  'festivalstage', 'fireworksshow', 'defqonmainstage', 'mossball', 'msdefrag', 'disneydroneshow', 'audiodebug']);

export const DEEP = ['audiodebug', 'cybercity', 'aurumleaf', 'fractalorb', 'festivalstage', 'fireworksshow',
  'defqonmainstage', 'razor1911', 'milkdrop', 'bars'];
export const SEGMENTS = [
  { name: 'steady groove', start: 20 },
  { name: 'break → drop', start: 85 },
  { name: 'full energy', start: 100 },
];

interface Sample {
  t: number; media: number; layer: string; fps: number; isBeat: boolean; bpm: number; conf: number;
  phase: number; kick: boolean; lum: number; motion: number; bass: number; level: number;
}

const ref: { beats: number[] } = JSON.parse(readFileSync(`tests/fixtures/${EXCERPT}.reference.json`, 'utf8'));

/** Event-related average of `values` around `events` (seconds) in [-pre, post) with `bin` width. */
function era(samples: Sample[], key: 'motion' | 'lum', events: number[], pre = 0.2, post = 0.5, bin = 0.02) {
  const n = Math.round((pre + post) / bin);
  const sum = new Float64Array(n);
  const cnt = new Float64Array(n);
  for (const s of samples) {
    for (const e of events) {
      const d = s.media - e;
      if (d < -pre || d >= post) continue;
      const i = Math.floor((d + pre) / bin);
      sum[i] += s[key];
      cnt[i]++;
    }
  }
  return Array.from(sum, (v, i) => (cnt[i] ? v / cnt[i] : NaN));
}

/** Mean of `key` in [0, 150 ms) after events, relative to the overall mean. */
function response(samples: Sample[], key: 'motion' | 'lum', events: number[], signed = false): number {
  let inside = 0, nIn = 0;
  for (const s of samples) {
    for (const e of events) {
      const d = s.media - e;
      if (d >= 0 && d < 0.15) { inside += s[key]; nIn++; break; }
    }
  }
  const all = samples.reduce((a, s) => a + s[key], 0) / samples.length;
  if (!nIn || !all) return NaN;
  return signed ? inside / nIn - all : inside / nIn / all;
}

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Beat-locked response with a bootstrap over randomly phase-shifted beat grids. */
function beatLocked(samples: Sample[], key: 'motion' | 'lum', beats: number[]) {
  const obs = response(samples, key, beats);
  const period = median(beats.slice(1).map((b, i) => b - beats[i])) || 0.46;
  const rand = rng(12345);
  const null_: number[] = [];
  for (let k = 0; k < 200; k++) {
    const shift = (0.15 + 0.7 * rand()) * period; // avoid the true phase
    null_.push(response(samples, key, beats.map(b => b + shift)));
  }
  const valid = null_.filter(v => Number.isFinite(v));
  const nullMean = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
  const p = (valid.filter(v => v >= obs).length + 1) / (valid.length + 1);
  return { ratio: obs / nullMean, raw: obs, p };
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
}

/** Correlation of visual activity with audio level in 250 ms bins. */
function levelCoupling(samples: Sample[]) {
  const bins = new Map<number, { m: number; l: number; lv: number; n: number }>();
  for (const s of samples) {
    const k = Math.floor(s.media / 0.25);
    const b = bins.get(k) ?? { m: 0, l: 0, lv: 0, n: 0 };
    b.m += s.motion; b.l += s.lum; b.lv += s.level; b.n++;
    bins.set(k, b);
  }
  const rows = [...bins.values()].filter(b => b.n > 3);
  const lv = rows.map(b => b.lv / b.n);
  return { motion: pearson(rows.map(b => b.m / b.n), lv), lum: pearson(rows.map(b => b.l / b.n), lv) };
}

async function runOne(browser: Browser, id: string, start: number, shots: boolean) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const url = `${BASE}/?viz=${id}&testAudio=/__testaudio/${EXCERPT}.wav&testAudioStart=${start}&probe=1&transition=instant`;
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__voltviz?.probe?.samples?.length > 5, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Hide UI' }).click().catch(() => {});
  if (shots) await page.evaluate(after => { (window as any).__voltviz.probe.shotPlan = { after, perKind: 2 }; }, start + WARMUP);
  const end = start + WARMUP + SECONDS;
  await page.waitForFunction(e => ((window as any).__voltvizTestAudio?.currentTime ?? 0) >= e, end, { timeout: (WARMUP + SECONDS + 30) * 1000, polling: 500 });
  const data = await page.evaluate(() => {
    const v = (window as any).__voltviz;
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      samples: v.probe.samples as Sample[],
      shots: v.probe.shots as { kind: string; media: number; dataUrl: string }[],
      stats: v.host.stats(),
      renderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    };
  });
  await page.close();

  const from = start + WARMUP;
  const samples = data.samples.filter(s => s.media >= from && s.media < end && s.layer === id);
  const beatsIn = ref.beats.filter(b => b >= from && b < end);
  const fired = samples.filter(s => s.isBeat).map(s => s.media);
  const fps = samples.map(s => s.fps).filter(f => f > 0).sort((a, b) => a - b);
  const motionMean = samples.reduce((a, s) => a + s.motion, 0) / Math.max(1, samples.length);
  const lumMax = Math.max(0, ...samples.map(s => s.lum));
  const beatMotion = beatLocked(samples, 'motion', beatsIn);
  const beatLum = beatLocked(samples, 'lum', beatsIn);
  const coupling = levelCoupling(samples);
  const healthy = samples.length > 100 && lumMax > 0.01 && motionMean > 1e-4 && errors.length === 0;
  const beatDriven = BEAT_DRIVEN.has(id);
  const beatResponse = Math.max(beatMotion.p < 0.05 ? beatMotion.ratio : 0, beatLum.p < 0.05 ? beatLum.ratio : 0);
  const reacts = beatResponse >= 1.1 || Math.max(Math.abs(coupling.motion || 0), Math.abs(coupling.lum || 0)) >= 0.3;
  const pass = healthy && (beatDriven ? beatResponse >= 1.3 : reacts);
  return {
    id, start, frames: samples.length,
    fpsAvg: fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : 0,
    fpsP5: fps.length ? fps[Math.floor(fps.length * 0.05)] : 0,
    errors: errors.slice(0, 5),
    lumMax, motionMean, healthy,
    beat: {
      fired: fired.length, reference: beatsIn.length,
      fMeasure: fMeasure(beatsIn, fired),
      medianOffsetMs: median(offsetsMs(beatsIn, fired)),
    },
    beatMotion, beatLum, coupling, beatDriven, beatResponse, reacts, pass,
    eraMotion: era(samples, 'motion', beatsIn).map(v => +v.toFixed(5)),
    eraLum: era(samples, 'lum', beatsIn).map(v => +v.toFixed(5)),
    shots: shots ? data.shots : undefined,
    renderer: data.renderer,
  };
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !has('headed'),
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'],
});
const results = [];
const plan = has('deep')
  ? ids.filter(id => DEEP.includes(id)).flatMap(id => SEGMENTS.map(seg => ({ id, start: seg.start, segment: seg.name })))
  : ids.map(id => ({ id, start: parseFloat(arg('start', '85')), segment: 'break → drop' }));
for (const job of plan) {
  const t = Date.now();
  try {
    const r = await runOne(browser, job.id, job.start, has('deep'));
    results.push({ ...r, segment: job.segment });
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${job.id.padEnd(26)} @${job.start}s beatF=${r.beat.fMeasure.toFixed(2)} off=${r.beat.medianOffsetMs?.toFixed(0)}ms ` +
      `motion×${r.beatMotion.ratio.toFixed(2)}(p=${r.beatMotion.p.toFixed(3)}) lum×${r.beatLum.ratio.toFixed(2)}(p=${r.beatLum.p.toFixed(3)}) ` +
      `lvl r=${r.coupling.motion.toFixed(2)}/${r.coupling.lum.toFixed(2)} fps=${r.fpsAvg.toFixed(0)} err=${r.errors.length} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  } catch (err) {
    console.log(`ERROR ${job.id}: ${err}`);
    results.push({ id: job.id, start: job.start, segment: job.segment, pass: false, error: String(err) });
  }
}
await browser.close();
mkdirSync('docs/reports/data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), excerpt: EXCERPT, seconds: SECONDS, warmup: WARMUP, results }));
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed -> ${OUT}`);
