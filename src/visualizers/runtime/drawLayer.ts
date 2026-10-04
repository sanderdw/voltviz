/**
 * Copies what a visualizer layer drew into a 2D context: every canvas in the layer's container,
 * placed where it sits inside the container, scaled into the target box. Call it in the same task
 * as the render, so WebGL canvases (without preserveDrawingBuffer) can still be read. DOM/CSS
 * content of the layer (images, text) is not copied.
 */
export function drawLayerCanvases(ctx: CanvasRenderingContext2D, container: HTMLElement,
  x: number, y: number, w: number, h: number): void {
  const box = container.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  for (const c of container.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    try {
      ctx.drawImage(c, x + ((r.left - box.left) / box.width) * w, y + ((r.top - box.top) / box.height) * h,
        (r.width / box.width) * w, (r.height / box.height) * h);
    } catch { /* tainted or zero-sized canvas */ }
  }
}

/** The largest box with the source's aspect ratio that fits (centered) in the target. */
export function containFit(srcW: number, srcH: number, dstW: number, dstH: number): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}
