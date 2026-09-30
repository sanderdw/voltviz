import { BarTracker, BEATS_PER_BAR, type ClockBeat } from './bars.ts';
import { BeatStrength } from './beatStrength.ts';
import { BeatTracker, foldPeriod, type BeatEvent, type TrackerTuning } from './beatTracker.ts';
import { LevelTracker } from './levels.ts';
import { NeuralArbiter, type ArbiterDecision } from './neuralArbiter.ts';
import { MelFrontend, MODEL_FPS, N_MELS } from '../neural/melFrontend.ts';
import { OnsetFeatures, type OnsetFrame } from './onset.ts';
import { PeakPicker } from './peakPicker.ts';
import { FrameHistory } from './ring.ts';
import { SongChangeDetector } from './songChange.ts';
import { DEFAULT_STYLE, STYLE_PROFILES, type StyleId } from './styles.ts';
import { TempoEstimator } from './tempo.ts';

export type OnsetKind = 'kick' | 'snare' | 'hat';

export type AnalyzerEvent =
  | {
    type: 'beat'; time: number; index: number; confidence: number; bpm: number; pulse: boolean;
    /** 0..1: how much of an audible hit the recent beats carry (see {@link AnalyzerState.beatStrength}). */
    strength: number;
    /** Position in the bar (0 = the "1"), from the AI downbeats; -1 when unknown. */
    bar: number;
  }
  | { type: OnsetKind; time: number; strength: number }
  | {
    /**
     * A beat that was heard: a kick or snare onset on the tracked pulse grid. Emitted only
     * after the hit itself (never predicted); this is what fires beat effects.
     */
    type: 'hit'; time: number; index: number; confidence: number; strength: number;
    /** Position in the bar (0 = the "1"), from the AI downbeats; -1 when unknown. */
    bar: number;
  }
  | {
    /**
     * What beat effects fall back to while no tempo is confident: a kick (or, for styles with
     * the `accent` fallback, a snare) that stands out from the recent ones. Rate-limited and
     * weaker than a beat (strength 0..ACCENT_MAX), so soft music does not flash on every note.
     */
    type: 'accent'; time: number; strength: number;
  };

/** Snapshot of the analysis, updated every hop (~5.8 ms). Times are seconds of processed audio. */
export interface AnalyzerState {
  time: number;
  rms: number;
  peak: number;
  loudnessDb: number;
  silent: boolean;
  /** Suggested Auto Gain for the display path (linear). */
  agcGain: number;
  bpm: number;
  /** Raw tempo estimate of the latest autocorrelation (diagnostics; 0 when none). */
  tempoCandidateBpm: number;
  tempoSalience: number;
  locked: boolean;
  /**
   * 0..1: how much of an audible hit (kick, snare, clap) the recent beats carry. Low for a
   * pulse without a hit, e.g. a build-up over a pumping pad; scale beat effects by it.
   */
  beatStrength: number;
  /** The rise (dB) of the beat-aligned envelope behind `beatStrength` (diagnostics). */
  beatRise: number;
  confidence: number;
  /** Beat period in seconds (0 until a tempo is known). */
  period: number;
  /** Predicted time of the next beat and its index. */
  nextBeatTime: number;
  nextBeatIndex: number;
  /** Music style in use. */
  style: StyleId;
  /** Running beat index modulo 4 that is the "1" of the bar (AI downbeats); -1 while unknown. */
  barPhase: number;
  /** Song changes detected so far, and the timbre novelty behind them (diagnostics). */
  songChanges: number;
  novelty: number;
  /** Stream time (s) of the latest song change; -1 before the first. */
  songChangeAt: number;
  /**
   * The pulse beat effects follow: every tracked beat (divisor 1) or every other one (2, the
   * half-time pulse). Period in seconds; the next pulse beat's time and running beat index.
   */
  pulseDivisor: number;
  pulsePeriod: number;
  nextPulseTime: number;
  nextPulseIndex: number;
  /**
   * Onset evidence on the pulse beats and on the beats in between (diagnostics): support rate,
   * mean mid-band strength and kick rate, pulse parity first.
   */
  pulseSupport: { on: number; off: number; strength: number[]; kick: number[] };
  /** Onset functions of the newest frame (for diagnostics / display). */
  odfBroad: number;
  odfKick: number;
  odfSnare: number;
  odfHat: number;
  kickThreshold: number;
  /** Neural arbitration status (only meaningful when the neural path is enabled). */
  neural: {
    enabled: boolean;
    runs: number;
    lastDecision: ArbiterDecision['kind'] | 'pending' | 'off';
    consistency: number;
    lockActive: boolean;
  };
}

