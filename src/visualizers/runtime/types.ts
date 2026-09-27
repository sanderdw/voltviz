/**
 * The contract between the visualizer runtime and a visualizer. A visualizer is a plain
 * module (no React, no Web Audio): it receives a container to render into and, every frame,
 * the shared AudioFrame plus the current settings.
 */
import type { ComponentType } from 'react';
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import type { AudioFrame } from '../../audio/types';
import type { VisualizerSettings } from '../../types';

export interface MountContext {
  /** Empty, absolutely-filled container. Append canvases / DOM here. */
  container: HTMLDivElement;
  /** Initial CSS size of the container and the capped device pixel ratio (<= 2). */
  width: number;
  height: number;
  dpr: number;
  settings: VisualizerSettings;
  metadata: ServerStateMetadata | null;
}

export interface FrameContext {
  audio: AudioFrame;
  settings: VisualizerSettings;
  metadata: ServerStateMetadata | null;
  /** Seconds since this visualizer was mounted, and since the previous frame (<= 0.1). */
  time: number;
  dt: number;
  width: number;
  height: number;
  dpr: number;
}

export interface VisualizerInstance {
  frame(f: FrameContext): void;
  /** CSS size of the container changed (also called once right after mount). */
  resize?(width: number, height: number, dpr: number): void;
  /** Sendspin metadata changed (optional; it is also passed every frame). */
  metadata?(m: ServerStateMetadata | null): void;
  dispose(): void;
  /** Methods for the visualizer's optional Overlay (e.g. image upload). */
  api?: Record<string, (...args: never[]) => unknown>;
}

export type VisualizerFactory = (ctx: MountContext) => VisualizerInstance | Promise<VisualizerInstance>;

export interface OverlayProps {
  /** The instance's `api`, once mounted. */
  api: Record<string, (...args: never[]) => unknown> | null;
}

/** Shape of a visualizer module (src/visualizers/impl/<Name>.ts[x]). */
export interface VisualizerModule {
  default: VisualizerFactory;
  /** Optional React overlay rendered above the canvas (upload buttons, labels). */
  Overlay?: ComponentType<OverlayProps>;
}
