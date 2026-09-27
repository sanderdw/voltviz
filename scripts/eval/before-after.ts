/**
 * Before/after comparison of the beat-driven visualizers: the pre-rewrite app (a build of
 * `main`) against the new app, fed with the same audio through the same path (Chrome's fake
 * microphone playing a WAV slice) and measured the same way (an injected script samples the
 * canvases right after every animation frame; no app instrumentation needed).
 *
 * The measure is the beat-locked visual response: the event-related average of frame motion
 * around the reference beats. Because the fake-capture start offset is not known exactly, the
 * response is taken as the best 150 ms window between -100 and +250 ms (the lag is reported).
 *
 *   node scripts/eval/before-after.ts --old http://127.0.0.1:3102 --new http://127.0.0.1:3101
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const OLD = arg('old', 'http://127.0.0.1:3102');
const NEW = arg('new', 'http://127.0.0.1:3101');
const EXCERPT = 'uto-0-120';
const ALL_SLICES = [{ name: 'steady groove', start: 20 }, { name: 'full energy', start: 90 }];
const SLICES = ALL_SLICES.filter(s => !arg('slices', '') || arg('slices', '').split(',').includes(String(s.start)));
const OUT = arg('out', 'docs/reports/data/before-after.json');
const SECONDS = 30;
const SKIP = 8; // seconds to let both apps settle
const IDS = arg('ids', 'audiodebug,cybercity,aurumleaf,fractalorb,festivalstage,fireworksshow,defqonmainstage,razor1911,milkdrop,bars').split(',');
const ref: { beats: number[] } = JSON.parse(readFileSync(`tests/fixtures/${EXCERPT}.reference.json`, 'utf8'));

const probe = () => {
  const W = 32, H = 18;
  const w = window as unknown as { __ba: { t0: number; samples: { t: number; lum: number; motion: number }[] } };
  w.__ba = { t0: -1, samples: [] };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
    const s = await gum(c);
    w.__ba.t0 = performance.now();
    return s;
  };
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  let prevFrame: Float32Array | null = null; // final thumbnail of the previous frame
  let lastThumb: Float32Array | null = null;
  let lastTs = -1;
  const sample = (ts: number) => {
    if (w.__ba.t0 < 0) return;
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, W, H);
    const main = document.querySelector('main');
    if (!main) return;
    const box = main.getBoundingClientRect();
    for (const c of main.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      try { cx.drawImage(c, ((r.left - box.left) / box.width) * W, ((r.top - box.top) / box.height) * H, (r.width / box.width) * W, (r.height / box.height) * H); } catch { /* ignore */ }
    }
    if (ts !== lastTs) prevFrame = lastThumb;
    const px = cx.getImageData(0, 0, W, H).data;
    const cur = new Float32Array(W * H);
    let lum = 0, motion = 0;
    for (let i = 0; i < W * H; i++) {
      const v = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      cur[i] = v; lum += v;
      if (prevFrame) motion += Math.abs(v - prevFrame[i]);
    }
    const s = { t: ts, lum: lum / (W * H), motion: prevFrame ? motion / (W * H) : 0 };
    // several rAF callbacks can run in one frame: the last one (after all drawing) wins
    if (ts === lastTs) w.__ba.samples[w.__ba.samples.length - 1] = s;
    else w.__ba.samples.push(s);
    lastThumb = cur;
    lastTs = ts;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => raf(ts => { cb(ts); sample(ts); });
};

/** RMS of the slice audio in 250 ms bins (seconds relative to the slice start). */
function levelBins(wav: string): number[] {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-af', 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = 2000;
  const out: number[] = [];
  for (let i = 0; i + n <= x.length; i += n) { let s = 0; for (let k = i; k < i + n; k++) s += x[k] * x[k]; out.push(Math.sqrt(s / n)); }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
}

