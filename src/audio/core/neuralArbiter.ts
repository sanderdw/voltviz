/**
 * Neural phase arbiter: turns a window of beat activations from the beat model into a
 * decision about the DSP beat clock's *metrical* phase and tempo.
 *
 * The DSP clock is precise and continuous but can lock onto a consistent non-beat element
 * (off-beat hats, a rolling bassline, pickups). The network knows which phase is the beat but
 * only runs every few seconds on a 10 s window. So the network arbitrates, the DSP clock keeps
 * time. Pure logic, no DOM; the caller supplies the activation window.
 */
export interface NeuralWindow {
  /** Stream time (s) of activation frame 0 (frame i is at t0 + i / fps). */
  t0: number;
  fps: number;
  /** Beat probability per frame (sigmoid output). */
  activation: Float32Array;
}

export interface ClockView {
  /** Beat period (s) and predicted next beat time (s). */
  period: number;
  nextBeatTime: number;
}

export type ArbiterDecision =
  | { kind: 'none'; reason: string; beats: number }
  | { kind: 'confirm'; consistency: number; beats: number; offsetFraction: number }
  | { kind: 'shift'; shiftSeconds: number; consistency: number; beats: number }
  | { kind: 'retime'; period: number; nextBeatTime: number; consistency: number; beats: number };

const PEAK_THRESHOLD = 0.4;
const EDGE_START_S = 1.0; // ignore the first second of the window (no left context)
const EDGE_END_S = 0.5; // and the last half second (no right context)
const MIN_BEATS = 5;
const CONSISTENCY_MIN = 0.7;
// The network arbitrates *metrical* phase only (pickups ~0.16, sixteenths 0.25, off-beat 0.5
// of a period). Smaller offsets are timing, which the DSP loop measures more precisely.
const SHIFT_MIN_FRACTION = 0.13;
// Only octave-type tempo disagreements are the network's business; gradual tempo changes
// are followed by the DSP tracker itself.
const OCTAVE_RATIOS = [2, 0.5, 1.5, 2 / 3];
const OCTAVE_TOL = 0.06;
const SAME_PERIOD = 0.04;

/** Parabolic-interpolated activation peaks above threshold, as times (s). */
export function activationPeaks(w: NeuralWindow): { times: number[]; strengths: number[] } {
  const a = w.activation;
  const times: number[] = [];
  const strengths: number[] = [];
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i] < PEAK_THRESHOLD || a[i] < a[i - 1] || a[i] < a[i + 1]) continue;
    if (i >= 2 && a[i] === a[i - 1]) continue; // plateau: keep first
    const denom = a[i - 1] - 2 * a[i] + a[i + 1];
    const frac = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a[i - 1] - a[i + 1])) / denom)) : 0;
    times.push(w.t0 + (i + frac) / w.fps);
    strengths.push(a[i]);
  }
  return { times, strengths };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
}

/**
 * Stateless evaluation of one window against the clock. `NeuralArbiter` below adds the
 * persistence rules on top.
 */
export function evaluateWindow(w: NeuralWindow, clock: ClockView): ArbiterDecision {
  const end = w.t0 + w.activation.length / w.fps;
  const { times, strengths } = activationPeaks(w);
  const idx = times.map((t, i) => i).filter(i => times[i] >= w.t0 + EDGE_START_S && times[i] <= end - EDGE_END_S);
  const beats = idx.map(i => times[i]);
  const weights = idx.map(i => strengths[i]);
  if (beats.length < MIN_BEATS) return { kind: 'none', reason: 'too few beats', beats: beats.length };
  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i] - beats[i - 1]);
  const nPeriod = median(ibis);
  if (!(clock.period > 0)) {
    return { kind: 'retime', period: nPeriod, nextBeatTime: projectNext(beats, nPeriod, end), consistency: 1, beats: beats.length };
  }

  const ratio = nPeriod / clock.period;
  if (Math.abs(ratio - 1) > SAME_PERIOD) {
    if (!OCTAVE_RATIOS.some(r => Math.abs(ratio / r - 1) < OCTAVE_TOL)) {
      return { kind: 'none', reason: 'tempo differs (not an octave); DSP follows tempo changes', beats: beats.length };
    }
    const c = circular(beats, weights, nPeriod, beats[beats.length - 1]);
    if (c.consistency < CONSISTENCY_MIN) return { kind: 'none', reason: 'inconsistent neural tempo', beats: beats.length };
    return { kind: 'retime', period: nPeriod, nextBeatTime: projectNext(beats, nPeriod, end), consistency: c.consistency, beats: beats.length };
  }

  const c = circular(beats, weights, clock.period, clock.nextBeatTime);
  if (c.consistency < CONSISTENCY_MIN) return { kind: 'none', reason: 'inconsistent phase', beats: beats.length };
  if (Math.abs(c.meanFraction) < SHIFT_MIN_FRACTION) {
    return { kind: 'confirm', consistency: c.consistency, beats: beats.length, offsetFraction: c.meanFraction };
  }
  return { kind: 'shift', shiftSeconds: c.meanFraction * clock.period, consistency: c.consistency, beats: beats.length };
}

