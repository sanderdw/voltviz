import { FrameHistory } from './ring.ts';

export interface PeakPickerOptions {
  /** Frames per second of the input function. */
  frameRate: number;
  /** Length of the adaptive-threshold window before the candidate (seconds). */
  windowS?: number;
  /** Threshold = median + k * mean absolute deviation + delta. */
  k?: number;
  delta?: number;
  /** Frames after the candidate that must be seen before deciding (latency). */
  lookahead?: number;
  /** Frames before the candidate it must dominate. */
  lookbehind?: number;
  /** Minimum time between two peaks (seconds). */
  minIntervalS?: number;
}

/**
 * Causal adaptive-threshold peak picker. A frame is a peak when it is the local maximum of
 * [c - lookbehind, c + lookahead] and exceeds a robust (median + MAD) threshold of the
 * preceding window, so it adapts to the material without any level normalization.
 */
export class PeakPicker {
  private readonly hist: FrameHistory;
  private readonly win: number;
  private readonly k: number;
  private readonly delta: number;
  readonly lookahead: number;
  private readonly lookbehind: number;
  private readonly minInterval: number;
  private readonly scratch: Float64Array;
  private lastPeak = -1e9;
  /** Most recent threshold, exposed for diagnostics. */
  threshold = 0;

  constructor(o: PeakPickerOptions) {
    this.win = Math.max(8, Math.round((o.windowS ?? 0.5) * o.frameRate));
    this.k = o.k ?? 1.5;
    this.delta = o.delta ?? 0.02;
    this.lookahead = o.lookahead ?? 2;
    this.lookbehind = o.lookbehind ?? 3;
    this.minInterval = Math.round((o.minIntervalS ?? 0.08) * o.frameRate);
    this.hist = new FrameHistory(this.win + this.lookahead + this.lookbehind + 4);
    this.scratch = new Float64Array(this.win);
  }

  /**
   * Push the value of the newest frame. Returns the strength (> 0) when the frame
   * `lookahead` frames back is a peak, otherwise 0. The peak frame index is
   * `hist.count - 1 - lookahead` at the time of the call.
   */
  push(v: number): number {
    this.hist.push(v);
    const c = this.hist.count - 1 - this.lookahead;
    if (c < this.win) return 0;
    const vc = this.hist.at(c);
    for (let i = c - this.lookbehind; i <= c + this.lookahead; i++) {
      if (i !== c && this.hist.at(i) > vc) return 0;
    }
    // robust threshold over the window before the candidate
    const s = this.scratch;
    for (let i = 0; i < this.win; i++) s[i] = this.hist.at(c - this.win + i);
    s.sort();
    const med = s[this.win >> 1];
    let mad = 0;
    for (let i = 0; i < this.win; i++) mad += Math.abs(s[i] - med);
    mad /= this.win;
    this.threshold = med + this.k * mad + this.delta;
    if (vc <= this.threshold || c - this.lastPeak < this.minInterval) return 0;
    this.lastPeak = c;
    return (vc - this.threshold) / (this.threshold + 1e-9);
  }
}
