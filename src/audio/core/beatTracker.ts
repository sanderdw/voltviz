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
  /** True when this beat is on the pulse that beat effects follow (every beat, or every other one at half-time). */
  pulse: boolean;
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
  /**
   * Tempo salience (normalized autocorrelation at the beat period) at which confidence starts
   * to rise, and at which it no longer limits confidence. Vocals and melody lower the salience
   * of music whose beat is perfectly audible (rap, hardcore melodies, ballads).
   */
  salienceFloor: number;
  salienceFull: number;
  /**
   * Comb contrast at the clock's phase over the last 4 beats at which confidence starts to
   * rise, and at which it no longer limits confidence (noise, pads and breakdowns have onsets
   * but no periodicity; dense music has periodicity at a lower contrast).
   */
  recentFloor: number;
  recentFull: number;
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
  salienceFloor: 0.05,
  salienceFull: 0.25,
  recentFloor: 1.3,
  recentFull: 2.0,
};

/** A clock without confidence that the tempo estimate out-votes this long (~6 s) may make any jump. */
const METRICAL_PERSIST_VOTES = 24;
/** How long the last confidently tracked tempo is remembered (s) ... */
const CONFIDENT_MEMORY_S = 60;
/** ... once it was tracked with confidence >= 0.5 without interruption for this long (s). */
const CONFIDENT_STREAK_S = 3;

/** Beats of per-beat onset evidence the pulse decision looks at. */
const PULSE_HISTORY = 16;
const PULSE_MIN_BEATS = 12;
/** Presence cue: support on the pulse beats at least this, on the beats in between at most this. */
const PULSE_ON = 0.7;
const PULSE_OFF = 0.35;
/** Accent cue: the pulse beats' mid-band onsets at least this many times stronger. */
const PULSE_STRENGTH_RATIO = 2.0;
/**
 * Both "evidence" cues need (almost) no kick on the in-between beats: four-on-the-floor music
 * has a kick on every beat and never goes half-time, whatever its claps and basslines do.
 */
const PULSE_KICK_OFF_MAX = 0.3;
/** "lean" styles: half-time when the accents alternate at least this clearly; back below the second. */
const PULSE_LEAN_ENTER = 1.3;
const PULSE_LEAN_EXIT = 1.1;
/** Observations (beats) that must agree to go half-time and to go back. */
const PULSE_VOTES = 4;
const PULSE_EXIT_VOTES = 12;
/**
 * Auto ("evidence") needs a longer run of half-time evidence: DJ mixes have short half-time
 * build-ups (kick on every other beat for a few bars) that should keep flashing every beat.
 */
const PULSE_EVIDENCE_VOTES = 16;
/** The pulse moves to the other parity when that one is this much stronger for PULSE_VOTES beats. */
const PULSE_PARITY_RATIO = 1.3;

/**
 * When beat effects follow the half-time pulse (every other tracked beat), for tracked tempi
 * above the style's limit:
 * - `every`: never (dance music, hardcore, ballads);
 * - `evidence`: only on unmistakable evidence (Auto, hip-hop): nothing, or only much weaker
 *   onsets, on the in-between beats, and no kick there;
 * - `lean`: when the accents alternate (rock: a 150 BPM grid with kick on 1 and snare on 3 is
 *   felt at 75);
 * - `half`: always (dubstep, drum & bass, trap), on the beats with the stronger accents.
 */
export type PulseMode = 'every' | 'evidence' | 'lean' | 'half';

/** Onset evidence at one tracked beat (from the PLL's search window). */
export interface BeatEvidence {
  /** Mid-band onset clearly above its running mean. */
  supported: boolean;
  /** Mid-band onset strength relative to its running mean. */
  strength: number;
  /** A kick onset (35-150 Hz rise) at the beat. */
  kick: boolean;
}

/**
 * Chooses the pulse beat effects follow. The tracker keeps its most stable metrical level
 * (e.g. 140 BPM for dubstep); on a half-time pulse only every other tracked beat fires. The
 * decision uses per-parity statistics of the last 16 beats; the parity is anchored in time
 * (not in beat indices, which phase jumps do not touch) and changes only with clear evidence.
 */
export class PulseSelector {
  divisor = 1;
  mode: PulseMode = 'every';
  /** Per-parity statistics of the latest observation, stronger parity first (diagnostics). */
  readonly stats = { presence: [0, 0], strength: [0, 0], kick: [0, 0] };
  /** Position (frames) of a recent pulse beat. */
  private anchor = 0;
  private history: (BeatEvidence & { x: number })[] = [];
  private votes = 0;
  private parityVotes = 0;

