/**
 * Runs visualizers: one requestAnimationFrame loop for all mounted layers (crossfades share
 * one AudioFrame), container resize handling, DPR capping, per-layer error isolation and
 * frame-rate statistics. Framework-free; the React stage only mounts containers.
 */
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { VisualizerSettings } from '../../types';
import { Probe } from './probe';
import type { VisualizerFactory, VisualizerInstance } from './types';

export interface LayerHandle {
  readonly id: string;
  readonly ready: Promise<VisualizerInstance | null>;
  setSettings(s: VisualizerSettings): void;
  setMetadata(m: ServerStateMetadata | null): void;
  dispose(): void;
}

interface Layer {
  id: string;
  container: HTMLDivElement;
  instance: VisualizerInstance | null;
  settings: VisualizerSettings;
  metadata: ServerStateMetadata | null;
  width: number;
  height: number;
  dpr: number;
  mountedAt: number;
  lastTime: number;
  failed: boolean;
  observer: ResizeObserver;
  frames: number;
  fpsWindowStart: number;
  fps: number;
}

const dprCap = () => Math.min(window.devicePixelRatio || 1, 2);

export class VisualizerHost {
  private engine: AudioEngine;
  private readonly layers = new Set<Layer>();
  private raf = 0;
  readonly probe: Probe | null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.probe = Probe.fromUrl();
  }

  setEngine(engine: AudioEngine): void {
    this.engine = engine;
  }

  mount(id: string, container: HTMLDivElement, factory: VisualizerFactory, settings: VisualizerSettings,
    metadata: ServerStateMetadata | null): LayerHandle {
    const rect = container.getBoundingClientRect();
    const layer: Layer = {
      id, container, instance: null, settings, metadata,
      width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)), dpr: dprCap(),
      mountedAt: performance.now(), lastTime: performance.now(), failed: false,
      observer: new ResizeObserver(() => this.onResize(layer)),
      frames: 0, fpsWindowStart: performance.now(), fps: 0,
    };
    let disposed = false;
    const ready = (async () => {
      try {
        const inst = await factory({ container, width: layer.width, height: layer.height, dpr: layer.dpr, settings, metadata });
        if (disposed) {
          inst.dispose();
          return null;
        }
        layer.instance = inst;
        inst.resize?.(layer.width, layer.height, layer.dpr);
        layer.observer.observe(container);
        this.layers.add(layer);
        this.ensureLoop();
        return inst;
      } catch (err) {
        console.error(`VoltViz: visualizer "${id}" failed to start`, err);
        layer.failed = true;
        return null;
      }
    })();
    return {
      id,
      ready,
      setSettings: s => { layer.settings = s; },
      setMetadata: m => {
        layer.metadata = m;
        try { layer.instance?.metadata?.(m); } catch (err) { console.error(err); }
      },
      dispose: () => {
        disposed = true;
        layer.observer.disconnect();
        this.layers.delete(layer);
        try { layer.instance?.dispose(); } catch (err) { console.error(`VoltViz: disposing "${id}" failed`, err); }
        layer.instance = null;
        container.replaceChildren();
        if (this.layers.size === 0) this.stopLoop();
      },
    };
  }

  private onResize(layer: Layer): void {
    const rect = layer.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = dprCap();
    if (w === layer.width && h === layer.height && dpr === layer.dpr) return;
    layer.width = w;
    layer.height = h;
    layer.dpr = dpr;
    try { layer.instance?.resize?.(w, h, dpr); } catch (err) { console.error(err); }
  }

  private ensureLoop(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const audio = this.engine.frame(now);
    for (const layer of this.layers) {
      const inst = layer.instance;
      if (!inst || layer.failed) continue;
      const dt = Math.min(0.1, Math.max(0, (now - layer.lastTime) / 1000));
      layer.lastTime = now;
      try {
        inst.frame({
          audio, settings: layer.settings, metadata: layer.metadata,
          time: (now - layer.mountedAt) / 1000, dt, width: layer.width, height: layer.height, dpr: layer.dpr,
        });
      } catch (err) {
        // isolate: one broken visualizer must not stop the loop (or the crossfade partner)
        console.error(`VoltViz: visualizer "${layer.id}" crashed`, err);
        layer.failed = true;
      }
      layer.frames++;
      if (now - layer.fpsWindowStart >= 1000) {
        layer.fps = (layer.frames * 1000) / (now - layer.fpsWindowStart);
        layer.frames = 0;
        layer.fpsWindowStart = now;
      }
    }
    // Same task as the render: WebGL drawing buffers are still readable here.
    this.probe?.sample(now, audio, [...this.layers].map(l => ({ id: l.id, container: l.container, fps: l.fps })));
  };

  /** Frame-rate per mounted layer (for diagnostics / tests). */
  stats(): { id: string; fps: number; failed: boolean }[] {
    return [...this.layers].map(l => ({ id: l.id, fps: l.fps, failed: l.failed }));
  }

  dispose(): void {
    this.stopLoop();
  }
}
