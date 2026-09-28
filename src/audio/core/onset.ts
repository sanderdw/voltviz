import { Biquad } from './biquad.ts';
import { FFT, hannWindow } from './fft.ts';

/** Per-hop features produced by {@link OnsetFeatures}. */
export interface OnsetFrame {
  /** Broadband log spectral flux (all bands). */
  broad: number;
  /** Kick onset strength: rise of the 35-150 Hz time-domain envelope out of silence/sidechain gaps. */
  kick: number;
  /**
   * Mid-band flux, 150 Hz - 6 kHz: kick clicks, claps and snares. This is the most reliable
   * beat-phase cue: sub-bass onsets are fooled by pickups / rolling basslines and the band
   * above 6 kHz by off-beat hats (see docs/reports/audio-engine-report.html).
   */
  mid: number;
  /** Hi-hat / cymbal flux, 6 kHz and up. */
  hat: number;
  /**
   * Rise of the *linear* energy in the snare band (1-5 kHz) and in the kick band (35-150 Hz)
   * over the last 2-3 hops. Linear, unlike the log-domain functions above, so a loud snare or
   * kick stands out against hi-hats and a wobble bass: used for the bar-level half-time
   * signature, not for the beat phase.
   */
  snareRise: number;
  kickRise: number;
  /** RMS and peak of the raw hop. */
  rms: number;
  peak: number;
}

/** Frame rate the whole core runs at, independent of the sample rate (~5.8 ms hops). */
export const TARGET_FRAME_RATE = 172.265625;

export function hopSizeFor(sampleRate: number): number {
  return Math.round(sampleRate / TARGET_FRAME_RATE);
}

const FFT_SIZE = 1024;
/** Log compression: flux is a difference of logs, so onsets are loudness-invariant. */
const LOG_GAMMA = 1000;
/** Compare against the frame `FLUX_LAG` hops back (~11.6 ms) - sharper than consecutive frames. */
const FLUX_LAG = 2;
const KICK_LAG = 3;

/**
 * Onset features computed once per hop. Spectral bands use a 1024-point Hann FFT with
 * quarter-octave log bands and SuperFlux-style max filtering of the reference frame. The
 * kick function works in the time domain because a 1024-point FFT has only ~3 bins below
 * 150 Hz; an IIR band gives both better timing and a cleaner "rise out of the sidechain gap".
 */
export class OnsetFeatures {
  readonly sampleRate: number;
  readonly hop: number;
  readonly frameRate: number;

  private readonly fft = new FFT(FFT_SIZE);
  private readonly window = hannWindow(FFT_SIZE);
  private readonly input = new Float64Array(FFT_SIZE);
  private readonly re = new Float64Array(FFT_SIZE);
  private readonly im = new Float64Array(FFT_SIZE);
  private readonly bandStart: Int32Array;
  private readonly bandEnd: Int32Array;
  private readonly bandHz: Float64Array;
  private readonly logBands: Float64Array[];
  private readonly maxFiltered: Float64Array;
  private frame = 0;

  private readonly kickHp: Biquad;
  private readonly kickLp1: Biquad;
  private readonly kickLp2: Biquad;
  private readonly kickLog: Float64Array;
  private readonly kickLin: Float64Array;
  private readonly snareLin: Float64Array;
  private readonly snareBins: [number, number];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.hop = hopSizeFor(sampleRate);
    this.frameRate = sampleRate / this.hop;

    // Quarter-octave bands from bin 1 up to 16 kHz; every band has at least one bin.
    const binHz = sampleRate / FFT_SIZE;
    const lastBin = Math.min(FFT_SIZE / 2 - 1, Math.floor(16000 / binHz));
    const starts: number[] = [];
    const ends: number[] = [];
    let b = 1;
    while (b <= lastBin) {
      const e = Math.min(lastBin + 1, Math.max(b + 1, Math.round(b * Math.pow(2, 0.25))));
      starts.push(b);
      ends.push(e);
      b = e;
    }
    this.bandStart = Int32Array.from(starts);
    this.bandEnd = Int32Array.from(ends);
    this.bandHz = Float64Array.from(starts.map((s, i) => ((s + ends[i] - 1) / 2) * binHz));
    const n = starts.length;
    this.logBands = Array.from({ length: FLUX_LAG + 1 }, () => new Float64Array(n));
    this.maxFiltered = new Float64Array(n);