function coupling(samples: { media: number; motion: number; lum: number }[], sliceStart: number, levels: number[]) {
  const bins = new Map<number, { m: number; l: number; n: number }>();
  for (const s of samples) {
    const k = Math.floor((s.media - sliceStart) / 0.25);
    const b = bins.get(k) ?? { m: 0, l: 0, n: 0 };
    b.m += s.motion; b.l += s.lum; b.n++;
    bins.set(k, b);
  }
  const keys = [...bins.keys()].filter(k => k >= 0 && k < levels.length && bins.get(k)!.n >= 1).sort((a, b) => a - b);
  const lv = keys.map(k => levels[k]);
  return {
    motion: pearson(keys.map(k => bins.get(k)!.m / bins.get(k)!.n), lv),
    lum: pearson(keys.map(k => bins.get(k)!.l / bins.get(k)!.n), lv),
  };
}

function responseCurve(samples: { media: number; motion: number }[], beats: number[], pre = 0.3, post = 0.5, bin = 0.02) {
  const n = Math.round((pre + post) / bin);
  const sum = new Float64Array(n), cnt = new Float64Array(n);
  for (const s of samples) for (const b of beats) {
    const d = s.media - b;
    if (d >= -pre && d < post) { const i = Math.floor((d + pre) / bin); sum[i] += s.motion; cnt[i]++; }
  }
  const mean = samples.reduce((a, s) => a + s.motion, 0) / Math.max(1, samples.length);
  const curve = Array.from(sum, (v, i) => (cnt[i] ? v / cnt[i] / mean : NaN));
  // best 150 ms window (7-8 bins) starting between -100 and +250 ms
  let best = -Infinity, lag = 0;
  const w = Math.round(0.15 / bin);
  for (let s0 = Math.round((pre - 0.1) / bin); s0 <= Math.round((pre + 0.25) / bin); s0++) {
    let v = 0, c = 0;
    for (let i = s0; i < s0 + w && i < n; i++) if (Number.isFinite(curve[i])) { v += curve[i]; c++; }
    if (c && v / c > best) { best = v / c; lag = s0 * bin - pre; }
  }
  return { curve: curve.map(v => +v.toFixed(3)), peak: best, lagMs: Math.round(lag * 1000) };
}

const results = [];
for (const slice of SLICES) {
  const wav = `.cache/test-audio/${EXCERPT}_${slice.start}-${slice.start + SECONDS + 5}.wav`;
  if (!existsSync(wav)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(slice.start), '-t', String(SECONDS + 5), '-i', `.cache/test-audio/${EXCERPT}.wav`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', wav]);
  const levels = levelBins(wav);
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`,
      '--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  for (const id of IDS) {
    for (const [app, base] of [['before', OLD], ['after', NEW]] as const) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      let data: { t0: number; samples: { t: number; lum: number; motion: number }[] };
      try {
        await page.addInitScript(probe);
        // The new app runs with its defaults (AI beat tracking on).
        await page.goto(`${base}/?viz=${id}`);
        await page.getByRole('button', { name: 'Microphone' }).click();
        await page.locator('header').getByRole('button', { name: 'Hide UI' }).click().catch(() => {});
        await page.waitForTimeout((SECONDS + 1) * 1000);
        data = await page.evaluate(() => (window as unknown as { __ba: { t0: number; samples: { t: number; lum: number; motion: number }[] } }).__ba);
      } finally {
        await page.close().catch(() => {});
      }
      const samples = data.samples.map(s => ({ media: slice.start + (s.t - data.t0) / 1000, motion: s.motion, lum: s.lum }))
        .filter(s => s.media >= slice.start + SKIP && s.media < slice.start + SECONDS);
      const beats = ref.beats.filter(b => b >= slice.start + SKIP && b < slice.start + SECONDS);
      const r = responseCurve(samples, beats);
      const c = coupling(samples, slice.start, levels);
      const fps = samples.length / (SECONDS - SKIP);
      results.push({ id, app, slice: slice.name, frames: samples.length, fps, coupling: c, ...r });
      console.log(`${slice.name.padEnd(14)} ${id.padEnd(18)} ${app.padEnd(6)} peak ×${r.peak.toFixed(2)} @ ${r.lagMs} ms  r=${c.motion.toFixed(2)}/${c.lum.toFixed(2)} fps=${fps.toFixed(0)}`);
    }
  }
  await browser.close();
}
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), seconds: SECONDS, skip: SKIP, results }));