export interface AnalyzerOptions {
  tuning?: Partial<TrackerTuning>;
  /** Compute the model input (log-mel frames) and accept neural phase arbitration. */
  neural?: boolean;
  /** Seconds of stream time between neural requests (default 5). */
  neuralIntervalS?: number;
  /** Length of the tempo autocorrelation window (default 8 s). */
  tempoWindowS?: number;
  /** Music style (default auto). */
  style?: StyleId;
  /** Detect song changes and restart the beat search quickly (default true). */
  songChange?: boolean;
}

/** A request for the beat model: 500 log-mel frames (10 s) ending now. */
export interface NeuralRequest {
  /** Stream time (s) of frame 0 (negative when the window is zero-padded at the start). */
  t0: number;
  /** Stream time (s) where real audio starts in this window (after any padding). */
  validFrom: number;
  frames: Float32Array;
}

export const NEURAL_WINDOW_FRAMES = 500;
/** First request after this many seconds of audio (the older part of the window is padded). */
const NEURAL_FIRST_S = 4;
/** Faster cadence while the tracker settles after a (re)start. */
const NEURAL_STARTUP_S = 20;
const NEURAL_STARTUP_INTERVAL_S = 2.5;
/** Timing disagreement (s) above which a confirming window nudges the clock. */
const NEURAL_NUDGE_MIN_S = 0.015;

/**
 * Calibrated detection delays (seconds) of the onset functions: an onset at time T shows its
 * peak in the frame ending at T + lag. Measured on synthetic kicks/clicks in the unit tests
 * (`tests/unit/analyzer.test.ts` asserts the calibrated offsets are within +-5 ms).
 */
export const KICK_LAG_S = 0.012;
export const MID_LAG_S = 0.004;

/** A heard kick/snare counts as a beat within this distance (s) of the tracked pulse grid ... */
export const HIT_GRID_S = 0.05;
/** ... at least this many pulse periods after the previous one ... */
export const HIT_MIN_GAP = 0.6;
/** ... only while the tracked tempo is this confident ... */
export const HIT_CONFIDENCE_MIN = 0.3;
/**
 * ... and only for an onset at least this fraction of the recent hits' median strength. Pads,
 * risers and noise in a breakdown produce weak onsets, some of which land on the grid by chance.
 */
export const HIT_STRENGTH_REL = 0.15;
const HIT_STRENGTH_HISTORY = 16;

/**
 * Accents (the fallback while no tempo is confident): at least this many seconds apart ...
 * The onset pickers are scale-free, so soft music (a ballad, a piano) produces as many kick
 * and snare onsets as a club track, up to ~9 per second: firing all of them flashed calm music
 * harder than dubstep.
 */
export const ACCENT_GAP_S = 0.4;
/** ... only for an onset at least this multiple of the recent candidates' median strength ... */
export const ACCENT_REL = 1.3;
/** ... and at most this strong: below STRONG_BEAT, so they never trigger one-off beat events. */
export const ACCENT_MAX = 0.45;
const ACCENT_HISTORY = 24;


/**
 * The analysis engine: feed it mono PCM in blocks of any size; it produces a continuously
 * updated {@link AnalyzerState} and a stream of timestamped events (beats and kick / snare /
 * hat onsets). Deterministic and dependency-free, so exactly the same code runs in the
 * AudioWorklet, in the main-thread fallback and in Node for tests and offline evaluation.
 */
export class Analyzer {
  readonly sampleRate: number;
  readonly hop: number;
  readonly frameRate: number;
  readonly state: AnalyzerState;

  private readonly onset: OnsetFeatures;
  private readonly frame: OnsetFrame = { broad: 0, kick: 0, mid: 0, hat: 0, snareRise: 0, kickRise: 0, lowEnergy: 0, clickEnergy: 0, rms: 0, peak: 0 };
  private readonly hopBuf: Float64Array;
  private hopFill = 0;
  private frameIndex = 0;

