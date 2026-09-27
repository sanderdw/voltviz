import type { FrameHistory } from './ring.ts';
import type { TempoCandidate } from './tempo.ts';

/**
 * Time convention used throughout the tracker: positions are measured in frames of the
 * onset function, where frame h covers samples [h*hop, (h+1)*hop) and "position x" means
 * sample time x*hop. An onset-function peak in frame h corresponds to a true onset at
 * position (h + 1) - lag, where `lag` is the calibrated detection delay of the function.
 */
export interface BeatEvent {
  /** Beat position (fractional frames, see above). */
  position: number;
  /** Running beat counter. */
  index: number;
  /** 0..1 confidence at the moment the beat was emitted. */
  confidence: number;
  /** Beat period in frames at emission time. */
  period: number;
}

export interface BeatTrackerOptions {
  frameRate: number;
  /** Detection delay of the phase onset function (frames). */
  lag: number;
  tuning?: Partial<TrackerTuning>;
}

/** Tunable constants of the tracker (defaults below; overridable for tests/evaluation). */
export interface TrackerTuning {
  combBeats: number;
  combDecay: number;
  /** Comb tolerance in frames either side. */
  combTol: number;
  /** Fraction of a period searched around each predicted beat by the PLL. */
  pllWindow: number;
  pllPhaseGain: number;
  pllPeriodGain: number;
  /** An onset supports a beat when it exceeds this many times the running mean. */
  supportRatio: number;
  /** Fraction of a period before a comb disagreement counts. */
  relockError: number;
  /** Consecutive comb disagreements (at ~4 Hz) needed to jump phase. */
  relockVotes: number;
  /** Comb score advantage required to jump phase. */
  relockGain: number;
  /**
   * Jumping by half a period (onto the off-beat) is the classic beat-tracking failure: dance
   * music is full of off-beat hats and basslines that take over when the kick drops out. Such
   * jumps need much more persistent and stronger evidence, like octave tempo jumps.
   */
  relockVotesOffbeat: number;
  relockGainOffbeat: number;
  /** Relative tempo difference followed smoothly; larger ones need votes and then snap. */
  tempoSame: number;
  /** Updates of agreement (at ~4 Hz) for a genuine tempo change. */
  tempoVotes: number;
  /** Same for octave-related jumps (flapping protection). */
  tempoVotesOctave: number;
}

export const DEFAULT_TUNING: TrackerTuning = {
  combBeats: 32,
  combDecay: 0.97,
  combTol: 2,
  pllWindow: 0.08,
  pllPhaseGain: 0.25,
  pllPeriodGain: 0.06,
  supportRatio: 2.0,
  relockError: 0.12,
  relockVotes: 8,
  relockGain: 1.25,
  relockVotesOffbeat: 16,
  relockGainOffbeat: 1.6,
  tempoSame: 0.015,
  tempoVotes: 4,
  tempoVotesOctave: 12,
};

/**
 * Predict-and-correct beat clock.
 *
 * - The clock emits beats at *predicted* positions, so consumers can be exactly on time
 *   instead of one detection latency late.
 * - After each predicted beat, the onset function around it is inspected; a clear onset
 *   nudges phase and period (a phase-locked loop). Clear onsets also raise "support".
 * - At ~4 Hz a comb template over the last 32 beats is evaluated for every phase. It sets
 *   the phase when unlocked and re-locks when it persistently disagrees with the clock,
 *   e.g. after a DJ transition or when the loop has drifted onto the off-beat.
 * - Through breakdowns the clock keeps running (visuals stay in time) while confidence
 *   decays, and it re-locks as soon as onsets return.
 */
export class BeatTracker {
  readonly frameRate: number;
  readonly lag: number;
  period = 0;
  nextBeat = 0;
  index = 0;
  locked = false;
  confidence = 0;
  support = 0;
  contrast = 0;
  /** Comb contrast at the clock's own phase over only the last 4 beats (current periodicity). */
  recentContrast = 0;
  tempoSalience = 0;
  /**
   * When false (set by the neural arbiter while it vouches for the current phase), the DSP
   * comb may not jump phase and the tempo may not jump; the PLL still refines timing.
   */
  dspJumpsAllowed = true;
  /** Confidence contributed by the neural arbiter (decays when not refreshed). */
  neuralConfidence = 0;

  private meanOdf = 0;
  private pending: number[] = [];
  private relockVotes = 0;
  private relockPhase = 0;
  private tempoVotes = 0;
  private tempoTarget = 0;
  private forceRelock = false;
  private lastFrame = -1;

  private readonly t: TrackerTuning;

  constructor(o: BeatTrackerOptions) {
    this.t = { ...DEFAULT_TUNING, ...o.tuning };
    this.frameRate = o.frameRate;
    this.lag = o.lag;
  }

