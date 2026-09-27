import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

const Bars: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container);
  const ctx = c.ctx;

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    frame({ audio, settings }) {
      const w = c.width;
      const h = c.height;
      const dataArray = audio.spectrum({ fftSize: 512, smoothing: 0.85 });
      const bufferLength = dataArray.length;

      // Fade out for smooth trails
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, w, h);

      const barWidth = (w / bufferLength) * 2.5 * settings.scale;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        const percent = Math.min(1, (value / 255) * settings.sensitivity);
        const barHeight = percent * h * 0.8 * settings.scale;

        const hue = ((i / bufferLength) * 360 + (Date.now() * 0.05 * settings.speed) + settings.hueShift) % 360;

        // Create gradient for each bar
        const gradient = ctx.createLinearGradient(0, h, 0, h - barHeight);
        gradient.addColorStop(0, `hsla(${hue}, 100%, 20%, 1)`);
        gradient.addColorStop(1, `hsla(${hue}, 100%, 60%, 1)`);

        ctx.fillStyle = gradient;

        // Draw bar with rounded top
        ctx.beginPath();
        ctx.roundRect(x, h - barHeight, barWidth, barHeight, [barWidth / 2, barWidth / 2, 0, 0]);
        ctx.fill();

        // Add a bright cap
        if (barHeight > 5 * settings.scale) {
          ctx.fillStyle = `hsla(${hue}, 100%, 80%, 1)`;
          ctx.beginPath();
          ctx.roundRect(x, h - barHeight, barWidth, 4 * settings.scale, [2 * settings.scale, 2 * settings.scale, 2 * settings.scale, 2 * settings.scale]);
          ctx.fill();
        }

        x += barWidth + 2 * settings.scale;
      }
    },
    dispose() {
      c.canvas.remove();
    },
  };
};

export default Bars;
