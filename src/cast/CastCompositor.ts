/**
 * Copies the visualizer stage into one fixed-size 16:9 canvas every frame (letterboxed, with the
 * crossfade opacity of each layer) and exposes it as a video MediaStream for casting. Only canvas
 * content is copied; DOM/CSS parts of a visualizer (images, text, React overlays) are not.
 */
import type { AfterFrame } from '../visualizers/runtime/VisualizerHost';
import { containFit, drawLayerCanvases } from '../visualizers/runtime/drawLayer';

export const CAST_WIDTH = 1280;
export const CAST_HEIGHT = 720;
const FPS = 60;

export class CastCompositor {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CAST_WIDTH;
    this.canvas.height = CAST_HEIGHT;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.clear();
    this.stream = this.canvas.captureStream(FPS);
    this.track = this.stream.getVideoTracks()[0];
    this.track.contentHint = 'motion';
  }

  /** Host after-frame observer: same task as the render, so WebGL canvases are still readable. */
  readonly onFrame: AfterFrame = layers => {
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CAST_WIDTH, CAST_HEIGHT);
    for (const { container } of layers) {
      // The stage fades layers through the opacity of the wrapping viz-layer element
      const wrapper = container.closest<HTMLElement>('[data-testid="viz-layer"]');
      const alpha = wrapper ? parseFloat(getComputedStyle(wrapper).opacity) : 1;
      if (!(alpha > 0.01)) continue;
      const box = containFit(container.clientWidth, container.clientHeight, CAST_WIDTH, CAST_HEIGHT);
      ctx.globalAlpha = Math.min(1, alpha);
      drawLayerCanvases(ctx, container, box.x, box.y, box.w, box.h);
    }
    ctx.globalAlpha = 1;
  };

  /** Black frame (no source running). */
  clear(): void {
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, CAST_WIDTH, CAST_HEIGHT);
  }

  dispose(): void {
    this.track.stop();
  }
}
