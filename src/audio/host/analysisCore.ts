/**
 * Host-independent glue around the Analyzer: downmixes input channels, runs the analysis and
 * batches messages. Shared by the AudioWorklet and the ScriptProcessor fallback.
 */
import { Analyzer, type AnalyzerEvent } from '../core/Analyzer';
import { HOPS_PER_MESSAGE, type EngineToHost, type HostToEngine } from './protocol';

export class AnalysisCore {
  readonly analyzer: Analyzer;
  private readonly post: (m: HostToEngine, transfer?: Transferable[]) => void;
  private mono = new Float32Array(128);
  private events: AnalyzerEvent[] = [];
  private phase: number[] = [];
  private kick: number[] = [];
  private threshold: number[] = [];
  private lastTime = 0;
  private hopsSincePost = 0;
  private ctxOffset = NaN;

  constructor(sampleRate: number, post: (m: HostToEngine, transfer?: Transferable[]) => void, neural: boolean) {
    this.analyzer = new Analyzer(sampleRate, { neural: true });
    this.analyzer.setNeuralActive(neural);
    this.post = post;
  }

  onMessage(m: EngineToHost): void {
    if (m.type === 'neuralResult') this.analyzer.applyNeural(m.t0, m.activation, m.validFrom);
    else if (m.type === 'neuralActive') this.analyzer.setNeuralActive(m.active);
  }

  /** Process one block. `channels` are the input channel arrays; `contextTime` the block start. */
  process(channels: Float32Array[], length: number, contextTime: number): void {
    if (!channels.length || length === 0) return;
    if (this.mono.length < length) this.mono = new Float32Array(length);
    const m = this.mono;
    if (channels.length === 1) m.set(channels[0].subarray(0, length));
    else {
      // mean of all channels (the beat model was trained on the channel mean)
      const inv = 1 / channels.length;
      for (let i = 0; i < length; i++) {
        let s = 0;
        for (const ch of channels) s += ch[i];
        m[i] = s * inv;
      }
    }
    const a = this.analyzer;
    if (Number.isNaN(this.ctxOffset)) this.ctxOffset = contextTime - a.state.time;
    const before = a.state.time;
    a.process(m, length);
    for (const e of a.drainEvents()) this.events.push(e);
    if (a.state.time !== before) {
      // one or more hops completed in this block; record the newest values
      this.phase.push(a.state.odfSnare);
      this.kick.push(a.state.odfKick);
      this.threshold.push(a.state.kickThreshold);
      this.hopsSincePost++;
    }
    const req = a.takeNeuralRequest();
    if (req) this.post({ type: 'neuralRequest', t0: req.t0, validFrom: req.validFrom, frames: req.frames }, [req.frames.buffer]);
    if (this.hopsSincePost >= HOPS_PER_MESSAGE || this.events.length > 0) this.flush();
    this.lastTime = a.state.time;
  }

  private flush(): void {
    const phase = Float32Array.from(this.phase);
    const kick = Float32Array.from(this.kick);
    const threshold = Float32Array.from(this.threshold);
    this.post(
      { type: 'analysis', ctxOffset: this.ctxOffset, state: this.analyzer.state, events: this.events, phase, kick, threshold },
      [phase.buffer, kick.buffer, threshold.buffer],
    );
    this.events = [];
    this.phase.length = 0;
    this.kick.length = 0;
    this.threshold.length = 0;
    this.hopsSincePost = 0;
  }
}
