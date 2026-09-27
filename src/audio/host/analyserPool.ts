import type { FftSize } from '../types';

interface Entry {
  node: AnalyserNode;
  freq: Uint8Array<ArrayBuffer>;
  time: Uint8Array<ArrayBuffer>;
  timeF: Float32Array<ArrayBuffer>;
  freqFrame: number;
  timeFrame: number;
  timeFFrame: number;
  lastUsed: number;
}

/**
 * Shared display analysers keyed by (fftSize, smoothing), created lazily on first use. Every
 * visualizer keeps reading exactly the data it was tuned on (same FFT size and smoothing),
 * but all layers share one audio graph and each analyser is read at most once per frame.
 */
export class AnalyserPool {
  private readonly ctx: AudioContext;
  private readonly input: AudioNode;
  private readonly entries = new Map<string, Entry>();
  private frame = 0;
  private splitter: ChannelSplitterNode | null = null;
  private stereoNodes: [AnalyserNode, AnalyserNode] | null = null;
  private stereoBufs: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] | null = null;
  private stereoFrame = -1;
  private mono = true;

  constructor(ctx: AudioContext, input: AudioNode) {
    this.ctx = ctx;
    this.input = input;
  }

  /** Advance the frame counter (data is re-read at most once per frame). */
  nextFrame(): void {
    this.frame++;
    // drop analysers nobody used for ~10 s (e.g. after switching visualizers)
    if (this.frame % 600 === 0) {
      for (const [k, e] of this.entries) {
        if (this.frame - e.lastUsed > 600) {
          e.node.disconnect();
          this.entries.delete(k);
        }
      }
    }
  }

  private get(fftSize: FftSize = 2048, smoothing = 0.8): Entry {
    const key = `${fftSize}:${smoothing}`;
    let e = this.entries.get(key);
    if (!e) {
      const node = this.ctx.createAnalyser();
      node.fftSize = fftSize;
      node.smoothingTimeConstant = smoothing;
      this.input.connect(node);
      e = {
        node,
        freq: new Uint8Array(node.frequencyBinCount),
        time: new Uint8Array(fftSize),
        timeF: new Float32Array(fftSize),
        freqFrame: -1, timeFrame: -1, timeFFrame: -1, lastUsed: this.frame,
      };
      this.entries.set(key, e);
    }
    e.lastUsed = this.frame;
    return e;
  }

  spectrum(fftSize?: FftSize, smoothing?: number): Uint8Array {
    const e = this.get(fftSize, smoothing);
    if (e.freqFrame !== this.frame) {
      e.node.getByteFrequencyData(e.freq);
      e.freqFrame = this.frame;
    }
    return e.freq;
  }

  waveform(fftSize?: FftSize, smoothing?: number): Uint8Array {
    const e = this.get(fftSize, smoothing);
    if (e.timeFrame !== this.frame) {
      e.node.getByteTimeDomainData(e.time);
      e.timeFrame = this.frame;
    }
    return e.time;
  }

  waveformFloat(fftSize?: FftSize, smoothing?: number): Float32Array {
    const e = this.get(fftSize, smoothing);
    if (e.timeFFrame !== this.frame) {
      e.node.getFloatTimeDomainData(e.timeF);
      e.timeFFrame = this.frame;
    }
    return e.timeF;
  }

  /** Per-channel float time-domain data (2048 samples, no smoothing), created lazily. */
  stereo(): { left: Float32Array; right: Float32Array } {
    if (!this.stereoNodes) {
      this.splitter = this.ctx.createChannelSplitter(2);
      this.input.connect(this.splitter);
      const l = this.ctx.createAnalyser();
      const r = this.ctx.createAnalyser();
      for (const n of [l, r]) {
        n.fftSize = 2048;
        n.smoothingTimeConstant = 0;
      }
      this.splitter.connect(l, 0);
      this.splitter.connect(r, 1);
      this.stereoNodes = [l, r];
      this.stereoBufs = [new Float32Array(2048), new Float32Array(2048)];
    }
    const [l, r] = this.stereoNodes;
    const [bl, br] = this.stereoBufs!;
    if (this.stereoFrame !== this.frame) {
      l.getFloatTimeDomainData(bl);
      r.getFloatTimeDomainData(br);
      this.stereoFrame = this.frame;
      // mono sources leave the right channel silent: mirror the left channel
      let energy = 0;
      for (let i = 0; i < br.length; i += 16) energy += br[i] * br[i];
      this.mono = energy === 0;
    }
    return { left: bl, right: this.mono ? bl : br };
  }

  dispose(): void {
    for (const e of this.entries.values()) e.node.disconnect();
    this.entries.clear();
    this.splitter?.disconnect();
    this.stereoNodes?.forEach(n => n.disconnect());
  }
}
