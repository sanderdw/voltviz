/**
 * Development-only measurement probe (enabled with `?probe=1` in dev builds). Every frame it
 * records the engine's beat/onset output next to a tiny thumbnail-based measure of what the
 * visible visualizer drew (mean luminance and frame-to-frame motion), so the evaluation
 * harness can quantify whether a visualizer visibly reacts to the beat.
 *
 * It runs in the same task as the render, so even WebGL canvases (without
 * preserveDrawingBuffer) can be read.
 */
import type { AudioFrame } from '../../audio/types';

export interface ProbeSample {
  t: number; // performance.now() ms
  media: number; // currentTime of the test audio element (s), or -1
  layer: string;
  fps: number;
  isBeat: boolean;
  bpm: number;
  conf: number;
  phase: number;
  kick: boolean;
  lum: number; // 0..1
  motion: number; // 0..1
  bass: number; // audio.bands.bass
  level: number; // audio.level.rms
  gain: number; // Auto Gain factor applied to the display path
  spec: number; // mean of the 1024/0.8 byte spectrum (0..1): how much of the spectrum is lit
  kickEnv: number; // kick onset envelope
}

export interface ProbeShot {
  kind: 'beat' | 'offbeat';
  media: number;
  t: number;
  dataUrl: string;
}

function meanSpectrum(s: Uint8Array): number {
  let t = 0;
  for (let i = 0; i < s.length; i++) t += s[i];
  return t / s.length / 255;
}

const W = 32;
const H = 18;

export class Probe {
  readonly samples: ProbeSample[] = [];
  readonly shots: ProbeShot[] = [];
  /** Set by the harness: capture this many exact-frame snapshots per kind after this media time. */
  shotPlan: { after: number; perKind: number } | null = null;
  /** Canvas readback costs GPU time; the harness turns it off to measure clean frame rates. */
  canvasSampling = true;
  private shotCanvas: HTMLCanvasElement | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private prev: Float32Array | null = null;
  private readonly cur = new Float32Array(W * H);

  static fromUrl(): Probe | null {
    if (!import.meta.env.DEV) return null;
    if (new URLSearchParams(window.location.search).get('probe') !== '1') return null;
    const p = new Probe();
    const g = window as unknown as { __voltviz?: Record<string, unknown> };
    g.__voltviz = { ...(g.__voltviz ?? {}), probe: p };
    return p;
  }

  private constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  sample(now: number, audio: AudioFrame, layers: { id: string; container: HTMLDivElement; fps: number }[]): void {
    const top = layers[layers.length - 1];
    if (!top) return;
    if (!this.canvasSampling) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const box = top.container.getBoundingClientRect();
    for (const c of top.container.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      try {
        ctx.drawImage(c, ((r.left - box.left) / box.width) * W, ((r.top - box.top) / box.height) * H,
          (r.width / box.width) * W, (r.height / box.height) * H);
      } catch { /* tainted or zero-sized canvas */ }
    }
    const px = ctx.getImageData(0, 0, W, H).data;
    let lum = 0, motion = 0;
    for (let i = 0; i < W * H; i++) {
      const v = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      this.cur[i] = v;
      lum += v;
      if (this.prev) motion += Math.abs(v - this.prev[i]);
    }
    if (!this.prev) this.prev = new Float32Array(W * H);
    this.prev.set(this.cur);
    const el = (window as unknown as { __voltvizTestAudio?: HTMLMediaElement }).__voltvizTestAudio;
    this.samples.push({
      t: now,
      media: el ? el.currentTime : -1,
      layer: top.id,
      fps: top.fps,
      isBeat: audio.beat.isBeat,
      bpm: audio.beat.bpm,
      conf: audio.beat.confidence,
      phase: audio.beat.phase,
      kick: audio.onsets.kick.hit,
      lum: lum / (W * H),
      motion: motion / (W * H),
      bass: audio.bands.bass,
      level: audio.level.rms,
      gain: audio.gain,
      spec: meanSpectrum(audio.spectrum({ fftSize: 1024, smoothing: 0.8 })),
      kickEnv: audio.onsets.kick.envelope,
    });
    const plan = this.shotPlan;
    const media = el ? el.currentTime : -1;
    if (plan && media >= plan.after) {
      const kind: ProbeShot['kind'] | null = audio.beat.isBeat ? 'beat'
        : audio.beat.phase > 0.45 && audio.beat.phase < 0.55 && audio.beat.confidence >= 0.3 ? 'offbeat' : null;
      if (kind && this.shots.filter(s => s.kind === kind).length < plan.perKind
        && !this.shots.some(s => Math.abs(s.t - now) < 150)) {
        this.shots.push({ kind, media, t: now, dataUrl: this.snapshot(top.container) });
      }
    }
    if (this.samples.length > 30000) this.samples.splice(0, 10000);
  }

  /** Exact-frame JPEG of the layer's canvases (same task as the render). */
  private snapshot(container: HTMLDivElement): string {
    const w = 480, h = 270;
    if (!this.shotCanvas) {
      this.shotCanvas = document.createElement('canvas');
      this.shotCanvas.width = w;
      this.shotCanvas.height = h;
    }
    const ctx = this.shotCanvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const box = container.getBoundingClientRect();
    for (const c of container.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      try {
        ctx.drawImage(c, ((r.left - box.left) / box.width) * w, ((r.top - box.top) / box.height) * h,
          (r.width / box.width) * w, (r.height / box.height) * h);
      } catch { /* ignore */ }
    }
    return this.shotCanvas.toDataURL('image/jpeg', 0.72);
  }

  clear(): void {
    this.samples.length = 0;
    this.shots.length = 0;
    this.prev = null;
  }
}
