/**
 * Bar position from the beat model's downbeat output: which running beat index of the DSP clock
 * is the "1" of the bar (4/4). The network's downbeat activation is read at each clock beat in
 * its 10 s window and folded modulo four; one position must clearly win. The DSP clock keeps
 * time, the network only says where the bar starts, like the phase arbiter. Pure logic.
 */
export const BEATS_PER_BAR = 4;
/** Activation within +-this (s) of a clock beat counts for that beat. */
const TOLERANCE_S = 0.06;
/** The winning position needs at least this mean activation ... */
const MIN_ACTIVATION = 0.3;
/** ... and this many times the runner-up's. */
const MIN_CONTRAST = 2;
/** Beats of the window that must be scored (two bars). */
const MIN_BEATS = 8;

export interface ClockBeat {
  /** Stream time (s) and running beat index of a clock beat. */
  time: number;
  index: number;
}

export interface BarWindow {
  t0: number;
  fps: number;
  /** Downbeat probability per frame. */
  activation: Float32Array;
}

/** Mean downbeat activation per bar position (index mod 4) of the clock beats in the window. */
export function barScores(w: BarWindow, beats: readonly ClockBeat[]): { mean: number[]; beats: number } {
  const sum = new Array(BEATS_PER_BAR).fill(0);
  const n = new Array(BEATS_PER_BAR).fill(0);
  const tol = Math.max(1, Math.round(TOLERANCE_S * w.fps));
  let scored = 0;
  for (const b of beats) {
    const c = Math.round((b.time - w.t0) * w.fps);
    if (c - tol < 0 || c + tol >= w.activation.length) continue;
    let m = 0;
    for (let i = c - tol; i <= c + tol; i++) m = Math.max(m, w.activation[i]);
    const p = ((b.index % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    sum[p] += m;
    n[p]++;
    scored++;
  }
  return { mean: sum.map((s, p) => (n[p] ? s / n[p] : 0)), beats: scored };
}

export class BarTracker {
  /** Running beat index modulo 4 that falls on the "1" of the bar; -1 while unknown. */
  phase = -1;
  /** Winner's margin over the runner-up in the last accepted window (diagnostics). */
  contrast = 0;
  private pending = -1;
  /** Clock jump counter the current phase belongs to: after a jump the phase is re-learned. */
  private jumps = -1;

  /** Whether the phase belongs to the clock's current grid (no jump since it was learned). */
  validFor(jumps: number): boolean {
    return this.phase >= 0 && jumps === this.jumps;
  }

  reset(): void {
    this.phase = -1;
    this.pending = -1;
    this.contrast = 0;
  }

  /**
   * Update from one window. `jumps` is the clock's jump counter: when the clock jumped since the
   * phase was learned, the next clear window is taken at once; otherwise a different position
   * must win two windows in a row.
   */
  update(w: BarWindow, beats: readonly ClockBeat[], jumps: number): void {
    const { mean, beats: scored } = barScores(w, beats);
    if (scored < MIN_BEATS) return;
    let best = 0;
    for (let p = 1; p < BEATS_PER_BAR; p++) if (mean[p] > mean[best]) best = p;
    const second = Math.max(...mean.filter((_, p) => p !== best));
    const clear = mean[best] >= MIN_ACTIVATION && mean[best] >= MIN_CONTRAST * Math.max(second, 1e-3);
    if (!clear) return;
    const stale = jumps !== this.jumps;
    if (this.phase < 0 || stale || best === this.phase || this.pending === best) {
      this.phase = best;
      this.pending = -1;
      this.jumps = jumps;
      this.contrast = mean[best] - second;
    } else {
      this.pending = best;
    }
  }
}