  get bpm(): number {
    return this.period > 0 ? (60 * this.frameRate) / this.period : 0;
  }

  /** Evidence for a true-time position x: max of the onset function within +-tol frames. */
  private evidence(odf: FrameHistory, x: number, tol: number): number {
    const c = Math.round(x + this.lag - 1);
    let m = 0;
    for (let d = -tol; d <= tol; d++) {
      const v = odf.at(c + d);
      if (v > m) m = v;
    }
    return m;
  }

  private combScore(odf: FrameHistory, b: number, period: number, beats = this.t.combBeats): number {
    let s = 0;
    let w = 1;
    for (let k = 0; k < beats; k++) {
      s += w * this.evidence(odf, b - k * period, this.t.combTol);
      w *= this.t.combDecay;
    }
    return s;
  }

  /** Latest true-time position whose evidence is fully available at newest frame h. */
  private refEnd(h: number): number {
    return h + 1 - this.lag - this.t.combTol;
  }

  /** Best phase over one period: returns the most recent beat position and scores. */
  private comb(odf: FrameHistory, h: number, period: number): { beat: number; score: number; mean: number } {
    const end = this.refEnd(h);
    let best = end;
    let bestScore = -1;
    let sum = 0;
    let n = 0;
    for (let b = end; b > end - period; b -= 0.5) {
      const s = this.combScore(odf, b, period);
      sum += s;
      n++;
      if (s > bestScore) {
        bestScore = s;
        best = b;
      }
    }
    return { beat: best, score: bestScore, mean: n ? sum / n : 0 };
  }

  private wrap(e: number): number {
    const p = this.period;
    return e - p * Math.round(e / p);
  }

  /** Called at ~4 Hz with the latest tempo estimate (or null). */
  onTempo(c: TempoCandidate | null, h: number, odf: FrameHistory): void {
    if (c) {
      this.tempoSalience += (c.salience - this.tempoSalience) * 0.3;
      if (this.period === 0) {
        if (c.salience > 0.05) this.period = c.period;
      } else {
        const ratio = c.period / this.period;
        if (Math.abs(ratio - 1) < this.t.tempoSame) {
          this.period += (c.period - this.period) * 0.1;
          this.tempoVotes = 0;
        } else {
          if (this.tempoTarget > 0 && Math.abs(c.period / this.tempoTarget - 1) < this.t.tempoSame) this.tempoVotes++;
          else {
            this.tempoTarget = c.period;
            this.tempoVotes = 1;
          }
          const near = (rs: number[]) => rs.some(r => Math.abs(ratio / r - 1) < 0.06);
          const octave = near([2, 0.5, 1.5, 2 / 3, 3, 1 / 3]);
          // 3:2-type jumps are almost never real: only allowed once the current tempo has
          // lost onset support. The neural veto blocks octave-type jumps; genuine tempo
          // changes stay free.
          const triple = near([1.5, 2 / 3, 3, 1 / 3]);
          const allowed = (octave ? this.dspJumpsAllowed : true) && (!triple || this.support < 0.5);
          if (allowed && this.tempoVotes >= (octave ? this.t.tempoVotesOctave : this.t.tempoVotes) && c.salience > 0.05) {
            this.period = c.period;
            this.tempoVotes = 0;
            this.forceRelock = true; // take the comb phase for the new period immediately below
          }
        }
      }
    } else {
      this.tempoSalience *= 0.9;
    }
    if (this.period === 0 || odf.count < this.period * 3) return;

    const comb = this.comb(odf, h, this.period);
    this.contrast = comb.mean > 0 ? comb.score / comb.mean : 0;
    if (this.locked) {
      const end = this.refEnd(h);
      const cur = this.nextBeat - this.period * Math.ceil((this.nextBeat - end) / this.period);
      let sum = 0, n = 0;
      for (let b = end; b > end - this.period; b -= 1) {
        sum += this.combScore(odf, b, this.period, 4);
        n++;
      }
      const mean = n ? sum / n : 0;
      this.recentContrast = mean > 0 ? this.combScore(odf, cur, this.period, 4) / mean : 0;
    }
    const now = h + 1;
    const combNext = comb.beat + this.period * Math.ceil((now - comb.beat) / this.period + 1e-9);

    if (this.forceRelock && this.locked) {
      this.forceRelock = false;
      this.nextBeat = combNext;
      this.pending.length = 0;
      this.relockVotes = 0;
      return;
    }
    if (!this.locked) {
      if (this.contrast > 1.3) {
        this.locked = true;
        this.nextBeat = combNext;
        this.relockVotes = 0;
      }
      return;
    }
    const e = this.wrap(combNext - this.nextBeat);
    if (!this.dspJumpsAllowed) {
      this.relockVotes = 0;
    } else if (Math.abs(e) > this.t.relockError * this.period) {
      const phase = combNext % this.period;
      const same = this.relockVotes > 0 && Math.abs(this.wrap(phase - this.relockPhase)) < 0.08 * this.period;
      this.relockVotes = same ? this.relockVotes + 1 : 1;
      this.relockPhase = phase;
      const offbeat = Math.abs(Math.abs(e) - this.period / 2) < 0.1 * this.period;
      if (this.relockVotes >= (offbeat ? this.t.relockVotesOffbeat : this.t.relockVotes)) {
        const end = this.refEnd(h);
        const cur = this.nextBeat - this.period * Math.ceil((this.nextBeat - end) / this.period);
        const curScore = this.combScore(odf, cur, this.period);
        if (comb.score > (offbeat ? this.t.relockGainOffbeat : this.t.relockGain) * curScore) {
          this.nextBeat = combNext;
          this.pending.length = 0;
          this.relockVotes = 0;
        }
      }
    } else {
      this.relockVotes = 0;
    }
  }