  get on(): number {
    return this.stats.presence[0];
  }
  get off(): number {
    return this.stats.presence[1];
  }

  /** Forget the evidence history after a phase jump (keeps the current divisor and parity). */
  reset(): void {
    this.history.length = 0;
    this.votes = 0;
    this.parityVotes = 0;
  }

  isPulse(x: number, period: number): boolean {
    if (this.divisor === 1 || period <= 0) return true;
    return Math.round((x - this.anchor) / period) % 2 === 0;
  }

  /** Observe the onset evidence at the beat at position x. `halfAllowed`: tempo above the style's limit. */
  observe(x: number, ev: BeatEvidence, period: number, halfAllowed: boolean): void {
    const h = this.history;
    h.push({ x, ...ev });
    if (h.length > PULSE_HISTORY) h.shift();
    if (this.mode === 'every' || !halfAllowed) {
      this.divisor = 1;
      this.votes = 0;
    }
    if (h.length < PULSE_MIN_BEATS) return;
    // alternate beats since the last reset: group 0 = the newest beat's parity
    const n = [0, 0], pres = [0, 0], str = [0, 0], kick = [0, 0];
    for (let i = 0; i < h.length; i++) {
      const g = (h.length - 1 - i) % 2;
      n[g]++;
      if (h[i].supported) pres[g]++;
      str[g] += h[i].strength;
      if (h[i].kick) kick[g]++;
    }
    for (let g = 0; g < 2; g++) {
      pres[g] /= n[g];
      str[g] /= n[g];
      kick[g] /= n[g];
    }
    const onG = str[0] >= str[1] ? 0 : 1;
    const offG = 1 - onG;
    const st = this.stats;
    st.presence[0] = pres[onG]; st.presence[1] = pres[offG];
    st.strength[0] = str[onG]; st.strength[1] = str[offG];
    st.kick[0] = kick[onG]; st.kick[1] = kick[offG];
    if (this.mode === 'every' || !halfAllowed) return;

    const ratio = str[onG] / Math.max(1e-6, str[offG]);
    let half: boolean;
    let full: boolean;
    if (this.mode === 'half') {
      half = true;
      full = false;
    } else if (this.mode === 'lean') {
      half = ratio >= PULSE_LEAN_ENTER;
      full = ratio < PULSE_LEAN_EXIT;
    } else {
      const noKickOff = kick[offG] <= PULSE_KICK_OFF_MAX;
      const byPresence = pres[onG] >= PULSE_ON && pres[offG] <= PULSE_OFF;
      const byAccent = ratio >= PULSE_STRENGTH_RATIO && pres[onG] >= PULSE_ON;
      half = noKickOff && (byPresence || byAccent);
      full = !half;
    }
    // the newest beat on the stronger parity
    const onX = onG === 0 ? x : h[h.length - 2].x;
    if (this.divisor === 1) {
      this.votes = half ? this.votes + 1 : 0;
      if (this.votes >= (this.mode === 'evidence' ? PULSE_EVIDENCE_VOTES : PULSE_VOTES)) {
        this.divisor = 2;
        this.anchor = onX;
        this.votes = 0;
        this.parityVotes = 0;
      }
      return;
    }
    this.votes = full ? this.votes + 1 : 0;
    if (this.votes >= PULSE_EXIT_VOTES) {
      this.divisor = 1;
      this.votes = 0;
      return;
    }
    // keep the anchor recent (the period drifts) ...
    this.anchor = this.isPulse(x, period) ? x : h[h.length - 2].x;
    // ... and move it to the other parity only when that one is clearly stronger for a while
    const strongerIsPulse = this.isPulse(onX, period);
    if (!strongerIsPulse && ratio >= PULSE_PARITY_RATIO) {
      if (++this.parityVotes >= PULSE_VOTES) {
        this.anchor = onX;
        this.parityVotes = 0;
      }
    } else {
      this.parityVotes = 0;
    }
  }
}

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
   * comb may not jump phase; the PLL still refines timing.
   */
  dspJumpsAllowed = true;
  /**
   * When false (set by the neural arbiter for longer than the phase lock), the tempo may not
   * jump by an octave, 3:2 or 4:3 on the DSP's own evidence.
   */
  octaveJumpsAllowed = true;
  /** Tracked beat period (frames) below which the half-time pulse may be used (tempo above the style limit); 0 = never. */
  halfTimeBelow = 0;
  /**
   * Kick onset function (normalized to its running mean) and its detection delay in frames,
   * for the pulse decision. Optional: without it no beat counts as having a kick.
   */
  kickOdf: FrameHistory | null = null;
  kickLag = 0;
  readonly pulse = new PulseSelector();
  /** The factors of the DSP confidence (diagnostics): onset support, comb, tempo salience, recent periodicity. */
  readonly factors = { support: 0, comb: 0, salience: 0, recent: 0 };
  /** Confidence contributed by the neural arbiter (decays when not refreshed). */
  neuralConfidence = 0;

  private meanOdf = 0;
  private pending: number[] = [];
  private relockVotes = 0;
  private relockPhase = 0;
  private tempoVotes = 0;
  private tempoTarget = 0;
  /** The last period tracked with confidence, and when (frames): returning to it is no suspicious jump. */
  private confidentPeriod = 0;
  private confidentAt = -Infinity;
  /** Start (frames) and period of the current run of confident beats at a steady period. */
  private streakSince = -1;
  private streakPeriod = 0;
  private forceRelock = false;
  private lastFrame = -1;

  private t: TrackerTuning;
  private readonly baseTuning: TrackerTuning;

  constructor(o: BeatTrackerOptions) {
    this.baseTuning = { ...DEFAULT_TUNING, ...o.tuning };
    this.t = this.baseTuning;
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
          const remembered = (p: number) => this.confidentPeriod > 0 && h - this.confidentAt < CONFIDENT_MEMORY_S * this.frameRate
            && Math.abs(p / this.confidentPeriod - 1) < 0.03;
          // Back to the tempo followed with confidence shortly before: no 3:2 / 4:3 evidence
          // needed (after a breakdown the estimate wanders and the way back can be any ratio).
          // Octave-type returns still respect the neural octave lock: the network may just have
          // re-timed away from that tempo.
          const back = remembered(c.period);
          // 3:2- and 4:3-type jumps are almost never real: a song does not suddenly play a third
          // faster, but syncopated and dotted rhythms repeat at those ratios (154 -> 114 -> 103
          // BPM on a rock song). 3:2 jumps need lost onset support; 4:3 jumps are guarded the
          // same way when they would leave a tempo followed with confidence. A clock without
          // confidence that the estimate keeps out-voting may jump anyway (dense music supports
          // a wrong grid too). The neural veto blocks octave-type jumps; genuine tempo changes
          // stay free.
          const leaves43 = near([4 / 3, 3 / 4]) && remembered(this.period);
          const octave = near([2, 0.5, 1.5, 2 / 3, 3, 1 / 3]) || leaves43;
          const triple = !back && (near([1.5, 2 / 3, 3, 1 / 3]) || leaves43);
          const stuck = this.confidence < 0.3 && this.tempoVotes >= METRICAL_PERSIST_VOTES;
          // while the network vouches for the tempo, no metrical jump away from it (4:3 included)
          const vouched = octave || (near([4 / 3, 3 / 4]) && !back);
          const allowed = (vouched ? this.octaveJumpsAllowed : true) && (!triple || this.support < 0.5 || stuck);
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
      this.pulse.reset();
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
          this.pulse.reset();
        }
      }
    } else {
      this.relockVotes = 0;
    }
  }

  /** Shift the clock phase by `frames` (neural arbiter); keeps the next beat in the future. */
  shiftPhase(frames: number, now: number): void {
    if (this.period <= 0) return;
    this.nextBeat += frames;
    this.normalizeNext(now);
    this.pending.length = 0;
    this.relockVotes = 0;
    this.pulse.reset();
  }

  /** Replace period and phase (neural arbiter: octave error or tempo change). */
  retime(period: number, nextBeat: number, now: number): void {
    this.period = period;
    this.nextBeat = nextBeat;
    this.locked = true;
    this.normalizeNext(now);
    this.pending.length = 0;
    this.relockVotes = 0;
    this.tempoVotes = 0;
    this.forceRelock = false;
    this.pulse.reset();
    // the network says the tempo was wrong: do not treat a return to it as a safe way back
    this.confidentPeriod = 0;
    this.streakSince = -1;
  }

  /** Style-specific overrides on top of the tuning the tracker was created with. */
  setTuning(overrides: Partial<TrackerTuning> | undefined): void {
    this.t = { ...this.baseTuning, ...overrides };
  }

  /**
   * A new Music style: fold the current period into its tempo range and re-lock the phase on
   * the next tempo update (the tracker stays locked, so beats keep coming).
   */
  setRange(minBpm: number, maxBpm: number, pulseMode: PulseMode, pulseMaxBpm: number): void {
    const fr = this.frameRate;
    this.pulse.mode = pulseMode;
    this.halfTimeBelow = pulseMode !== 'every' && Number.isFinite(pulseMaxBpm) ? (60 * fr) / pulseMaxBpm : 0;
    if (this.period > 0) this.period = foldPeriod(this.period, fr, minBpm, maxBpm);
    this.tempoVotes = 0;
    this.tempoTarget = 0;
    this.relockVotes = 0;
    if (this.locked) this.forceRelock = true;
    this.pulse.reset();
  }

  /** Next beat on the pulse (position and running index) and the pulse period (frames). */
  get nextPulse(): { position: number; index: number; period: number } {
    const div = this.pulse.divisor;
    if (div === 1 || this.pulse.isPulse(this.nextBeat, this.period)) return { position: this.nextBeat, index: this.index, period: this.period * div };
    return { position: this.nextBeat + this.period, index: this.index + 1, period: this.period * div };
  }

  private normalizeNext(now: number): void {
    while (this.nextBeat <= now + 0.1 * this.period) this.nextBeat += this.period;
    while (this.nextBeat - this.period > now + 0.1 * this.period) this.nextBeat -= this.period;
  }

  /** A kick onset within +-30 ms of true-time position x (the mix's pickup 75 ms early is outside). */
  private kickAt(x: number): boolean {
    const odf = this.kickOdf;
    if (!odf) return false;
    const tol = Math.round(0.03 * this.frameRate);
    const c = Math.round(x + this.kickLag - 1);
    let m = 0;
    for (let d = -tol; d <= tol; d++) m = Math.max(m, odf.at(c + d));
    return m > 2.5;
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
      out.push({
        position: this.nextBeat, index: this.index, confidence: this.confidence, period: this.period,
        pulse: this.pulse.isPulse(this.nextBeat, this.period),
      });
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
      this.pulse.observe(x, {
        supported,
        strength: bestVal / Math.max(this.meanOdf, 0.05),
        kick: this.kickAt(x),
      }, this.period, this.halfTimeBelow > 0 && this.period < this.halfTimeBelow);
      if (supported) {
        const e = bestPos - x;
        this.nextBeat += this.t.pllPhaseGain * e;
        this.period += this.t.pllPeriodGain * e;
      }
    }

    const combFactor = Math.min(1, Math.max(0, (this.contrast - 1.1) / 0.9));
    const salienceFactor2 = Math.min(1, Math.max(0, (this.tempoSalience - this.t.salienceFloor) / (this.t.salienceFull - this.t.salienceFloor)));
    this.neuralConfidence *= 1 - 1 / (this.frameRate * 5); // fades within ~one inference interval
    // Confidence follows *current* onset support; the comb only scales it (it remembers the
    // last 32 beats, so on its own it would stay high through a breakdown).
    // ... and is gated by periodicity *at the clock's phase over the last 4 beats*: noise,
    // pads and breakdowns have random onsets that can "support" beats, but no periodicity.
    const recentFactor = Math.min(1, Math.max(0, (this.recentContrast - this.t.recentFloor) / (this.t.recentFull - this.t.recentFloor)));
    const dsp = this.support * (0.6 + 0.4 * combFactor) * salienceFactor2 * recentFactor;
    const f = this.factors;
    f.support = this.support;
    f.comb = 0.6 + 0.4 * combFactor;
    f.salience = salienceFactor2;
    f.recent = recentFactor;
    this.confidence = Math.max(dsp, Math.min(this.neuralConfidence, this.support + 0.3));
    if (this.confidence >= 0.5 && this.streakSince >= 0 && Math.abs(this.period / this.streakPeriod - 1) < 0.03) {
      if (h - this.streakSince >= CONFIDENT_STREAK_S * this.frameRate) {
        this.confidentPeriod = this.period;
        this.confidentAt = h;
      }
    } else if (this.confidence >= 0.5) {
      this.streakSince = h;
      this.streakPeriod = this.period;
    } else {
      this.streakSince = -1;
    }
  }
}

/**
 * Fold a beat period (frames) by octaves into [minBpm, maxBpm]; when no octave fits (a range
 * narrower than an octave), the octave closest to the range.
 */
export function foldPeriod(period: number, frameRate: number, minBpm: number, maxBpm: number): number {
  let best = period;
  let bestDist = Infinity;
  for (let k = -3; k <= 3; k++) {
    const p = period * Math.pow(2, k);
    const bpm = (60 * frameRate) / p;
    const dist = bpm > maxBpm ? Math.log2(bpm / maxBpm) : bpm < minBpm ? Math.log2(minBpm / bpm) : 0;
    if (dist < bestDist - 1e-12 || (dist === bestDist && k === 0)) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}