  private readonly phaseOdf: FrameHistory;
  private readonly tempoOdf: FrameHistory;
  /** Tempo estimator of the current style (exposed for diagnostics). */
  tempo: TempoEstimator;
  private readonly tempoWindowS: number;
  private readonly tempoEvery: number;
  /** The beat tracker (exposed for diagnostics). */
  readonly tracker: BeatTracker;
  private readonly levels: LevelTracker;
  private readonly pickers: Record<OnsetKind, PeakPicker>;
  private readonly lags: Record<OnsetKind, number>;
  private meanBroad = 0;
  private meanMid = 0;
  private meanKick = 0;
  private meanSnare = 0;
  private meanKickRise = 0;
  private readonly kickOdf: FrameHistory;
  private readonly snareOdf: FrameHistory;
  private readonly kickRiseOdf: FrameHistory;
  private readonly meanCoef: number;
  private readonly beatScratch: BeatEvent[] = [];
  private events: AnalyzerEvent[] = [];

  private readonly mel: MelFrontend | null;
  private readonly arbiter: NeuralArbiter | null;
  private readonly bars = new BarTracker();
  private readonly strength: BeatStrength;
  private lastHitTime = -Infinity;
  private readonly hitStrengths: number[] = [];
  private lastAccentTime = -Infinity;
  private readonly accentStrengths: number[] = [];
  private readonly change: SongChangeDetector | null;
  /** First frame of the new song after a song change, while the tempo window still reaches back into the old one. */
  private songStartFrame = -1;
  /** Stream time before which audio is ignored by the next neural windows (the previous song). */
  private neuralValidFrom = 0;
  private tempoLeaps = 0;
  private readonly neuralInterval: number;
  private nextNeuralAt = 0;
  private neuralActive = true;
  private neuralStartedAt = 0;

  constructor(sampleRate: number, options: AnalyzerOptions = {}) {
    this.sampleRate = sampleRate;
    this.onset = new OnsetFeatures(sampleRate);
    this.hop = this.onset.hop;
    this.frameRate = this.onset.frameRate;
    this.hopBuf = new Float64Array(this.hop);
    const fr = this.frameRate;
    // the comb needs up to combBeats x the slowest period of any style (32 x 1.2 s at 50 BPM)
    this.phaseOdf = new FrameHistory(Math.ceil(fr * 45));
    this.tempoOdf = new FrameHistory(Math.ceil(fr * 10));
    this.kickOdf = new FrameHistory(Math.ceil(fr * 4));
    this.snareOdf = new FrameHistory(Math.ceil(fr * 4));
    this.kickRiseOdf = new FrameHistory(Math.ceil(fr * 4));
    this.tempoWindowS = options.tempoWindowS ?? 8;
    const style = options.style ?? DEFAULT_STYLE;
    this.tempo = this.makeTempo(style);
    this.tempoEvery = Math.round(fr / 4);
    this.tracker = new BeatTracker({ frameRate: fr, lag: MID_LAG_S * fr, tuning: options.tuning });
    this.tracker.kickOdf = this.kickOdf;
    this.tracker.snareOdf = this.snareOdf;
    this.tracker.kickRiseOdf = this.kickRiseOdf;
    this.tracker.kickLag = KICK_LAG_S * fr;
    const prof = STYLE_PROFILES[style].tempo;
    this.tracker.setTuning(STYLE_PROFILES[style].tracker);
    this.tracker.setRange(prof.minBpm, prof.maxBpm, STYLE_PROFILES[style].pulse.mode, STYLE_PROFILES[style].pulse.maxBpm);
    this.levels = new LevelTracker({ frameRate: fr });
    this.strength = new BeatStrength(fr);
    this.meanCoef = 1 - Math.exp(-1 / (4 * fr));
    this.pickers = {
      kick: new PeakPicker({ frameRate: fr, k: 1.5, delta: 0.05, minIntervalS: 0.1 }),
      snare: new PeakPicker({ frameRate: fr, k: 2, delta: 0.02, minIntervalS: 0.08 }),
      hat: new PeakPicker({ frameRate: fr, k: 2, delta: 0.01, minIntervalS: 0.05 }),
    };
    this.lags = { kick: KICK_LAG_S, snare: MID_LAG_S, hat: MID_LAG_S };
    this.change = options.songChange === false ? null : new SongChangeDetector(fr, this.onset.bandCount);
    this.mel = options.neural ? new MelFrontend(sampleRate, NEURAL_WINDOW_FRAMES + 50) : null;
    this.arbiter = options.neural ? new NeuralArbiter() : null;
    this.neuralInterval = options.neuralIntervalS ?? 5;
    this.nextNeuralAt = NEURAL_FIRST_S;
    this.neuralStartedAt = 0;
    this.state = {
      time: 0, rms: 0, peak: 0, loudnessDb: -100, silent: true, agcGain: 1,
      bpm: 0, tempoCandidateBpm: 0, tempoSalience: 0, locked: false, beatStrength: 0, beatRise: 0, confidence: 0, period: 0,
      nextBeatTime: 0, nextBeatIndex: 0,
      style, barPhase: -1, songChanges: 0, novelty: 0, songChangeAt: -1, pulseDivisor: 1, pulsePeriod: 0, nextPulseTime: 0, nextPulseIndex: 0, pulseSupport: { on: 0, off: 0, strength: [0, 0], kick: [0, 0] },
      odfBroad: 0, odfKick: 0, odfSnare: 0, odfHat: 0, kickThreshold: 0,
      neural: { enabled: !!options.neural, runs: 0, lastDecision: options.neural ? 'pending' : 'off', consistency: 0, lockActive: false },
    };
  }