  /** Shift the clock phase by `frames` (neural arbiter); keeps the next beat in the future. */
  shiftPhase(frames: number, now: number): void {
    if (this.period <= 0) return;
    let nb = this.nextBeat + frames;
    while (nb <= now + 0.1 * this.period) nb += this.period;
    while (nb - this.period > now + 0.1 * this.period) nb -= this.period;
    this.nextBeat = nb;
    this.pending.length = 0;
    this.relockVotes = 0;
  }

  /** Replace period and phase (neural arbiter: octave error or tempo change). */
  retime(period: number, nextBeat: number, now: number): void {
    this.period = period;
    let nb = nextBeat;
    while (nb <= now + 0.1 * period) nb += period;
    this.nextBeat = nb;
    this.locked = true;
    this.pending.length = 0;
    this.relockVotes = 0;
    this.tempoVotes = 0;
    this.forceRelock = false;
  }

  /** Advance to newest frame h; appends beats whose predicted position has been reached. */
  step(h: number, odf: FrameHistory, out: BeatEvent[]): void {
    if (h === this.lastFrame) return;
    this.lastFrame = h;
    const v = odf.at(h);
    this.meanOdf += (v - this.meanOdf) * (1 / (this.frameRate * 2)); // ~2 s running mean

    if (!this.locked || this.period <= 0) {
      this.confidence *= 0.995;
      return;
    }
    const now = h + 1;
    while (this.nextBeat <= now) {
      out.push({ position: this.nextBeat, index: this.index, confidence: this.confidence, period: this.period });
      this.pending.push(this.nextBeat);
      this.nextBeat += this.period;
      this.index++;
    }

    // Phase-locked loop: evaluate predicted beats once their evidence window is complete.
    const w = this.t.pllWindow * this.period;
    while (this.pending.length && this.pending[0] + w + this.lag + 1 <= now) {
      const x = this.pending.shift() as number;
      let bestPos = x;
      let bestVal = 0;
      for (let p = Math.ceil(x - w); p <= Math.floor(x + w); p++) {
        const val = odf.at(p + Math.round(this.lag) - 1);
        // mild preference for positions close to the prediction
        const weighted = val * (1 - 0.3 * Math.abs(p - x) / w);
        if (weighted > bestVal) {
          bestVal = weighted;
          bestPos = p;
        }
      }
      // relative to the running mean AND above an absolute floor (the phase function is
      // normalized to ~1 in active music; in a pad-only breakdown the mean collapses)
      const supported = bestVal > Math.max(this.t.supportRatio * this.meanOdf, 1.0);
      this.support += ((supported ? 1 : 0) - this.support) * 0.2;
      if (supported) {
        const e = bestPos - x;
        this.nextBeat += this.t.pllPhaseGain * e;
        this.period += this.t.pllPeriodGain * e;
      }
    }

    const combFactor = Math.min(1, Math.max(0, (this.contrast - 1.1) / 0.9));
    const salienceFactor2 = Math.min(1, Math.max(0, (this.tempoSalience - 0.05) / 0.2));
    this.neuralConfidence *= 1 - 1 / (this.frameRate * 5); // fades within ~one inference interval
    // Confidence follows *current* onset support; the comb only scales it (it remembers the
    // last 32 beats, so on its own it would stay high through a breakdown).
    // ... and is gated by periodicity *at the clock's phase over the last 4 beats*: noise,
    // pads and breakdowns have random onsets that can "support" beats, but no periodicity.
    const recentFactor = Math.min(1, Math.max(0, (this.recentContrast - 1.3) / 0.7));
    const dsp = this.support * (0.6 + 0.4 * combFactor) * salienceFactor2 * recentFactor;
    this.confidence = Math.max(dsp, Math.min(this.neuralConfidence, this.support + 0.3));
  }
}
