/**
 * The audio engine: one AudioContext per session, fed by any source, producing one
 * {@link AudioFrame} per animation frame that all visualizers (and crossfade layers) share.
 *
 *   source ─┬─> analysis host (AudioWorklet, or ScriptProcessor fallback): beats, onsets, tempo
 *           └─> Auto Gain (GainNode) ─> shared display analysers (spectrum / waveform / stereo)
 *
 * The analysis runs on the audio thread at a fixed hop rate, independent of the render frame
 * rate. Beats are *heard*, never predicted: `beat.isBeat` is true in the first frame after the
 * analysis detected a kick or snare on the tracked beat grid (~15-25 ms after the hit). The
 * tempo only filters which hits count; when the drums stop, the beats stop.
 */
import type { AnalyzerEvent, AnalyzerState } from './core/Analyzer';
import { DEFAULT_STYLE } from './core/styles';
import { AnalyserPool } from './host/analyserPool';
import type { HostToEngine } from './host/protocol';
import { createScriptProcessorHost, createWorkletHost, type AnalysisHost } from './host/scriptProcessorHost';
import workletUrl from './host/analysis.worklet.ts?worker&url';
import { NeuralClient } from './neural/NeuralClient';
import type { AudioFrame, AudioInput, Bands, BeatInfo, EngineOptions, OnsetInfo, SpectrumOptions } from './types';

const ONSET_TAU = 0.15;
const HISTORY = 256;

type OnsetKind = 'kick' | 'snare' | 'hat';

function emptyOnset(): OnsetInfo {
  return { hit: false, since: Infinity, envelope: 0, strength: 0 };
}

export class AudioEngine {
  readonly context: AudioContext;
  private readonly source: AudioNode;
  /** A captured stream was heard before it reached us; a media element is heard through our output. */
  private readonly captured: boolean;
  private readonly gainNode: GainNode;
  private readonly pool: AnalyserPool;
  private host: AnalysisHost | null = null;
  private readonly neural = new NeuralClient();
  private options: EngineOptions;
  private disposed = false;

  private state: AnalyzerState | null = null;
  private ctxOffset = 0;
  private latency = 0;
  private queue: AnalyzerEvent[] = [];
  private readonly hist = {
    phase: new Float32Array(HISTORY),
    kick: new Float32Array(HISTORY),
    threshold: new Float32Array(HISTORY),
    beats: new Uint8Array(HISTORY),
  };

  // frame state
  private frameStamp = -1;
  private startedAt = performance.now();
  private cached: AudioFrame | null = null;
  private beatCount = 0;
  private lastBeatAt = -Infinity;
  private beatConfidence = 0;
  private barBeat = 3;
  private readonly onsetState: Record<OnsetKind, { at: number; strength: number; fresh: boolean }> = {
    kick: { at: -Infinity, strength: 0, fresh: false },
    snare: { at: -Infinity, strength: 0, fresh: false },
    hat: { at: -Infinity, strength: 0, fresh: false },
  };
  private currentGain = 1;

  private constructor(ctx: AudioContext, source: AudioNode, captured: boolean, options: EngineOptions) {
    this.context = ctx;
    this.source = source;
    this.captured = captured;
    this.options = options;
    this.gainNode = ctx.createGain();
    source.connect(this.gainNode);
    this.pool = new AnalyserPool(ctx, this.gainNode);
  }

