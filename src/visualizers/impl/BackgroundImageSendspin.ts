import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import dummyCover from '../../../images/dummycover.png';
import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

const BackgroundImageSendspin: VisualizerFactory = ({ container, metadata: initialMetadata }) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full h-full relative overflow-hidden bg-[#0a1118]';
  container.appendChild(wrapper);

  const bgDiv = document.createElement('div');
  bgDiv.className = 'absolute inset-0 bg-cover bg-center bg-no-repeat opacity-80';
  wrapper.appendChild(bgDiv);

  // Dark gradient overlay to make visualizer pop
  const gradient = document.createElement('div');
  gradient.className = 'absolute inset-0 bg-gradient-to-b from-transparent via-[#0a1118]/40 to-[#0a1118]/80 z-0 pointer-events-none';
  wrapper.appendChild(gradient);

  const c = mountCanvas2D(wrapper);
  c.canvas.className = 'w-full h-full block absolute inset-0 z-10';
  const canvas = c.canvas;
  const ctx = c.ctx;

  let currentBg: string | null = null;
  const applyMetadata = (m: ServerStateMetadata | null) => {
    const bgImage = m?.artwork_url ?? dummyCover;
    if (bgImage === currentBg) return;
    currentBg = bgImage;
    bgDiv.style.backgroundImage = `url(${bgImage})`;
  };
  applyMetadata(initialMetadata);

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    metadata: applyMetadata,
    frame({ audio, settings, metadata }) {
      applyMetadata(metadata);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settings;
      const dataArray = audio.spectrum({ fftSize: 256, smoothing: 0.85 });
      const bufferLength = dataArray.length;

      ctx.clearRect(0, 0, w, h);

      const centerY = h / 2;

      // Draw center line
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.strokeStyle = `hsla(${190 + currentSettings.hueShift}, 100%, 80%, 0.3)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      const numBars = bufferLength;
      const totalWidth = w * 0.8;
      const barSpacing = totalWidth / numBars;
      const startX = (w - totalWidth) / 2;

      let x = startX;

      for (let i = 0; i < bufferLength; i++) {
        const windowMultiplier = Math.sin((i / (bufferLength - 1)) * Math.PI);

        let barHeight = (dataArray[i] / 255) * (h * 0.4) * currentSettings.sensitivity * currentSettings.scale;
        barHeight *= windowMultiplier;

        if (barHeight < 2) barHeight = 2;

        const hue = (190 + currentSettings.hueShift) % 360;

        // Draw the glow
        ctx.beginPath();
        ctx.moveTo(x, centerY - barHeight);
        ctx.lineTo(x, centerY + barHeight);

        ctx.shadowBlur = 20;
        ctx.shadowColor = `hsla(${hue}, 100%, 50%, 0.8)`;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.8)`;
        ctx.lineWidth = Math.max(2, barSpacing * 0.6);
        ctx.lineCap = 'round';
        ctx.stroke();

        // Draw the core
        ctx.beginPath();
        ctx.moveTo(x, centerY - barHeight * 0.9);
        ctx.lineTo(x, centerY + barHeight * 0.9);

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, barSpacing * 0.3);
        ctx.lineCap = 'round';
        ctx.stroke();

        x += barSpacing;
      }
    },
    dispose() {
      wrapper.remove();
    },
  };
};

export default BackgroundImageSendspin;