/** Weighted circular mean of beat phases relative to a grid (period, reference time). */
function circular(beats: number[], weights: number[], period: number, ref: number): { meanFraction: number; consistency: number } {
  let sx = 0, sy = 0, sw = 0;
  for (let i = 0; i < beats.length; i++) {
    const phi = (2 * Math.PI * (beats[i] - ref)) / period;
    sx += weights[i] * Math.cos(phi);
    sy += weights[i] * Math.sin(phi);
    sw += weights[i];
  }
  return { meanFraction: Math.atan2(sy, sx) / (2 * Math.PI), consistency: Math.hypot(sx, sy) / sw };
}

function projectNext(beats: number[], period: number, after: number): number {
  // least-squares grid through the beats, projected past `after`
  const n = beats.length;
  const k = beats.map(b => Math.round((b - beats[0]) / period));
  const mk = k.reduce((a, b) => a + b, 0) / n;
  const mb = beats.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (k[i] - mk) * (beats[i] - mb);
    den += (k[i] - mk) * (k[i] - mk);
  }
  const p = den > 0 ? num / den : period;
  const b0 = mb - p * mk;
  return b0 + p * Math.ceil((after - b0) / p + 1e-9);
}

/**
 * Persistence rules: a phase shift or retime is applied only when two consecutive windows
 * agree (the network is not infallible either); a phase shift may also be applied at once
 * when a single window is very consistent. Every confirmation also refreshes a "neural lock" during which the DSP
 * clock may not relock or jump octaves on its own.
 */
export class NeuralArbiter {
  /** Stream time until which the DSP clock is not allowed to change metrical phase / octave. */
  lockUntil = -1;
  last: ArbiterDecision | null = null;
  private pending: ArbiterDecision | null = null;
  readonly lockSeconds: number;

  constructor(lockSeconds = 12) {
    this.lockSeconds = lockSeconds;
  }

  decide(w: NeuralWindow, clock: ClockView, now: number): ArbiterDecision {
    const d = evaluateWindow(w, clock);
    this.last = d;
    if (d.kind === 'confirm') {
      this.pending = null;
      this.lockUntil = now + this.lockSeconds;
      return d;
    }
    if (d.kind === 'none') {
      this.pending = null;
      return d;
    }
    // a single very consistent window may shift phase; a retime always needs two windows
    const strong = d.kind === 'shift' && d.consistency >= 0.9 && d.beats >= 8;
    const agrees = this.pending !== null && this.pending.kind === d.kind && sameDecision(this.pending, d, clock.period);
    if (strong || agrees) {
      this.pending = null;
      this.lockUntil = now + this.lockSeconds;
      return d;
    }
    this.pending = d;
    return { kind: 'none', reason: `awaiting confirmation of ${d.kind}`, beats: d.beats };
  }
}

function sameDecision(a: ArbiterDecision, b: ArbiterDecision, period: number): boolean {
  if (a.kind === 'shift' && b.kind === 'shift') {
    const e = a.shiftSeconds - b.shiftSeconds;
    return Math.abs(e - period * Math.round(e / period)) < 0.08 * period;
  }
  if (a.kind === 'retime' && b.kind === 'retime') return Math.abs(a.period / b.period - 1) < SAME_PERIOD;
  return false;
}
