import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

interface Particle { x: number, y: number, vx: number, vy: number, life: number, maxLife: number, color: string, size: number }

const Circular: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container);
  const canvas = c.canvas;
  const ctx = c.ctx;

  // Particles for extra juice
  const particles: Particle[] = [];

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    frame({ audio, settings }) {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const currentSettings = settings;

      const dataArray = audio.spectrum({ fftSize: 2048, smoothing: 0.85 });
      const bufferLength = dataArray.length;
      // The original read time-domain data into a frequencyBinCount-long buffer (first half only)
      const timeDataArray = audio.waveform({ fftSize: 2048, smoothing: 0.85 }).subarray(0, bufferLength);

      // Clear canvas with fade effect for trails
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, width, height);

      // Calculate average volume for reactive effects
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avgVolume = sum / bufferLength;
      // Bass: 0-250Hz (bins 0-11 for fftSize 2048)
      let bassSum = 0;
      for (let i = 0; i < 12; i++) bassSum += dataArray[i];
      const bassVolume = bassSum / 12;

      // Draw Circular Frequency Bars
      const baseRadius = Math.min(width, height) * 0.2;
      const radius = (baseRadius + (bassVolume * 0.3 * currentSettings.sensitivity)) * currentSettings.scale;
      const bars = 120;
      const step = Math.PI * 2 / bars;

      ctx.save();
      ctx.translate(centerX, centerY);

      // Rotate slowly
      ctx.rotate(Date.now() * 0.0005 * currentSettings.speed);

      for (let i = 0; i < bars; i++) {
        // Map i to frequency bin (focusing on lower/mid frequencies)
        const dataIndex = Math.floor(i * (bufferLength * 0.5) / bars);
        const value = dataArray[dataIndex];
        const barHeight = (value / 255) * (Math.min(width, height) * 0.3) * currentSettings.sensitivity * currentSettings.scale;

        const angle = i * step;

        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        const xEnd = Math.cos(angle) * (radius + barHeight);
        const yEnd = Math.sin(angle) * (radius + barHeight);

        // Color based on frequency and volume
        const hue = ((i / bars) * 360 + (Date.now() * 0.05 * currentSettings.speed) + currentSettings.hueShift) % 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${0.5 + Math.min(1, (value / 255) * 0.5 * currentSettings.sensitivity)})`;
        ctx.lineWidth = 3 * currentSettings.scale;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(xEnd, yEnd);
        ctx.stroke();

        // Spawn particles on strong beats
        if (value * currentSettings.sensitivity > 200 && Math.random() > 0.8) {
          particles.push({
            x: xEnd + centerX,
            y: yEnd + centerY,
            vx: Math.cos(angle) * (Math.random() * 5 + 2) * currentSettings.scale,
            vy: Math.sin(angle) * (Math.random() * 5 + 2) * currentSettings.scale,
            life: 1,
            maxLife: Math.random() * 50 + 20,
            color: `hsla(${hue}, 100%, 70%, 1)`,
            size: (Math.random() * 3 + 1) * currentSettings.scale
          });
        }
      }
      ctx.restore();

      // Draw Waveform in the center
      ctx.beginPath();
      ctx.lineWidth = 2 * currentSettings.scale;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 + Math.min(1, (avgVolume / 255) * 0.6 * currentSettings.sensitivity)})`;

      const sliceWidth = (radius * 1.5) / bufferLength;
      let xWave = centerX - (radius * 0.75);

      for (let i = 0; i < bufferLength; i++) {
        const v = timeDataArray[i] / 128.0;
        const yWave = centerY + (v * radius * 0.5 * currentSettings.sensitivity) - (radius * 0.5 * currentSettings.sensitivity);

        if (i === 0) {
          ctx.moveTo(xWave, yWave);
        } else {
          ctx.lineTo(xWave, yWave);
        }

        xWave += sliceWidth;
      }
      ctx.stroke();

      // Update and draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * currentSettings.speed;
        p.y += p.vy * currentSettings.speed;
        p.life += currentSettings.speed;

        // Add some drag
        p.vx *= 0.98;
        p.vy *= 0.98;

        const alpha = Math.max(0, 1 - (p.life / p.maxLife));

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color.replace('1)', `${alpha})`);
        ctx.fill();

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
        }
      }
    },
    dispose() {
      particles.length = 0;
      canvas.remove();
    },
  };
};

export default Circular;