  private makeTempo(style: StyleId): TempoEstimator {
    const t = STYLE_PROFILES[style].tempo;
    return new TempoEstimator({
      frameRate: this.frameRate, windowS: this.tempoWindowS,
      minBpm: t.minBpm, maxBpm: t.maxBpm, priorBpm: t.priorBpm, priorOctaves: t.priorOctaves,
    });
  }

  /**
   * Switch the Music style at runtime: new tempo range and prior, the current tempo folded
   * into the range and the phase re-locked on the next tempo update. Beats keep coming.
   */
  setStyle(style: StyleId): void {
    if (style === this.state.style) return;
    const p = STYLE_PROFILES[style];
    this.tempo = this.makeTempo(style);
    this.tracker.setTuning(p.tracker);
    this.tracker.setRange(p.tempo.minBpm, p.tempo.maxBpm, p.pulse.mode, p.pulse.maxBpm);
    this.arbiter?.reset();
    this.state.style = style;
  }

  /**
   * Pause/resume the neural front end at runtime (the "AI beat tracking" toggle). While
   * paused no log-mel frames are computed and no requests are made.
   */
  setNeuralActive(active: boolean): void {
    if (active === this.neuralActive) return;
    this.neuralActive = active;
    // a stale neural lock must not keep blocking the DSP (and a fresh start starts unlocked)
    this.arbiter?.reset();
    this.bars.reset();
    // the mel history is stale after a pause: start over like a fresh start
    if (active && this.mel) this.mel.reset();
    this.neuralStartedAt = this.state.time;
    this.nextNeuralAt = this.state.time + NEURAL_FIRST_S;
    this.state.neural.enabled = active && !!this.mel;
    if (!active) this.state.neural.lastDecision = 'off';
  }

  /** Feed mono samples (any block size). */
  process(samples: ArrayLike<number>, length: number = samples.length): void {
    if (this.neuralActive) this.mel?.push(samples, length);
    let i = 0;
    while (i < length) {
      const take = Math.min(this.hop - this.hopFill, length - i);
      for (let k = 0; k < take; k++) this.hopBuf[this.hopFill + k] = samples[i + k];
      this.hopFill += take;
      i += take;
      if (this.hopFill === this.hop) {
        this.hopFill = 0;
        this.processFrame();
      }
    }
  }

  /**
   * When the neural path is enabled and a new window is due, returns the model input (the
   * caller runs the model, possibly asynchronously, and passes the result to applyNeural).
   */
  takeNeuralRequest(): NeuralRequest | null {
    if (!this.mel || !this.neuralActive || this.state.time < this.nextNeuralAt) return null;
    const frames = new Float32Array(NEURAL_WINDOW_FRAMES * N_MELS);
    const first = this.mel.latestPadded(NEURAL_WINDOW_FRAMES, frames);
    const settling = this.state.time - this.neuralStartedAt < NEURAL_STARTUP_S;
    this.nextNeuralAt = this.state.time + (settling ? Math.min(NEURAL_STARTUP_INTERVAL_S, this.neuralInterval) : this.neuralInterval);
    const validFrom = Math.max(first, this.mel.firstAvailableFrame, this.neuralValidFrom * MODEL_FPS) / MODEL_FPS;
    return { t0: first / MODEL_FPS, validFrom, frames };
  }