  /** Create an engine for a source. Call from a user gesture where possible (autoplay policy). */
  static async create(input: AudioInput, options: EngineOptions): Promise<AudioEngine> {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    const source = input.kind === 'stream' ? ctx.createMediaStreamSource(input.stream) : ctx.createMediaElementSource(input.element);
    // a media element routed into the graph is only audible through the destination
    if (input.kind === 'element') source.connect(ctx.destination);
    const engine = new AudioEngine(ctx, source, input.kind === 'stream', options);
    await engine.startHost();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      // Stricter autoplay policies only allow resuming inside a user gesture.
      const resume = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
    }
    return engine;
  }

  private async startHost(): Promise<void> {
    const onMessage = (m: HostToEngine) => this.onHostMessage(m);
    let host: AnalysisHost;
    if (this.context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        host = await createWorkletHost(this.context, workletUrl, this.options.neural, this.style, onMessage);
      } catch (err) {
        console.warn('VoltViz: AudioWorklet unavailable, using ScriptProcessor fallback', err);
        host = createScriptProcessorHost(this.context, this.options.neural, this.style, onMessage);
      }
    } else {
      host = createScriptProcessorHost(this.context, this.options.neural, this.style, onMessage);
    }
    if (this.disposed) {
      host.dispose();
      return;
    }
    this.host = host;
    this.source.connect(host.input);
    if (this.options.neural) this.neural.start();
  }

  private get style() {
    return this.options.style ?? DEFAULT_STYLE;
  }

  /** The source says a new song started (e.g. Sendspin track metadata): restart the beat search. */
  notifySongChange(): void {
    this.host?.send({ type: 'songChange' });
  }

  /** Latest analysis state without advancing the frame clock (for UI status displays). */
  get analysis(): AnalyzerState | null {
    return this.state;
  }

  setOptions(options: Partial<EngineOptions>): void {
    const style = this.style;
    this.options = { ...this.options, ...options };
    if (this.style !== style) this.host?.send({ type: 'style', style: this.style });
    if (options.neural !== undefined) {
      this.host?.send({ type: 'neuralActive', active: options.neural });
      if (options.neural) this.neural.start();
      else this.neural.stop();
    }
  }

  private onHostMessage(m: HostToEngine): void {
    if (this.disposed) return;
    if (m.type === 'analysis') {
      this.state = m.state;
      this.ctxOffset = m.ctxOffset;
      this.latency = Math.max(0, this.context.currentTime - (m.state.time + m.ctxOffset));
      for (const e of m.events) this.queue.push(e);
      this.pushHistory(m.phase, m.kick, m.threshold, m.events);
    } else if (m.type === 'neuralRequest') {
      if (!this.options.neural) return;
      this.neural.run(m.frames).then(out => {
        if (out && this.host && !this.disposed) {
          this.host.send({ type: 'neuralResult', t0: m.t0, validFrom: m.validFrom, activation: out.beat, downbeat: out.downbeat });
        }
      });
    } else if (m.type === 'error') {
      console.error('VoltViz audio engine:', m.message);
    }
  }

  private pushHistory(phase: Float32Array, kick: Float32Array, threshold: Float32Array, events: AnalyzerEvent[]): void {
    const n = phase.length;
    if (!n) return;
    const h = this.hist;
    const shift = (a: Float32Array | Uint8Array) => a.copyWithin(0, n);
    shift(h.phase); shift(h.kick); shift(h.threshold); shift(h.beats);
    h.phase.set(phase, HISTORY - n);
    h.kick.set(kick, HISTORY - n);
    h.threshold.set(threshold, HISTORY - n);
    h.beats.fill(0, HISTORY - n);
    if (events.some(e => e.type === 'hit')) h.beats[HISTORY - 1] = 1;
  }

  /**
   * AudioContext time of the audio being heard right now. A captured stream (microphone,
   * system audio) was heard before it entered the context: its "now" is the context's current
   * time. A media element is heard through the context's output, one output latency later.
   */
  private audibleContextTime(now: number): number {
    const ctx = this.context;
    if (this.captured) return ctx.currentTime;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
        return ts.contextTime + (now - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  /**
   * The frame for animation timestamp `now` (performance.now() / rAF time). Computed once per
   * timestamp and shared by every caller in that frame.
   */
  frame(now: number = performance.now()): AudioFrame {
    if (this.cached && now === this.frameStamp) return this.cached;
    const dt = this.frameStamp < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (now - this.frameStamp) / 1000));
    this.frameStamp = now;
    this.pool.nextFrame();
    const ctxNow = this.audibleContextTime(now);
    const st = this.state;

    // Auto Gain: follow the analysis' suggestion smoothly, or return to unity.
    const targetGain = this.options.autoGain && st ? st.agcGain : 1;
    if (Math.abs(targetGain - this.currentGain) > 1e-3) {
      this.currentGain = targetGain;
      this.gainNode.gain.setTargetAtTime(targetGain, this.context.currentTime, 0.1);
    }

    // --- beats and onsets ------------------------------------------------------------------
    // Everything the analysis heard, in the first frame in which it is audible: onsets, and
    // hits (a kick or snare on the beat grid), which fire the beat. Nothing is predicted.
    const keep: AnalyzerEvent[] = [];
    let isBeat = false;
    let hitBar = -1;
    for (const o of Object.values(this.onsetState)) o.fresh = false;
    for (const e of this.queue) {
      const at = e.time + this.ctxOffset;
      if (at > ctxNow) {
        keep.push(e);
        continue;
      }
      if (e.type === 'hit') {
        isBeat = true;
        hitBar = e.bar;
        this.lastBeatAt = at;
        this.beatConfidence = e.confidence;
      } else if (e.type !== 'beat') {
        const o = this.onsetState[e.type];
        o.at = at;
        o.strength = e.strength;
        o.fresh = true;
      }
    }
    // drop stale events (e.g. after a tab was hidden)
    this.queue = keep.filter(e => e.time + this.ctxOffset < ctxNow + 2);

    // The pulse is what beat effects follow: every tracked beat, or every other one on a
    // half-time pulse. period/bpm describe the pulse; tempo is the tracked tempo; phase runs
    // from the last heard beat.
    const divisor = st && st.pulseDivisor > 0 ? st.pulseDivisor : 1;
    const period = st && st.pulsePeriod > 0 ? st.pulsePeriod : 0;
    const sinceBeat = Math.max(0, ctxNow - this.lastBeatAt);
    const phase = period > 0 ? Math.min(1, sinceBeat / period) : 0;
    // Bar position: from the AI downbeats when known (0 = the "1"), else counting beats.
    const barKnown = !!st && st.barPhase >= 0;
    if (isBeat) {
      this.beatCount++;
      this.barBeat = barKnown && hitBar >= 0 ? hitBar : (this.beatCount + 3) % 4;
    }
    const beat: BeatInfo = {
      isBeat,
      count: this.beatCount,
      barBeat: this.barBeat,
      barKnown,
      downbeat: isBeat && barKnown && this.barBeat === 0,
      bpm: st ? st.bpm / divisor : 0,
      tempo: st?.bpm ?? 0,
      divisor,
      confidence: isBeat ? this.beatConfidence : st && !st.silent ? st.confidence : 0,
      strength: st && !st.silent ? st.beatStrength : 0,
      phase,
      sinceBeat,
      period,
    };

    const onset = (k: OnsetKind): OnsetInfo => {
      const o = this.onsetState[k];
      const since = Math.max(0, ctxNow - o.at);
      return { hit: o.fresh, since, envelope: Number.isFinite(o.at) ? Math.exp(-since / ONSET_TAU) : 0, strength: o.strength };
    };

    const pool = this.pool;
    const sampleRate = this.context.sampleRate;
    let bandsCache: Bands | null = null;
    let levelCache: { rms: number; peak: number } | null = null;
    const engine = this;
    const frame: AudioFrame = {
      time: (now - this.startedAt) / 1000,
      dt,
      sampleRate,
      spectrum: (o?: SpectrumOptions) => pool.spectrum(o?.fftSize, o?.smoothing),
      waveform: (o?: SpectrumOptions) => pool.waveform(o?.fftSize, o?.smoothing),
      waveformFloat: (o?: SpectrumOptions) => pool.waveformFloat(o?.fftSize, o?.smoothing),
      stereo: () => pool.stereo(),
      get bands() {
        if (!bandsCache) bandsCache = computeBands(pool.spectrum(2048, 0.8), sampleRate);
        return bandsCache;
      },
      get level() {
        if (!levelCache) {
          const w = pool.waveformFloat(2048, 0.8);
          let s = 0, p = 0;
          for (let i = 0; i < w.length; i++) {
            s += w[i] * w[i];
            const a = Math.abs(w[i]);
            if (a > p) p = a;
          }
          levelCache = { rms: Math.sqrt(s / w.length), peak: p };
        }
        return levelCache;
      },
      beat,
      onsets: { kick: onset('kick'), snare: onset('snare'), hat: onset('hat') },
      silent: st ? st.silent : true,
      style: this.style,
      gain: this.currentGain,
      autoGain: this.options.autoGain,
      analysis: st ?? EMPTY_STATE,
      engine: {
        host: engine.host?.kind ?? 'worklet',
        neural: engine.options.neural ? engine.neural.status : 'off',
        neuralMs: engine.neural.lastMs,
        latency: engine.latency,
        history: engine.hist,
      },
    };
    this.cached = frame;
    return frame;
  }

  /** Stop everything and release the audio graph. The source MediaStream is not stopped. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.neural.stop();
    this.host?.dispose();
    this.pool.dispose();
    try { this.source.disconnect(); } catch { /* already disconnected */ }
    this.gainNode.disconnect();
    if (this.context.state !== 'closed') this.context.close().catch(() => {});
  }
}

