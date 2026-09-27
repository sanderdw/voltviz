import { FFT, hannWindow } from '../core/fft.ts';
import { Resampler } from './resampler.ts';

/**
 * Streaming log-mel spectrogram identical in definition to beat_this's `LogMelSpect`
 * (torchaudio MelSpectrogram: 22.05 kHz, n_fft 1024, hop 441 = 50 fps, periodic Hann,
 * centred frames, "frame_length" normalization, magnitude, 128 Slaney mels 30 Hz - 11 kHz,
 * then log1p(1000 x)). Parity with the Python implementation is checked by
 * scripts/eval/neural-parity.ts.
 */
export const MODEL_SR = 22050;
export const N_FFT = 1024;
export const HOP = 441;
export const N_MELS = 128;
export const MODEL_FPS = MODEL_SR / HOP; // 50

const F_MIN = 30;
const F_MAX = 11000;

function hzToMelSlaney(f: number): number {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : f / fSp;
}

function melToHzSlaney(m: number): number {
  const fSp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fSp * m;
}

/** torchaudio.functional.melscale_fbanks(513, 30, 11000, 128, 22050, norm=None, "slaney"). */
export function melFilterbank(): { start: Int32Array; weights: Float64Array[] } {
  const nFreqs = N_FFT / 2 + 1;
  const allFreqs = Array.from({ length: nFreqs }, (_, i) => (i * Math.floor(MODEL_SR / 2)) / (nFreqs - 1));
  const mMin = hzToMelSlaney(F_MIN);
  const mMax = hzToMelSlaney(F_MAX);
  const fPts = Array.from({ length: N_MELS + 2 }, (_, i) => melToHzSlaney(mMin + ((mMax - mMin) * i) / (N_MELS + 1)));
  const start = new Int32Array(N_MELS);
  const weights: Float64Array[] = [];
  for (let m = 0; m < N_MELS; m++) {
    const lo = fPts[m], c = fPts[m + 1], hi = fPts[m + 2];
    const row: number[] = [];
    let first = -1;
    for (let k = 0; k < nFreqs; k++) {
      const f = allFreqs[k];
      const down = (f - lo) / (c - lo);
      const up = (hi - f) / (hi - c);
      const w = Math.max(0, Math.min(down, up));
      if (w > 0) {
        if (first < 0) first = k;
        row[k - first] = w;
      } else if (first >= 0) break;
    }
    start[m] = Math.max(0, first);
    weights.push(Float64Array.from(row.map(v => v ?? 0)));
  }
  return { start, weights };
}

export class MelFrontend {
  /** Number of mel frames retained (the model window plus slack). */
  readonly capacity: number;
  /** Absolute index of the next mel frame; frame i is centred at time i / MODEL_FPS. */
  frames = 0;

  private readonly resampler: Resampler | null;
  private readonly fft = new FFT(N_FFT);
  private readonly window = hannWindow(N_FFT);
  private readonly re = new Float64Array(N_FFT);
  private readonly im = new Float64Array(N_FFT);
  private readonly mel = melFilterbank();
  private readonly ring: Float32Array; // capacity x N_MELS
  // resampled audio history (enough for one frame plus the reflect padding at the start)
  private readonly audio = new Float64Array(8192);
  private audioCount = 0;
  private readonly emitFn: (v: number) => void;

  constructor(inputRate: number, capacityFrames = 600) {
    this.capacity = capacityFrames;
    this.ring = new Float32Array(capacityFrames * N_MELS);
    this.resampler = inputRate === MODEL_SR ? null : new Resampler(inputRate, MODEL_SR);
    this.emitFn = v => this.pushModelRate(v);
  }

  push(input: ArrayLike<number>, length: number = input.length): void {
    if (this.resampler) this.resampler.push(input, length, this.emitFn);
    else for (let i = 0; i < length; i++) this.pushModelRate(input[i]);
  }

  private sample(i: number): number {
    // reflect padding before the start of the stream (torch.stft center=True, pad_mode reflect)
    if (i < 0) i = -i;
    return this.audio[i & 8191];
  }

  private pushModelRate(v: number): void {
    this.audio[this.audioCount & 8191] = v;
    this.audioCount++;
    // frame f is centred at sample f*HOP and needs samples up to f*HOP + N_FFT/2 - 1
    while (this.frames * HOP + N_FFT / 2 <= this.audioCount) this.computeFrame(this.frames++);
  }

  private computeFrame(f: number): void {
    const c = f * HOP - N_FFT / 2;
    const re = this.re, im = this.im, w = this.window;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = this.sample(c + i) * w[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);
    const norm = 1 / Math.sqrt(N_FFT);
    const out = (f % this.capacity) * N_MELS;
    const { start, weights } = this.mel;
    for (let m = 0; m < N_MELS; m++) {
      const ws = weights[m];
      const s = start[m];
      let acc = 0;
      for (let j = 0; j < ws.length; j++) {
        const k = s + j;
        acc += ws[j] * Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm;
      }
      this.ring[out + m] = Math.log1p(1000 * acc);
    }
  }

  /**
   * Copy the most recent `n` frames (oldest first) into `out` (n x 128, row-major) and
   * return the absolute index of the first copied frame, or -1 if not enough frames yet.
   */
  latest(n: number, out: Float32Array): number {
    if (this.frames < n || n > this.capacity) return -1;
    const first = this.frames - n;
    for (let i = 0; i < n; i++) {
      const src = ((first + i) % this.capacity) * N_MELS;
      out.set(this.ring.subarray(src, src + N_MELS), i * N_MELS);
    }
    return first;
  }
}
