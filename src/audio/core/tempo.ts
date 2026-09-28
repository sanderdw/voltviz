import { FFT } from './fft.ts';
import type { FrameHistory } from './ring.ts';

export interface TempoCandidate {
  /** Beat period in frames (fractional). */
  period: number;
  bpm: number;
  /** Normalized autocorrelation at the chosen period, ~0 for noise, 0.3+ for a clear pulse. */
  salience: number;
}

export interface TempoOptions {
  frameRate: number;
  windowS?: number;
  minBpm?: number;
  maxBpm?: number;
  /** Centre of the log-Gaussian tempo prior (dance music). */
  priorBpm?: number;
  /** Width of the prior in octaves. */
  priorOctaves?: number;
}

/**
 * Tempo from the autocorrelation of the onset function over the last few seconds.
 * Each candidate lag L is scored by harmonic summation sum_k ACF(kL)/k (a real beat
 * period is reinforced by its multiples, a too-fast one is not), weighted by a
 * log-Gaussian prior that resolves the remaining octave ambiguity (e.g. 65 vs 130 BPM).
 */
export class TempoEstimator {
  readonly frameRate: number;
  private readonly n: number;
  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly priorBpm: number;
  private readonly priorOct: number;
  private readonly fft: FFT;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly buf: Float64Array;
  private readonly acf: Float64Array;
  private readonly score: Float64Array;

  constructor(o: TempoOptions) {
    this.frameRate = o.frameRate;
    this.n = Math.round((o.windowS ?? 8) * o.frameRate);
    this.minLag = Math.floor((60 / (o.maxBpm ?? 200)) * o.frameRate);
    this.maxLag = Math.ceil((60 / (o.minBpm ?? 60)) * o.frameRate);
    this.priorBpm = o.priorBpm ?? 128;
    this.priorOct = o.priorOctaves ?? 0.7;
    let m = 1;
    while (m < 2 * this.n) m <<= 1;
    this.fft = new FFT(m);
    this.re = new Float64Array(m);
    this.im = new Float64Array(m);
    this.buf = new Float64Array(this.n);
    this.acf = new Float64Array(this.n);
    this.score = new Float64Array(this.maxLag + 2);
  }

  /** Minimum number of frames of history before estimates are meaningful. */
  get warmupFrames(): number {
    return Math.round(this.n * 0.5);
  }

  /** Length of the analysis window (frames). */
  get windowFrames(): number {
    return this.n;
  }

  /** Tempo of the latest window; `recent` limits it to that many frames (the new song's). */
  estimate(odf: FrameHistory, recent = Infinity): TempoCandidate | null {
    const n = this.n;
    const avail = Math.min(n, odf.count, recent);
    if (avail < this.warmupFrames) return null;
    const buf = this.buf;
    odf.latest(n, buf);
    // zero-mean the available part (missing history reads as 0 and stays 0)
    let mean = 0;
    for (let i = n - avail; i < n; i++) mean += buf[i];
    mean /= avail;
    const re = this.re;
    const im = this.im;
    re.fill(0);
    im.fill(0);
    for (let i = n - avail; i < n; i++) re[i - (n - avail)] = buf[i] - mean;
    this.fft.transform(re, im);
    for (let i = 0; i < re.length; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    this.fft.inverse(re, im);
    const acf = this.acf;
    const zero = re[0] / avail;
    if (zero <= 1e-12) return null;
    for (let l = 0; l < avail; l++) acf[l] = re[l] / (avail - l) / zero; // unbiased, normalized
    for (let l = avail; l < n; l++) acf[l] = 0;

    const maxLag = Math.min(this.maxLag, Math.floor((avail - 1) / 2));
    let best = -1;
    let bestScore = -Infinity;
    const score = this.score;
    score.fill(0);
    for (let lag = this.minLag; lag <= maxLag; lag++) {
      let s = 0;
      let wsum = 0;
      for (let k = 1; k <= 4; k++) {
        const kl = k * lag;
        if (kl >= avail - 1) break;
        // tolerate +-1 frame of jitter at the harmonics
        const a = Math.max(acf[kl - 1], acf[kl], acf[kl + 1]);
        s += a / k;
        wsum += 1 / k;
      }
      if (wsum === 0) continue;
      // Sub-beat support: a real beat period usually has a periodic subdivision (off-beat
      // hats, eighths). This separates the true tempo from 3:2 relatives such as 116 vs
      // 174 BPM, whose "half period" falls between the events.
      const half = lag / 2;
      const h0 = Math.floor(half);
      const sub = Math.max(0, Math.max(acf[h0], acf[h0 + 1]));
      s = (s + 0.5 * sub) / (wsum + 0.5);
      const bpm = (60 * this.frameRate) / lag;
      const oct = Math.log2(bpm / this.priorBpm) / this.priorOct;
      const weighted = Math.max(0, s) * Math.exp(-0.5 * oct * oct);
      score[lag] = weighted;
      if (weighted > bestScore) {
        bestScore = weighted;
        best = lag;
      }
    }
    if (best < 0 || bestScore <= 0) return null;
    // A beat period must itself repeat. Half-time drums (hits on every other beat only) give a
    // lag at which nothing repeats harmonic support from 2L and 4L, and a prior centred above
    // the hit rate can then prefer it: take the lag at which the hits actually repeat. Only
    // when practically nothing repeats at L: a weak repetition (a pickup before every other
    // beat, 0.15-0.2 on the DJ mix) is still the beat.
    const atBest = this.peakNear(best, 1).value;
    if (2 * best <= maxLag && atBest < 0.08 && atBest < 0.3 * this.peakNear(2 * best, 2).value) best *= 2;
    const salience = Math.max(0, this.peakNear(best, 1).value);
    // Refine the period on the highest harmonic still inside the window: a peak located at
    // k*L with +-0.5 frame error gives L to within +-0.5/k frames.
    let k = 4;
    while (k > 1 && k * best + 2 >= avail - 1) k--;
    const refined = this.peakNear(k * best, Math.max(1, k));
    const period = refined.pos / k;
    return { period, bpm: (60 * this.frameRate) / period, salience };
  }

  /**
   * Score of the latest estimate at a beat period (frames): the prior-weighted harmonic score
   * (best within +-1 frame) and the raw normalized autocorrelation there. 0 outside the range.
   */
  scoreAt(period: number): { score: number; acf: number } {
    const lag = Math.round(period);
    if (lag - 1 < this.minLag || lag + 1 >= this.score.length) return { score: 0, acf: 0 };
    return {
      score: Math.max(this.score[lag - 1], this.score[lag], this.score[lag + 1]),
      acf: Math.max(this.acf[lag - 1], this.acf[lag], this.acf[lag + 1]),
    };
  }

  /** Parabolic-interpolated ACF peak within +-radius frames of `center`. */
  private peakNear(center: number, radius: number): { pos: number; value: number } {
    const acf = this.acf;
    let peak = center;
    for (let l = center - radius; l <= center + radius; l++) {
      if (l > 0 && l < acf.length - 1 && acf[l] > acf[peak]) peak = l;
    }
    const y0 = acf[peak - 1], y1 = acf[peak], y2 = acf[peak + 1];
    const denom = y0 - 2 * y1 + y2;
    const frac = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
    return { pos: peak + frac, value: y1 };
  }
}
