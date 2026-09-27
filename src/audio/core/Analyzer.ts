import { BeatTracker, type BeatEvent, type TrackerTuning } from './beatTracker.ts';
import { LevelTracker } from './levels.ts';
import { NeuralArbiter, type ArbiterDecision } from './neuralArbiter.ts';
import { MelFrontend, MODEL_FPS, N_MELS } from '../neural/melFrontend.ts';
import { OnsetFeatures, type OnsetFrame } from './onset.ts';
import { PeakPicker } from './peakPicker.ts';
import { FrameHistory } from './ring.ts';
import { TempoEstimator } from './tempo.ts';

export type OnsetKind = 'kick' | 'snare' | 'hat';

export type AnalyzerEvent =
  | { type: 'beat'; time: number; index: number; confidence: number; bpm: number }
  | { type: OnsetKind; time: number; strength: number };

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
  tempoSalience: number;
  locked: boolean;
  confidence: number;
  /** Beat period in seconds (0 until a tempo is known). */
  period: number;
  /** Predicted time of the next beat and its index. */
  nextBeatTime: number;
  nextBeatIndex: number;
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
  private readonly frame: OnsetFrame = { broad: 0, kick: 0, mid: 0, hat: 0, rms: 0, peak: 0 };
  private readonly hopBuf: Float64Array;
  private hopFill = 0;
  private frameIndex = 0;

  private readonly phaseOdf: FrameHistory;
  private readonly tempoOdf: FrameHistory;
  private readonly tempo: TempoEstimator;
  private readonly tempoEvery: number;
  private readonly tracker: BeatTracker;
  private readonly levels: LevelTracker;
  private readonly pickers: Record<OnsetKind, PeakPicker>;
  private readonly lags: Record<OnsetKind, number>;
  private meanBroad = 0;
  private meanMid = 0;
  private readonly meanCoef: number;
  private readonly beatScratch: BeatEvent[] = [];
  private events: AnalyzerEvent[] = [];

  private readonly mel: MelFrontend | null;
  private readonly arbiter: NeuralArbiter | null;
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
    this.phaseOdf = new FrameHistory(Math.ceil(fr * 40)); // comb needs up to combBeats x slowest period
    this.tempoOdf = new FrameHistory(Math.ceil(fr * 10));
    this.tempo = new TempoEstimator({ frameRate: fr, windowS: options.tempoWindowS ?? 8 });
    this.tempoEvery = Math.round(fr / 4);
    this.tracker = new BeatTracker({ frameRate: fr, lag: MID_LAG_S * fr, tuning: options.tuning });
    this.levels = new LevelTracker({ frameRate: fr });
    this.meanCoef = 1 - Math.exp(-1 / (4 * fr));
    this.pickers = {
      kick: new PeakPicker({ frameRate: fr, k: 1.5, delta: 0.05, minIntervalS: 0.1 }),
      snare: new PeakPicker({ frameRate: fr, k: 2, delta: 0.02, minIntervalS: 0.08 }),
      hat: new PeakPicker({ frameRate: fr, k: 2, delta: 0.01, minIntervalS: 0.05 }),
    };
    this.lags = { kick: KICK_LAG_S, snare: MID_LAG_S, hat: MID_LAG_S };
    this.mel = options.neural ? new MelFrontend(sampleRate, NEURAL_WINDOW_FRAMES + 50) : null;
    this.arbiter = options.neural ? new NeuralArbiter() : null;
    this.neuralInterval = options.neuralIntervalS ?? 5;
    this.nextNeuralAt = NEURAL_FIRST_S;
    this.neuralStartedAt = 0;
    this.state = {
      time: 0, rms: 0, peak: 0, loudnessDb: -100, silent: true, agcGain: 1,
      bpm: 0, tempoSalience: 0, locked: false, confidence: 0, period: 0,
      nextBeatTime: 0, nextBeatIndex: 0,
      odfBroad: 0, odfKick: 0, odfSnare: 0, odfHat: 0, kickThreshold: 0,
      neural: { enabled: !!options.neural, runs: 0, lastDecision: options.neural ? 'pending' : 'off', consistency: 0, lockActive: false },
    };
  }

  /**
   * Pause/resume the neural front end at runtime (the "AI beat tracking" toggle). While
   * paused no log-mel frames are computed and no requests are made.
   */
  setNeuralActive(active: boolean): void {
    if (active === this.neuralActive) return;
    this.neuralActive = active;
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
    const validFrom = Math.max(first, this.mel.firstAvailableFrame) / MODEL_FPS;
    return { t0: first / MODEL_FPS, validFrom, frames };
  }

  /** Apply the beat activation (sigmoid, one value per frame) computed for a request. */
  applyNeural(t0: number, activation: Float32Array, validFrom = t0): ArbiterDecision | null {
    if (!this.arbiter) return null;
    // Beats near the start of real audio have no left context: ignore the padded part and
    // the first second after it (the arbiter itself also ignores the window's first second).
    const skip = Math.max(0, Math.round((validFrom - t0) * MODEL_FPS));
    if (skip > 0) activation = activation.map((v, i) => (i < skip + MODEL_FPS ? 0 : v));
    const tr = this.tracker;
    const now = this.frameIndex; // frames (position of the next frame start)
    const clock = { period: tr.period / this.frameRate, nextBeatTime: this.frameTime(tr.nextBeat) };
    const d = this.arbiter.decide({ t0, fps: MODEL_FPS, activation }, clock, this.state.time);
    const toFrames = (t: number) => (t * this.sampleRate) / this.hop;
    if (d.kind === 'shift') tr.shiftPhase(toFrames(d.shiftSeconds), now);
    else if (d.kind === 'confirm') {
      // Same metrical phase, but the network's (unbiased) beat times say the clock is a bit
      // off: move half-way (the DSP loop keeps refining from there).
      const offset = d.offsetFraction * clock.period;
      if (Math.abs(offset) > NEURAL_NUDGE_MIN_S) tr.shiftPhase(toFrames(0.5 * offset), now);
    }
    else if (d.kind === 'retime') tr.retime(d.period * this.frameRate, toFrames(d.nextBeatTime), now);
    if (d.kind === 'confirm' || d.kind === 'shift' || d.kind === 'retime') {
      tr.neuralConfidence = Math.max(tr.neuralConfidence, d.consistency);
    }
    const n = this.state.neural;
    n.runs++;
    n.lastDecision = d.kind;
    n.consistency = 'consistency' in d ? d.consistency : 0;
    return d;
  }

  /** Take all events produced since the previous call. */
  drainEvents(): AnalyzerEvent[] {
    const e = this.events;
    this.events = [];
    return e;
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

    // Scale-free versions of the onset functions. The beat phase comes from the mid band
    // (150 Hz - 6 kHz) only; tempo uses mid + broadband (periodicity, not phase).
    this.meanBroad += (f.broad - this.meanBroad) * this.meanCoef;
    this.meanMid += (f.mid - this.meanMid) * this.meanCoef;
    const broadN = f.broad / (this.meanBroad + 0.005);
    const midN = f.mid / (this.meanMid + 0.005);
    this.phaseOdf.push(midN);
    this.tempoOdf.push(midN + broadN);

    if (this.arbiter) this.tracker.dspJumpsAllowed = this.state.time > this.arbiter.lockUntil;
    if (h % this.tempoEvery === 0) {
      this.tracker.onTempo(this.tempo.estimate(this.tempoOdf), h, this.phaseOdf);
    }
    const beats = this.beatScratch;
    beats.length = 0;
    this.tracker.step(h, this.phaseOdf, beats);
    const silent = this.levels.silent;
    for (const b of beats) {
      this.events.push({
        type: 'beat',
        time: this.frameTime(b.position),
        index: b.index,
        confidence: silent ? 0 : b.confidence,
        bpm: (60 * this.frameRate) / b.period,
      });
    }

    for (const kind of ['kick', 'snare', 'hat'] as const) {
      const p = this.pickers[kind];
      const strength = p.push(kind === 'snare' ? f.mid : f[kind]);
      if (strength > 0 && !silent) {
        const peakFrame = h - p.lookahead;
        this.events.push({ type: kind, time: this.frameTime(peakFrame + 1) - this.lags[kind], strength });
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
    st.confidence = silent ? 0 : tr.confidence;
    st.period = tr.period > 0 ? tr.period / this.frameRate : 0;
    st.nextBeatTime = this.frameTime(tr.nextBeat);
    st.nextBeatIndex = tr.index;
    st.odfBroad = f.broad;
    st.odfKick = f.kick;
    st.odfSnare = f.mid;
    st.odfHat = f.hat;
    st.kickThreshold = this.pickers.kick.threshold;
    if (this.arbiter) st.neural.lockActive = st.time <= this.arbiter.lockUntil;
  }
}
