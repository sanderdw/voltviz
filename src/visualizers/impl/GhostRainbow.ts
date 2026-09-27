import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

const GhostRainbow: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container);
  const canvas = c.canvas;
  const ctx = c.ctx;

  const particles: {x: number, y: number, size: number, speedX: number, speedY: number, opacity: number}[] = [];

  for (let i = 0; i < 100; i++) {
    particles.push({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 2,
      speedY: (Math.random() - 0.5) * 2,
      opacity: Math.random()
    });
  }

  const drawGhost = (ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, bass: number) => {
    ctx.save();
    ctx.translate(cx, cy);

    // Slight bounce based on bass
    const bounce = (bass / 255) * 10;
    ctx.translate(0, -bounce);

    ctx.scale(scale * 1.5, scale * 1.5);

    // Slight rotation
    ctx.rotate(0.05);

    // Ghost body
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-20, 25);
    ctx.bezierCurveTo(-30, 10, -25, -20, -10, -30); // left side
    ctx.bezierCurveTo(5, -40, 25, -25, 25, -10); // top and right
    ctx.bezierCurveTo(25, 10, 20, 25, 15, 30); // right side down

    // Wavy bottom
    ctx.quadraticCurveTo(10, 25, 5, 30);
    ctx.quadraticCurveTo(0, 25, -5, 30);
    ctx.quadraticCurveTo(-10, 25, -15, 30);
    ctx.quadraticCurveTo(-20, 25, -20, 25);

    ctx.fill();
    ctx.stroke();

    // Eyes
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(-2, -10, 3, 6, 0, 0, Math.PI * 2); // left eye
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(12, -8, 4, 7, 0, 0, Math.PI * 2); // right eye
    ctx.fill();

    // Mouth
    ctx.beginPath();
    ctx.ellipse(5, 2, 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Left Arm
    ctx.beginPath();
    ctx.moveTo(-22, -5);
    ctx.quadraticCurveTo(-35, -5, -30, 5);
    ctx.quadraticCurveTo(-25, 5, -23, 2);
    ctx.fill();
    ctx.stroke();

    // Right Arm
    ctx.beginPath();
    ctx.moveTo(24, -2);
    ctx.quadraticCurveTo(35, 0, 32, 10);
    ctx.quadraticCurveTo(28, 10, 25, 5);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  };

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    frame({ audio, settings }) {
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settings;

      const dataArray = audio.spectrum({ fftSize: 512, smoothing: 0.8 });

      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;

      // Background
      const bgGrad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w, h));
      bgGrad.addColorStop(0, '#e2e8f0'); // bright center
      bgGrad.addColorStop(0.3, '#64748b'); // mid grey-blue
      bgGrad.addColorStop(0.7, '#1e293b'); // dark slate
      bgGrad.addColorStop(1, '#0f172a'); // very dark
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Particles
      ctx.fillStyle = '#ffffff';
      particles.forEach(p => {
        p.x += p.speedX * 0.001 * currentSettings.speed;
        p.y += p.speedY * 0.001 * currentSettings.speed;
        if (p.x < 0) p.x = 1;
        if (p.x > 1) p.x = 0;
        if (p.y < 0) p.y = 1;
        if (p.y > 1) p.y = 0;

        ctx.globalAlpha = p.opacity;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.18 * currentSettings.scale;

      // Waveform
      const colors = [
        '#ff0000', // Red
        '#ff7f00', // Orange
        '#ffff00', // Yellow
        '#00ff00', // Green
        '#0000ff', // Blue
        '#4b0082', // Indigo/Purple
      ];

      const thickness = 8 * currentSettings.scale;
      const numPoints = 64;
      const amplitudes: number[] = [];

      for (let i = 0; i < numPoints; i++) {
        const bin = Math.floor((i / numPoints) * 60);
        const val = dataArray[bin] / 255.0;
        const edgeSmoothing = Math.sin((i / (numPoints - 1)) * Math.PI);
        amplitudes.push(val * 150 * currentSettings.sensitivity * edgeSmoothing);
      }

      // Draw layers from outside in
      for (let layer = 0; layer < colors.length; layer++) {
        const baseHues = [0, 30, 60, 120, 240, 280]; // R, O, Y, G, B, P
        const hue = (baseHues[layer] + currentSettings.hueShift) % 360;
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;

        ctx.beginPath();

        const layerOffset = (colors.length - 1 - layer) * thickness;

        // Right side (0 to PI) -> -PI/2 to PI/2
        for (let i = 0; i < numPoints; i++) {
            const angle = -Math.PI / 2 + (i / (numPoints - 1)) * Math.PI;
            const r = baseRadius + amplitudes[i] + layerOffset;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        // Left side (PI to 2PI) -> PI/2 to 3PI/2
        for (let i = numPoints - 1; i >= 0; i--) {
            const angle = Math.PI / 2 + ((numPoints - 1 - i) / (numPoints - 1)) * Math.PI;
            const r = baseRadius + amplitudes[i] + layerOffset;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            ctx.lineTo(x, y);
        }

        ctx.closePath();
        ctx.fill();
      }

      // Central Black Circle
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // White border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4 * currentSettings.scale;
      ctx.stroke();

      // Ghost
      drawGhost(ctx, cx, cy, currentSettings.scale, bass);
    },
    dispose() {
      particles.length = 0;
      canvas.remove();
    },
  };
};

export default GhostRainbow;
