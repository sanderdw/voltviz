/**
 * __NAME__ — a Canvas 2D visualizer. Created with `npm run new:viz`; see
 * .github/skills/adding-visualizer/SKILL.md for the contract and the quality steps.
 */
import { mountCanvas2D } from '../../src/visualizers/lib/canvas2d';
import { beatHit, beatStrength } from '../../src/visualizers/lib/audio'; // BEAT
import type { VisualizerFactory } from '../../src/visualizers/runtime/types';

const TemplateCanvas2D: VisualizerFactory = ({ container }) => {
  // One canvas filling the container. Pass { hiDpi: true } for crisp lines on HiDPI screens.
  const c = mountCanvas2D(container);
  const ctx = c.ctx;

  // State lives in the closure. Audio changes *rates* (phase accumulator), never time × audio.
  let phase = 0;
  let level = 0;
  // BEAT:BEGIN
  let flash = 0; // 1 on a beat, decays with a 150 ms time constant
  // BEAT:END

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),

    frame({ audio, settings, dt }) {
      const w = c.width;
      const h = c.height;

      // Shared, pooled analysers: ask for the size/smoothing you want (length = fftSize / 2).
      const spectrum = audio.spectrum({ fftSize: 1024, smoothing: 0.8 });
      // Named bands (0..1) are the easiest way to react to bass / mids / highs.
      const bass = Math.min(1, audio.bands.bass * settings.sensitivity);
      level += (bass - level) * Math.min(1, dt * 10); // frame-rate independent smoothing
      phase += dt * settings.speed * (0.3 + level); // rotation speed follows the music
      // BEAT:BEGIN
      if (beatHit(audio)) flash = beatStrength(audio); // heard beat (or a weaker accent when no tempo)
      flash *= Math.exp(-dt / 0.15);
      // BEAT:END

      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(0, 0, w, h);
      // BEAT:BEGIN
      if (flash > 0.01) {
        ctx.fillStyle = `hsla(${settings.hueShift % 360}, 80%, 50%, ${0.25 * flash})`;
        ctx.fillRect(0, 0, w, h);
      }
      // BEAT:END

      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.18 * settings.scale;
      const count = 96;
      for (let i = 0; i < count; i++) {
        const v = (spectrum[Math.floor((i / count) * spectrum.length * 0.6)] / 255) * settings.sensitivity;
        const a = (i / count) * Math.PI * 2 + phase;
        const r1 = base * (1 + 0.3 * level);
        const r2 = r1 + v * base * 1.5;
        const hue = (settings.hueShift + (i / count) * 300) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, ${45 + v * 30}%, 0.9)`;
        ctx.lineWidth = Math.max(1, (2 * Math.PI * r1) / count - 1);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
    },

    dispose() {
      c.canvas.remove();
    },
  };
};

export default TemplateCanvas2D;
