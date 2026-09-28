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
  /** The DSP clock's own confidence (0..1). */
  confidence?: number;
  /**
   * The DSP's latest raw tempo estimate (beat period, s). When it agrees with the clock, the
   * clock's tempo is backed by the audio and only octave / 3:2 disagreements are arbitrated.
   */
  estimatePeriod?: number;
}

export type ArbiterDecision =
  | { kind: 'none'; reason: string; beats: number; /** The network's tempo, when it found one (diagnostics). */ bpm?: number }
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
// Only metrical tempo disagreements (octaves, 3:2) are the network's business; gradual tempo
// changes are followed by the DSP tracker itself. A clock whose tempo its own estimate no
// longer backs (stuck on a 4:3 relative, or wandering without confidence) is also retimed by a
// consistent network - but a backed clock is not: the network makes 4:3 errors too.
const OCTAVE_RATIOS = [2, 0.5, 1.5, 2 / 3];
const STUCK_RATIOS = [4 / 3, 3 / 4];
const LOST_CLOCK_CONFIDENCE = 0.3;
const OCTAVE_TOL = 0.06;
const SAME_PERIOD = 0.04;
/** Minimum time between a proposal and the window that confirms it (s). */
const MIN_CONFIRM_GAP_S = 4.5;

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
    const near = (rs: number[]) => rs.some(r => Math.abs(ratio / r - 1) < OCTAVE_TOL);
    const backed = clock.estimatePeriod !== undefined && Math.abs(clock.estimatePeriod / clock.period - 1) < 0.03;
    const unbacked = clock.estimatePeriod !== undefined && !backed;
    const lost = (clock.confidence ?? 1) < LOST_CLOCK_CONFIDENCE;
    if (!near(OCTAVE_RATIOS) && !(unbacked && (lost || near(STUCK_RATIOS)))) {
      return { kind: 'none', reason: 'tempo differs (not an octave); DSP follows tempo changes', beats: beats.length, bpm: 60 / nPeriod };
    }
    const c = circular(beats, weights, nPeriod, beats[beats.length - 1]);
    if (c.consistency < CONSISTENCY_MIN) return { kind: 'none', reason: 'inconsistent neural tempo', beats: beats.length, bpm: 60 / nPeriod };
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
 * when a single window is very consistent. Every confirmation also refreshes two "neural
 * locks": a short one during which the DSP clock may not relock its phase, and a longer one
 * during which it may not jump the tempo by an octave or 3:2. The network abstains now and
 * then (soft passages, live tempo drift), and a DSP octave jump in such a gap would only be
 * undone by the next retime (154 <-> 77 BPM flapping on a rock song).
 */
export class NeuralArbiter {
  /** Stream time until which the DSP clock is not allowed to change metrical phase. */
  lockUntil = -1;
  /** Stream time until which the DSP clock is not allowed to change the tempo octave. */
  octaveLockUntil = -1;
  last: ArbiterDecision | null = null;
  private pending: ArbiterDecision | null = null;
  private pendingAt = 0;
  readonly lockSeconds: number;
  readonly octaveLockSeconds: number;

  constructor(lockSeconds = 12, octaveLockSeconds = 30) {
    this.lockSeconds = lockSeconds;
    this.octaveLockSeconds = octaveLockSeconds;
  }

  /** Forget locks and pending decisions (AI switched off/on, new Music style). */
  reset(): void {
    this.lockUntil = -1;
    this.octaveLockUntil = -1;
    this.pending = null;
    this.last = null;
  }

  private lock(now: number): void {
    this.lockUntil = now + this.lockSeconds;
    this.octaveLockUntil = now + this.octaveLockSeconds;
  }

  decide(w: NeuralWindow, clock: ClockView, now: number): ArbiterDecision {
    const d = evaluateWindow(w, clock);
    const previous = this.last;
    this.last = d;
    if (d.kind === 'confirm') {
      this.pending = null;
      this.lock(now);
      return d;
    }
    if (d.kind === 'none') {
      this.pending = null;
      return d;
    }
    // a single very consistent window may shift the phase at once - but not the phase the
    // previous window confirmed: the small model now and then flips the phase of a song for one
    // window, and contradicting itself takes two agreeing windows
    const strong = d.kind === 'shift' && d.consistency >= 0.9 && d.beats >= 8 && previous?.kind !== 'confirm';
    const same = this.pending !== null && this.pending.kind === d.kind && sameDecision(this.pending, d, clock.period);
    // The confirming window must contain mostly new audio: windows are 10 s long but can come
    // every 2.5 s, and two heavily overlapping windows are nearly the same evidence twice.
    const agrees = same && now - this.pendingAt >= MIN_CONFIRM_GAP_S;
    if (strong || agrees) {
      this.pending = null;
      this.lock(now);
      return d;
    }
    if (!same) {
      this.pending = d;
      this.pendingAt = now;
    }
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
