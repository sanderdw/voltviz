import { FrameHistory } from './ring.ts';

/** Envelope window around a beat (ms): the level before it and the rise just after it. */
const BASE_FROM_MS = -82;
const BASE_TO_MS = -58;
const RISE_TO_MS = 70;
/** Beats whose envelopes are averaged: only what is locked to the beat survives the average. */
export const STRENGTH_BEATS = 8;
/** The newest beats averaged for a quick response (a drop), and how much more they must rise. */
export const FAST_BEATS = 2;
export const FAST_MARGIN_DB = 1.5;
/** Rise (dB) at which the strength starts above 0, and at which it is 1. */
export const RISE_FLOOR_DB = 2;
export const RISE_FULL_DB = 6;

const BANDS = 3;
const EPS = 1e-10;

/**
 * How much of an audible hit the tracked beats carry: 0 for a pulse without a hit (a build-up
 * over a pumping pad, a riser), 1 for a full kick or snare. The envelopes of three bands (kick
 * 35-150 Hz, click/snare 1-5 kHz, broadband) are averaged over the last few beats, aligned on
 * the beat, and the largest rise just after the beat above the level just before it is the
 * beat's "rise" in dB. Averaging keeps the part of the envelope that repeats on every beat and
 * cancels everything else, so busy music without a hit on the beat scores low.
 */
export class BeatStrength {
  private readonly env: FrameHistory[];
  private readonly from: number;
  private readonly to: number;
  private readonly len: number;
  /** Last profile index of the "before" window. */
  private readonly baseEnd: number;
  private readonly profiles: Float64Array;
  private readonly sums: Float64Array;
  private readonly fastSums: Float64Array;
  private readonly beats: number;
  private filled = 0;
  private slot = 0;
  private pending: number[] = [];
  /** Rise (dB) of the averaged beat envelope; 0 until the first beat was measured. */
  rise = 0;
  /** Rise over all averaged beats, and over the newest few only (diagnostics). */
  riseSlow = 0;
  riseFast = 0;
  /** 0..1 mapping of `rise`. */
  strength = 0;

  constructor(frameRate: number, beats = STRENGTH_BEATS) {
    const cap = Math.ceil(frameRate * 2);
    this.env = Array.from({ length: BANDS }, () => new FrameHistory(cap));
    this.from = Math.round((BASE_FROM_MS / 1000) * frameRate);
    this.to = Math.round((RISE_TO_MS / 1000) * frameRate);
    this.len = this.to - this.from + 1;
    this.beats = beats;
    this.profiles = new Float64Array(beats * BANDS * this.len);
    this.sums = new Float64Array(BANDS * this.len);
    this.fastSums = new Float64Array(BANDS * this.len);
    this.baseEnd = Math.round((BASE_TO_MS / 1000) * frameRate) - this.from;
  }

  /** One hop's band energies (linear, mean square). */
  push(low: number, click: number, full: number): void {
    this.env[0].push(10 * Math.log10(low + EPS));
    this.env[1].push(10 * Math.log10(click + EPS));
    this.env[2].push(10 * Math.log10(full + EPS));
    const newest = this.env[0].count - 1;
    while (this.pending.length && Math.round(this.pending[0]) + this.to <= newest) this.measure(Math.round(this.pending.shift()!));
  }

  /** A tracked beat at `position` (frames, true time); measured once its window has passed. */
  onBeat(position: number): void {
    this.pending.push(position);
  }

  private measure(center: number): void {
    const { len, sums, profiles } = this;
    const base = this.slot * BANDS * len;
    const full = this.filled === this.beats;
    for (let b = 0; b < BANDS; b++) {
      for (let k = 0; k < len; k++) {
        const i = b * len + k;
        const v = this.env[b].at(center + this.from + k);
        if (full) sums[i] -= profiles[base + i];
        profiles[base + i] = v;
        sums[i] += v;
      }
    }
    this.slot = (this.slot + 1) % this.beats;
    if (!full) this.filled++;

    this.riseSlow = this.riseOf(sums, this.filled);
    // the newest FAST_BEATS profiles, for a quick rise at a drop
    const n = Math.min(FAST_BEATS, this.filled);
    const fast = this.fastSums.fill(0);
    for (let j = 1; j <= n; j++) {
      const at = ((this.slot - j + this.beats) % this.beats) * BANDS * len;
      for (let i = 0; i < BANDS * len; i++) fast[i] += profiles[at + i];
    }
    this.riseFast = this.riseOf(fast, n);
    this.rise = Math.max(this.riseSlow, this.riseFast - FAST_MARGIN_DB);
    this.strength = Math.min(1, Math.max(0, (this.rise - RISE_FLOOR_DB) / (RISE_FULL_DB - RISE_FLOOR_DB)));
  }

  /** Largest rise over the bands of the mean of `count` summed profiles. */
  private riseOf(sums: Float64Array, count: number): number {
    const len = this.len;
    let best = -Infinity;
    for (let b = 0; b < BANDS; b++) {
      let before = 0;
      for (let k = 0; k <= this.baseEnd; k++) before += sums[b * len + k];
      before /= this.baseEnd + 1;
      let peak = -Infinity;
      for (let k = -this.from; k < len; k++) peak = Math.max(peak, sums[b * len + k]);
      best = Math.max(best, (peak - before) / count);
    }
    return best;
  }
}
