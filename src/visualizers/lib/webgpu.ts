/**
 * Shared helpers for the raw WebGPU visualizers (Blob Tracker, Daybreak, Oscilloscope, Pulsar): flag
 * constants, shader compilation with readable errors, and the Canvas 2D notice shown when WebGPU is
 * missing or lost.
 */
import type { VisualizerInstance } from '../runtime/types';
import { mountCanvas2D } from './canvas2d';

// WebGPU flag values (the constants are not in TypeScript's DOM lib).
export const BUF = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const;
export const TEX = { COPY_DST: 0x2, TEXTURE_BINDING: 0x4, RENDER_ATTACHMENT: 0x10 } as const;
export const MAP_READ = 0x1;

/** Compile a WGSL module; throws with line:column messages when it does not compile. */
export async function compileShader(device: GPUDevice, code: string, label: string): Promise<GPUShaderModule> {
  const m = device.createShaderModule({ code, label });
  const info = await m.getCompilationInfo();
  const errs = info.messages.filter(x => x.type === 'error');
  if (errs.length) throw new Error(`${label}: ${errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);
  return m;
}

/**
 * Why `navigator.gpu` is missing. Browsers only expose WebGPU on secure pages (HTTPS or localhost),
 * so a self-hosted VoltViz or Home Assistant opened over plain http has none, even in Chrome.
 */
export function noWebGPUReason(): string {
  return window.isSecureContext
    ? 'This browser has no WebGPU (try Chrome, Edge or Safari 26+).'
    : 'WebGPU needs a secure page: https:// or localhost.\n'
      + 'Open Home Assistant through its SSL or Nabu Casa URL, or use voltviz.com.';
}

/** Splits text into lines that fit maxWidth (at word boundaries; '\n' starts a new line). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** A static notice for browsers without WebGPU (or after the device is lost). */
export function webgpuFallback(container: HTMLDivElement, reason: string): VisualizerInstance {
  const c = mountCanvas2D(container, { hiDpi: true });
  const draw = () => {
    const { ctx, cssWidth: w, cssHeight: h } = c;
    ctx.fillStyle = '#050807';
    ctx.fillRect(0, 0, w, h);
    const fs = Math.max(12, Math.min(18, h / 40));
    ctx.font = `500 ${fs}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, reason, Math.max(120, w - 100));
    const lh = fs * 1.5;
    const top = h / 2 - (fs * 1.9 + lines.length * lh) / 2; // the title, a gap, the reason
    ctx.fillStyle = '#d8f5e4';
    ctx.fillText('WEBGPU NOT AVAILABLE', w / 2, top + fs);
    ctx.fillStyle = 'rgba(216,245,228,0.55)';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, top + fs * 1.9 + (i + 1) * lh - fs * 0.25));
    const tw = Math.max(260, ...lines.map(l => ctx.measureText(l).width));
    const bw = Math.min(w - 40, tw + 60), bh = fs * 1.9 + lines.length * lh + fs * 1.8;
    ctx.strokeStyle = 'rgba(216,245,228,0.8)';
    ctx.strokeRect(Math.round(w / 2 - bw / 2) + 0.5, Math.round(top - fs * 0.9) + 0.5, Math.round(bw), Math.round(bh));
  };
  return {
    resize(w, h, dpr) { c.resize(w, h, dpr); draw(); },
    frame() { /* static notice */ },
    dispose() { c.canvas.remove(); },
  };
}
