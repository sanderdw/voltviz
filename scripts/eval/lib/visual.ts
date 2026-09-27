/**
 * Visual-response statistics for the live evaluation (computed from probe samples).
 */
export interface Sample {
  t: number; media: number; layer: string; fps: number; isBeat: boolean; bpm: number; conf: number; phase: number;
  kick: boolean; lum: number; motion: number; bass: number; level: number; gain: number; spec: number; kickEnv: number;
}

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Mean of `key` per phase bin, folding samples onto the beat grid `beats`. */
function fold(samples: Sample[], key: 'motion' | 'lum', beats: number[], bins: number): number[] {
  const sum = new Float64Array(bins), cnt = new Float64Array(bins);
  let j = 0;
  for (const s of samples) {
    while (j + 1 < beats.length && beats[j + 1] <= s.media) j++;
    if (j + 1 >= beats.length || s.media < beats[j]) continue;
    const ph = (s.media - beats[j]) / (beats[j + 1] - beats[j]);
    const b = Math.min(bins - 1, Math.floor(ph * bins));
    sum[b] += s[key]; cnt[b]++;
  }
  return Array.from(sum, (v, i) => (cnt[i] ? v / cnt[i] : NaN));
}

function depth(profile: number[]): number {
  const v = profile.filter(Number.isFinite);
  if (v.length < 3) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return m > 0 ? (Math.max(...v) - Math.min(...v)) / m : NaN;
}

/**
 * Beat locking: modulation depth of the beat-folded profile, relative to grids in which every
 * beat is independently jittered by up to half a period (which destroys any lock but keeps
 * the sample statistics). Phase-agnostic: a smoothed or delayed reaction still counts.
 */
export function beatLock(samples: Sample[], key: 'motion' | 'lum', beats: number[], bins = 12) {
  const profile = fold(samples, key, beats, bins);
  const obs = depth(profile);
  const rand = rng(4242);
  const periods = beats.slice(1).map((b, i) => b - beats[i]);
  const null_: number[] = [];
  for (let k = 0; k < 200; k++) {
    const jit = beats.map((b, i) => b + (rand() - 0.5) * (periods[Math.min(i, periods.length - 1)] ?? 0.46)).sort((a, b) => a - b);
    const d = depth(fold(samples, key, jit, bins));
    if (Number.isFinite(d)) null_.push(d);
  }
  const med = [...null_].sort((a, b) => a - b)[null_.length >> 1];
  const p = (null_.filter(v => v >= obs).length + 1) / (null_.length + 1);
  const peakBin = profile.indexOf(Math.max(...profile.filter(Number.isFinite)));
  const period = periods.length ? periods.reduce((a, b) => a + b, 0) / periods.length : 0.46;
  return { ratio: obs / med, depth: obs, p, peakMs: Math.round(((peakBin + 0.5) / bins) * period * 1000), profile: profile.map(v => +v.toFixed(5)) };
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
}

const VISUAL = ['lum', 'motion'] as const;
const AUDIO = ['level', 'bass', 'spec', 'kickEnv'] as const;

/**
 * Audio coupling: the strongest correlation (in 250 ms bins) between a visual feature and an
 * audio feature. Significance by circularly shifting the visual series against the audio
 * (>= 2 s), taking the same max over all pairs in every draw (controls for trying 8 pairs).
 */
export function coupling(samples: Sample[]) {
  const bins = new Map<number, Sample[]>();
  for (const s of samples) {
    const k = Math.floor(s.media / 0.25);
    const b = bins.get(k) ?? [];
    b.push(s);
    bins.set(k, b);
  }
  const rows = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b).filter(b => b.length >= 2);
  const avg = (b: Sample[], k: keyof Sample) => b.reduce((a, s) => a + (s[k] as number), 0) / b.length;
  const vis = VISUAL.map(k => rows.map(b => avg(b, k)));
  const aud = AUDIO.map(k => rows.map(b => avg(b, k)));
  const best = (shift: number) => {
    let m = 0, which = '';
    VISUAL.forEach((vk, i) => AUDIO.forEach((ak, j) => {
      const v = shift ? vis[i].map((_, t) => vis[i][(t + shift) % vis[i].length]) : vis[i];
      const r = pearson(v, aud[j]);
      if (Number.isFinite(r) && Math.abs(r) > Math.abs(m)) { m = r; which = `${vk}~${ak}`; }
    }));
    return { r: m, which };
  };
  const obs = best(0);
  const n = rows.length;
  const rand = rng(777);
  let ge = 0, draws = 0;
  if (n > 20) {
    for (let k = 0; k < 300; k++) {
      const shift = 8 + Math.floor(rand() * (n - 16));
      if (Math.abs(best(shift).r) >= Math.abs(obs.r)) ge++;
      draws++;
    }
  }
  return { r: obs.r, which: obs.which, p: draws ? (ge + 1) / (draws + 1) : 1, bins: n };
}
