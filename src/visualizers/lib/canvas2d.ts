/**
 * Canvas 2D setup for visualizers. By default the backing store matches the container's CSS
 * size (what the original canvas visualizers did); pass `hiDpi: true` to render at the
 * (capped) device pixel ratio with the context pre-scaled to CSS pixels.
 */
export interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Backing-store size in pixels. */
  width: number;
  height: number;
  /** CSS size. */
  cssWidth: number;
  cssHeight: number;
  resize(width: number, height: number, dpr: number): void;
}

export function mountCanvas2D(container: HTMLElement, options: { hiDpi?: boolean; alpha?: boolean } = {}): Canvas2D {
  const canvas = document.createElement('canvas');
  canvas.className = 'w-full h-full block';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: options.alpha ?? true })!;
  const c: Canvas2D = {
    canvas, ctx, width: 0, height: 0, cssWidth: 0, cssHeight: 0,
    resize(width, height, dpr) {
      const scale = options.hiDpi ? dpr : 1;
      c.cssWidth = width;
      c.cssHeight = height;
      c.width = Math.round(width * scale);
      c.height = Math.round(height * scale);
      canvas.width = c.width;
      canvas.height = c.height;
      if (options.hiDpi) ctx.setTransform(scale, 0, 0, scale, 0, 0);
    },
  };
  return c;
}