  /**
   * Apply the beat activation (sigmoid, one value per frame) computed for a request, and the
   * downbeat activation when the model provides it.
   */
  applyNeural(t0: number, activation: Float32Array, validFrom = t0, downbeat?: Float32Array): ArbiterDecision | null {
    if (!this.arbiter) return null;
    // a window requested before a song change: only the new song's part counts
    validFrom = Math.max(validFrom, this.neuralValidFrom);
    // Beats near the start of real audio have no left context: ignore the padded part and
    // the first second after it (the arbiter itself also ignores the window's first second).
    const skip = Math.max(0, Math.round((validFrom - t0) * MODEL_FPS));
    if (skip > 0) activation = activation.map((v, i) => (i < skip + MODEL_FPS ? 0 : v));
    const tr = this.tracker;
    const now = this.frameIndex; // frames (position of the next frame start)
    const clock = {
      period: tr.period / this.frameRate, nextBeatTime: this.frameTime(tr.nextBeat), confidence: tr.confidence,
      estimatePeriod: this.state.tempoCandidateBpm > 0 ? 60 / this.state.tempoCandidateBpm : undefined,
    };
    const d = this.arbiter.decide({ t0, fps: MODEL_FPS, activation }, clock, this.state.time);
    const toFrames = (t: number) => (t * this.sampleRate) / this.hop;
    if (d.kind === 'shift') tr.shiftPhase(toFrames(d.shiftSeconds), now);
    else if (d.kind === 'confirm') {
      // Same metrical phase, but the network's (unbiased) beat times say the clock is a bit
      // off: move half-way (the DSP loop keeps refining from there).
      const offset = d.offsetFraction * clock.period;
      if (Math.abs(offset) > NEURAL_NUDGE_MIN_S) tr.shiftPhase(toFrames(0.5 * offset), now);
    }
    else if (d.kind === 'retime') {
      // the network's metrical level, folded into the style's range (a narrow range and the
      // network would otherwise disagree forever)
      const t = STYLE_PROFILES[this.state.style].tempo;
      tr.retime(foldPeriod(d.period * this.frameRate, this.frameRate, t.minBpm, t.maxBpm), toFrames(d.nextBeatTime), now);
    }
    if (d.kind === 'confirm' || d.kind === 'shift' || d.kind === 'retime') {
      tr.neuralConfidence = Math.max(tr.neuralConfidence, d.consistency);
    }
    // Bar position: only when the network and the clock agree on the beat (the clock may just
    // have shifted onto it); the downbeats are read at the clock's own beats.
    if (downbeat && (d.kind === 'confirm' || d.kind === 'shift') && tr.period > 0) {
      const period = tr.period / this.frameRate;
      const next = this.frameTime(tr.nextBeat);
      const from = validFrom + 1, to = t0 + downbeat.length / MODEL_FPS - 0.5;
      const beats: ClockBeat[] = [];
      for (let k = Math.ceil((from - next) / period); next + k * period < to; k++) beats.push({ time: next + k * period, index: tr.index + k });
      this.bars.update({ t0, fps: MODEL_FPS, activation: downbeat }, beats, tr.jumps);
    }
    const n = this.state.neural;
    n.runs++;
    n.lastDecision = d.kind;
    n.consistency = 'consistency' in d ? d.consistency : 0;
    return d;
  }

  /** The source reports a new song (e.g. track metadata): same as a detected song change. */
  songChanged(): void {
    this.onSongChange();
  }

  /**
   * A new song: drop what belongs to the old one (AI locks and pending decisions, the bar
   * position, the remembered tempo), search the beat phase again on the new song's onsets, and
   * let the AI look again at once, at its start-up cadence, at the new song's audio only. The
   * DSP clock keeps running.
   */
  private onSongChange(): void {
    const t = this.frameTime(this.frameIndex);
    this.arbiter?.reset();
    this.bars.reset();
    this.tracker.newSong(this.frameIndex);
    this.songStartFrame = this.frameIndex;
    this.neuralValidFrom = t;
    this.neuralStartedAt = t;
    this.nextNeuralAt = t + NEURAL_FIRST_S;
    this.state.songChanges++;
    this.state.songChangeAt = t;
  }

