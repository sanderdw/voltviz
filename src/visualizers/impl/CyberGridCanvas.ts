import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

interface Element {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  hue: number;
  sat: number;
  lit: number;
  alpha: number;
  decay: number;
}

const CyberGridCanvas: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container, { alpha: false });
  const canvas = c.canvas;
  const ctx = c.ctx;

  const elements: Element[] = [];

  const spawnElement = (type: string, hue: number, x: number, y: number, intensity: number, size: number) => {
    let w = size, h = size;
    let lit = 50;
    let alpha = intensity;
    let decay = 0.02 + Math.random() * 0.05;
    let vx = 0, vy = 0;

    if (type === 'cross') {
      spawnElement('lineH', hue, x - size * 2, y, intensity, size);
      spawnElement('lineV', hue, x, y - size * 2, intensity, size);
      return;
    }

    if (type === 'lineH') {
      w = size * (4 + Math.floor(Math.random() * 20));
      h = Math.max(1, size / 2);
      lit = 60 + Math.random() * 40;
      if (Math.random() > 0.7) vx = (Math.random() > 0.5 ? 1 : -1) * size * 0.5;
    } else if (type === 'lineV') {
      h = size * (4 + Math.floor(Math.random() * 20));
      w = Math.max(1, size / 2);
      lit = 60 + Math.random() * 40;
      if (Math.random() > 0.7) vy = (Math.random() > 0.5 ? 1 : -1) * size * 0.5;
    } else if (type === 'block') {
      w = size * (2 + Math.floor(Math.random() * 4));
      h = size * (2 + Math.floor(Math.random() * 4));
      alpha = intensity * 0.6;
      decay = 0.01 + Math.random() * 0.02;
    } else {
      w = size; h = size;
      lit = 70 + Math.random() * 30;
      if (Math.random() > 0.9) lit = 100; // Pure white sparks
    }

    elements.push({
      x: Math.floor(x / size) * size,
      y: Math.floor(y / size) * size,
      w, h, vx, vy,
      hue, sat: 80 + Math.random() * 20, lit,
      alpha, decay
    });

    // Add ambient glow for blocks
    if (type === 'block' && Math.random() > 0.5) {
      elements.push({
        x: Math.floor(x / size) * size - size * 4,
        y: Math.floor(y / size) * size - size * 4,
        w: w + size * 8,
        h: h + size * 8,
        vx: 0, vy: 0,
        hue, sat: 100, lit: 50,
        alpha: intensity * 0.15,
        decay: decay * 0.5
      });
    }
  };

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    frame({ audio, settings }) {
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settings;

      const dataArray = audio.spectrum({ fftSize: 512, smoothing: 0.8 });
      const bufferLength = dataArray.length;

      // Fade background (creates trails)
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(2, 4, 8, 0.25)';
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';

      const size = Math.max(2, Math.floor(3 * currentSettings.scale));

      // Spawn elements based on audio
      for (let i = 0; i < bufferLength; i += 2) {
        const val = dataArray[i] / 255;
        if (val > 0.3) {
          const isBass = i < 15;
          const isMid = i >= 15 && i < 100;

          let hue = 185; // Cyan
          let targetX = Math.random() * w;
          let targetY = Math.random() * h;

          if (isBass) {
            hue = 355; // Red
            // Bias towards bottom right
            targetX = w * 0.3 + Math.random() * w * 0.7;
            targetY = h * 0.3 + Math.random() * h * 0.7;
          } else if (isMid) {
            hue = 185; // Cyan
            // Bias towards top left
            targetX = Math.random() * w * 0.7;
            targetY = Math.random() * h * 0.7;
          } else {
            // Treble - match dominant region
            targetX = Math.random() * w;
            targetY = Math.random() * h;
            hue = (targetX + targetY > w) ? 355 : 185;
          }

          hue = (hue + currentSettings.hueShift) % 360;

          const count = Math.floor(val * 2 * currentSettings.sensitivity);
          for (let j = 0; j < count; j++) {
            const r = Math.random();
            let type = 'dot';
            if (r > 0.95) type = 'block';
            else if (r > 0.90) type = 'cross';
            else if (r > 0.75) type = 'lineH';
            else if (r > 0.60) type = 'lineV';

            spawnElement(
              type,
              hue,
              targetX + (Math.random() - 0.5) * 150,
              targetY + (Math.random() - 0.5) * 150,
              val,
              size
            );
          }
        }
      }

      // Cap elements array to prevent lag
      if (elements.length > 4000) {
        elements.splice(0, elements.length - 4000);
      }

      // Update and draw elements
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        el.alpha -= el.decay * currentSettings.speed;

        if (el.alpha <= 0) {
          elements.splice(i, 1);
          continue;
        }

        el.x += el.vx * currentSettings.speed;
        el.y += el.vy * currentSettings.speed;

        ctx.fillStyle = `hsla(${el.hue}, ${el.sat}%, ${el.lit}%, ${el.alpha})`;
        ctx.fillRect(el.x, el.y, el.w, el.h);
      }

      // Optional: Scanlines for extra cyber feel
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }
    },
    dispose() {
      elements.length = 0;
      canvas.remove();
    },
  };
};

export default CyberGridCanvas;