const BAND_RANGES: [keyof Bands, number, number][] = [
  ['sub', 20, 60],
  ['bass', 60, 250],
  ['lowMid', 250, 500],
  ['mid', 500, 2000],
  ['highMid', 2000, 6000],
  ['treble', 6000, 16000],
];

function computeBands(spec: Uint8Array, sampleRate: number): Bands {
  const binHz = sampleRate / (spec.length * 2);
  const out = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };
  for (const [name, lo, hi] of BAND_RANGES) {
    const a = Math.max(0, Math.floor(lo / binHz));
    const b = Math.min(spec.length, Math.max(a + 1, Math.floor(hi / binHz)));
    let s = 0;
    for (let i = a; i < b; i++) s += spec[i];
    out[name] = s / (b - a) / 255;
  }
  return out;
}

const EMPTY_STATE: AnalyzerState = {
  time: 0, rms: 0, peak: 0, loudnessDb: -100, silent: true, agcGain: 1, bpm: 0, tempoCandidateBpm: 0, tempoSalience: 0,
  locked: false, beatStrength: 0, beatRise: 0, confidence: 0, period: 0, nextBeatTime: 0, nextBeatIndex: 0,
  style: DEFAULT_STYLE, barPhase: -1, songChanges: 0, novelty: 0, songChangeAt: -1, pulseDivisor: 1, pulsePeriod: 0, nextPulseTime: 0, nextPulseIndex: 0, pulseSupport: { on: 0, off: 0, strength: [0, 0], kick: [0, 0] },
  odfBroad: 0, odfKick: 0, odfSnare: 0, odfHat: 0, kickThreshold: 0,
  neural: { enabled: false, runs: 0, lastDecision: 'off', consistency: 0, lockActive: false },
};