  /** Take all events produced since the previous call. */
  drainEvents(): AnalyzerEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /**
   * A kick or snare was heard at `time`: a beat when it lands on the tracked pulse grid. The
   * grid only filters (hits between the beats, pickups and bass notes do not count); nothing
   * fires without a hit.
   */
  private hit(time: number, onsetStrength: number): void {
    const recent = this.hitStrengths;
    if (recent.length) {
      const sorted = [...recent].sort((a, b) => a - b);
      if (onsetStrength < HIT_STRENGTH_REL * sorted[sorted.length >> 1]) return;
    }
    const tr = this.tracker;
    const pulse = tr.nextPulse;
    if (!tr.locked || pulse.period <= 0 || tr.confidence < HIT_CONFIDENCE_MIN) return;
    const period = pulse.period / this.frameRate;
    const k = Math.round((time - this.frameTime(pulse.position)) / period);
    if (Math.abs(time - (this.frameTime(pulse.position) + k * period)) > HIT_GRID_S) return;
    const index = pulse.index + k * tr.pulse.divisor;
    if (time - this.lastHitTime < HIT_MIN_GAP * period) return;
    this.lastHitTime = time;
    recent.push(onsetStrength);
    if (recent.length > HIT_STRENGTH_HISTORY) recent.shift();
    this.events.push({
      type: 'hit', time, index, confidence: tr.confidence, strength: this.strength.strength,
      bar: tr.barPhase >= 0 ? (((index - tr.barPhase) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR : -1,
    });
  }

  /**
   * A fallback candidate (a kick, or a snare for accent styles) was heard at `time`: an accent
   * when no tempo is confident and it stands out from the recent candidates. The history is kept
   * while the tempo is confident too, so it is warm when the tempo drops out.
   */
  private accent(time: number, onsetStrength: number): void {
    const recent = this.accentStrengths;
    const sorted = [...recent].sort((a, b) => a - b);
    const median = sorted.length ? sorted[sorted.length >> 1] : 0;
    recent.push(onsetStrength);
    if (recent.length > ACCENT_HISTORY) recent.shift();
    if (this.tracker.confidence >= HIT_CONFIDENCE_MIN) return;
    if (onsetStrength < ACCENT_REL * median || time - this.lastAccentTime < ACCENT_GAP_S) return;
    this.lastAccentTime = time;
    this.events.push({ type: 'accent', time, strength: ACCENT_MAX * Math.min(1, onsetStrength / (2 * Math.max(median, 0.1))) });
  }

  private frameTime(frameEnd: number): number {
    return (frameEnd * this.hop) / this.sampleRate;
  }

  private processFrame(): void {
    const f = this.frame;
    this.onset.processHop(this.hopBuf, 0, f);
    const h = this.frameIndex++;
    const st = this.state;

    this.levels.update(f.rms, f.peak);
    this.strength.push(f.lowEnergy, f.clickEnergy, f.rms * f.rms);

    // Scale-free versions of the onset functions. The beat phase comes from the mid band
    // (150 Hz - 6 kHz) only; tempo uses mid + broadband (periodicity, not phase).
    this.meanBroad += (f.broad - this.meanBroad) * this.meanCoef;
    this.meanMid += (f.mid - this.meanMid) * this.meanCoef;
    const broadN = f.broad / (this.meanBroad + 0.005);
    const midN = f.mid / (this.meanMid + 0.005);
    this.phaseOdf.push(midN);
    this.tempoOdf.push(midN + broadN);
    this.meanKick += (f.kick - this.meanKick) * this.meanCoef;
    this.kickOdf.push(f.kick / (this.meanKick + 0.005));
    this.meanSnare += (f.snareRise - this.meanSnare) * this.meanCoef;
    this.snareOdf.push(f.snareRise / (this.meanSnare + 1e-9));
    this.meanKickRise += (f.kickRise - this.meanKickRise) * this.meanCoef;
    this.kickRiseOdf.push(f.kickRise / (this.meanKickRise + 1e-9));

    this.tracker.barPhase = this.bars.validFor(this.tracker.jumps) ? this.bars.phase : -1;
    if (this.arbiter) {
      this.tracker.dspJumpsAllowed = this.state.time > this.arbiter.lockUntil;
      this.tracker.octaveJumpsAllowed = this.state.time > this.arbiter.octaveLockUntil;
    }
    if (h % this.tempoEvery === 0) {
      // after a song change the tempo window holds the new song only, once it has enough of it
      const since = this.songStartFrame >= 0 ? h + 1 - this.songStartFrame : Infinity;
      if (since >= this.tempo.windowFrames) this.songStartFrame = -1;
      const cand = this.tempo.estimate(this.tempoOdf, since >= this.tempo.warmupFrames ? since : Infinity);
      this.state.tempoCandidateBpm = cand ? cand.bpm : 0;
      this.tracker.onTempo(cand, h, this.phaseOdf);
    }
    const leapt = this.tracker.tempoLeaps !== this.tempoLeaps;
    this.tempoLeaps = this.tracker.tempoLeaps;
    const t = this.frameTime(h + 1);
    if (this.change?.update(t, this.levels.silent, this.onset.currentBands, this.state.tempoCandidateBpm, this.tracker.bpm)
      || (leapt && this.change?.tempoLeap(t))) {
      this.onSongChange();
    }
    const beats = this.beatScratch;
    beats.length = 0;
    this.tracker.step(h, this.phaseOdf, beats);
    const silent = this.levels.silent;
    for (const b of beats) {
      this.strength.onBeat(b.position);
      this.events.push({
        type: 'beat',
        time: this.frameTime(b.position),
        index: b.index,
        confidence: silent ? 0 : b.confidence,
        bpm: (60 * this.frameRate) / b.period,
        pulse: b.pulse,
        strength: this.strength.strength,
        bar: this.tracker.barPhase >= 0 ? (((b.index - this.tracker.barPhase) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR : -1,
      });
    }

    for (const kind of ['kick', 'snare', 'hat'] as const) {
      const p = this.pickers[kind];
      const strength = p.push(kind === 'snare' ? f.mid : f[kind]);
      if (strength > 0 && !silent) {
        const peakFrame = h - p.lookahead;
        const time = this.frameTime(peakFrame + 1) - this.lags[kind];
        this.events.push({ type: kind, time, strength });
        if (kind !== 'hat') this.hit(time, strength);
        if (kind === 'kick' || (kind === 'snare' && STYLE_PROFILES[st.style].fallback === 'accent')) this.accent(time, strength);
      }
    }

    const tr = this.tracker;
    st.time = this.frameTime(h + 1);
    st.rms = f.rms;
    st.peak = this.levels.peak;
    st.loudnessDb = this.levels.loudnessDb;
    st.silent = silent;
    st.agcGain = this.levels.gain;
    st.bpm = tr.bpm;
    st.tempoSalience = tr.tempoSalience;
    st.locked = tr.locked;
    st.beatStrength = this.strength.strength;
    st.beatRise = this.strength.rise;
    st.confidence = silent ? 0 : tr.confidence;
    st.period = tr.period > 0 ? tr.period / this.frameRate : 0;
    st.nextBeatTime = this.frameTime(tr.nextBeat);
    st.nextBeatIndex = tr.index;
    st.barPhase = tr.barPhase;
    st.novelty = this.change?.novelty ?? 0;
    const pulse = tr.nextPulse;
    st.pulseDivisor = tr.pulse.divisor;
    st.pulsePeriod = pulse.period > 0 ? pulse.period / this.frameRate : 0;
    st.nextPulseTime = this.frameTime(pulse.position);
    st.nextPulseIndex = pulse.index;
    st.pulseSupport.on = tr.pulse.on;
    st.pulseSupport.off = tr.pulse.off;
    const ps = tr.pulse.stats;
    st.pulseSupport.strength[0] = ps.strength[0];
    st.pulseSupport.strength[1] = ps.strength[1];
    st.pulseSupport.kick[0] = ps.kick[0];
    st.pulseSupport.kick[1] = ps.kick[1];
    st.odfBroad = f.broad;
    st.odfKick = f.kick;
    st.odfSnare = f.mid;
    st.odfHat = f.hat;
    st.kickThreshold = this.pickers.kick.threshold;
    if (this.arbiter) st.neural.lockActive = st.time <= this.arbiter.lockUntil;
  }
}