    this.kickHp = Biquad.highpass(sampleRate, 35);
    this.kickLp1 = Biquad.lowpass(sampleRate, 150);
    this.kickLp2 = Biquad.lowpass(sampleRate, 150);
    this.kickLog = new Float64Array(KICK_LAG + 1);
    this.kickLin = new Float64Array(KICK_LAG + 1);
    this.snareLin = new Float64Array(FLUX_LAG + 1);
    this.snareBins = [Math.round(1000 / binHz), Math.min(FFT_SIZE / 2 - 1, Math.round(5000 / binHz))];
  }

  /** Log band magnitudes of the latest hop (quarter-octave bands up to 16 kHz). */
  get currentBands(): Float64Array {
    return this.logBands[(this.frame + FLUX_LAG) % (FLUX_LAG + 1)];
  }

  get bandCount(): number {
    return this.bandStart.length;
  }

  /** Process exactly `hop` new samples. */
  processHop(samples: ArrayLike<number>, offset: number, out: OnsetFrame): void {
    const hop = this.hop;
    const input = this.input;
    input.copyWithin(0, hop);
    let sumSq = 0;
    let peak = 0;
    let kickSq = 0;
    for (let i = 0; i < hop; i++) {
      const x = samples[offset + i];
      input[FFT_SIZE - hop + i] = x;
      sumSq += x * x;
      const ax = x < 0 ? -x : x;
      if (ax > peak) peak = ax;
      const k = this.kickLp2.process(this.kickLp1.process(this.kickHp.process(x)));
      kickSq += k * k;
    }
    out.rms = Math.sqrt(sumSq / hop);
    out.peak = peak;

    // --- spectral flux -----------------------------------------------------------------
    const re = this.re;
    const im = this.im;
    const w = this.window;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = input[i] * w[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);

    const slot = this.frame % (FLUX_LAG + 1);
    const cur = this.logBands[slot];
    const ref = this.logBands[(this.frame + 1) % (FLUX_LAG + 1)]; // frame - FLUX_LAG
    const norm = 4 / FFT_SIZE; // Hann coherent gain 0.5, single-sided x2
    const nb = this.bandStart.length;
    for (let bnd = 0; bnd < nb; bnd++) {
      let s = 0;
      const e = this.bandEnd[bnd];
      for (let k = this.bandStart[bnd]; k < e; k++) s += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      cur[bnd] = Math.log1p(LOG_GAMMA * norm * (s / (e - this.bandStart[bnd])));
    }
    // SuperFlux: max-filter the reference frame across neighbouring bands (suppresses vibrato).
    const mf = this.maxFiltered;
    for (let bnd = 0; bnd < nb; bnd++) {
      let m = ref[bnd];
      if (bnd > 0 && ref[bnd - 1] > m) m = ref[bnd - 1];
      if (bnd < nb - 1 && ref[bnd + 1] > m) m = ref[bnd + 1];
      mf[bnd] = m;
    }
    let broad = 0, mid = 0, hat = 0, nMid = 0, nHat = 0;
    const warm = this.frame >= FLUX_LAG;
    for (let bnd = 0; bnd < nb; bnd++) {
      const d = warm ? cur[bnd] - mf[bnd] : 0;
      const pos = d > 0 ? d : 0;
      broad += pos;
      const hz = this.bandHz[bnd];
      if (hz >= 150 && hz < 6000) { mid += pos; nMid++; }
      else if (hz >= 6000) { hat += pos; nHat++; }
    }
    out.broad = broad / nb;
    out.mid = nMid ? mid / nMid : 0;
    out.hat = nHat ? hat / nHat : 0;
    let se = 0;
    for (let k = this.snareBins[0]; k <= this.snareBins[1]; k++) se += re[k] * re[k] + im[k] * im[k];
    se *= norm * norm / (this.snareBins[1] - this.snareBins[0] + 1);
    const sSlot = this.frame % (FLUX_LAG + 1);
    this.snareLin[sSlot] = se;
    const sRise = warm ? se - this.snareLin[(this.frame + 1) % (FLUX_LAG + 1)] : 0;
    out.snareRise = sRise > 0 ? sRise : 0;

    // --- kick ---------------------------------------------------------------------------
    const kl = this.kickLog;
    const kSlot = this.frame % (KICK_LAG + 1);
    kl[kSlot] = Math.log1p(LOG_GAMMA * Math.sqrt(kickSq / hop));
    const kRef = kl[(this.frame + 1) % (KICK_LAG + 1)]; // frame - KICK_LAG
    const kd = this.frame >= KICK_LAG ? kl[kSlot] - kRef : 0;
    out.kick = kd > 0 ? kd : 0;
    const ke = kickSq / hop;
    this.kickLin[kSlot] = ke;
    const kRise = this.frame >= KICK_LAG ? ke - this.kickLin[(this.frame + 1) % (KICK_LAG + 1)] : 0;
    out.kickRise = kRise > 0 ? kRise : 0;

    this.frame++;
  }
}
