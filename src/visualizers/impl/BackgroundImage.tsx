import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, Eye, EyeOff } from 'lucide-react';
import dummyCover from '../../../images/dummycover.png';
import { mountCanvas2D } from '../lib/canvas2d';
import type { OverlayProps, VisualizerFactory } from '../runtime/types';

type BackgroundImageApi = { setImage(url: string): void };

const BackgroundImage: VisualizerFactory = ({ container }) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full h-full relative overflow-hidden bg-[#0a1118]';
  container.appendChild(wrapper);

  let bgDiv: HTMLDivElement | null = null;

  // Dark gradient overlay to make visualizer pop
  const gradient = document.createElement('div');
  gradient.className = 'absolute inset-0 bg-gradient-to-b from-transparent via-[#0a1118]/40 to-[#0a1118]/80 z-0 pointer-events-none';
  wrapper.appendChild(gradient);

  const c = mountCanvas2D(wrapper);
  c.canvas.className = 'w-full h-full block absolute inset-0 z-10';
  const canvas = c.canvas;
  const ctx = c.ctx;

  const setImage = (url: string) => {
    if (!bgDiv) {
      bgDiv = document.createElement('div');
      bgDiv.className = 'absolute inset-0 bg-cover bg-center bg-no-repeat opacity-80';
      wrapper.insertBefore(bgDiv, gradient);
    }
    bgDiv.style.backgroundImage = `url(${url})`;
  };
  // The standard cover until an image is uploaded
  setImage(dummyCover);

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    frame({ audio, settings }) {
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
      const totalWidth = w * 0.8; // Take up 80% of the screen width
      const barSpacing = totalWidth / numBars;
      const startX = (w - totalWidth) / 2;

      let x = startX;

      for (let i = 0; i < bufferLength; i++) {
        // Apply a window function to make the edges taper off
        const windowMultiplier = Math.sin((i / (bufferLength - 1)) * Math.PI);

        // Calculate bar height
        let barHeight = (dataArray[i] / 255) * (h * 0.4) * currentSettings.sensitivity * currentSettings.scale;
        barHeight *= windowMultiplier; // Taper edges

        // Ensure a minimum height for the line
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
    api: { setImage },
  };
};

export default BackgroundImage;

export function Overlay({ api }: OverlayProps) {
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showUI, setShowUI] = useState(true);

  useEffect(() => {
    if (bgImage) (api as BackgroundImageApi | null)?.setImage(bgImage);
  }, [api, bgImage]);

  const handleBgUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setBgImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="absolute bottom-6 right-6 flex items-center gap-3 z-20">
      {showUI && (
        <label className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer transition-colors">
          <ImagePlus className="w-4 h-4" />
          {bgImage ? 'Change Background' : 'Upload Background'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleBgUpload}
          />
        </label>
      )}

      <button
        onClick={() => setShowUI(!showUI)}
        className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition-colors cursor-pointer"
        title={showUI ? "Hide UI" : "Show UI"}
      >
        {showUI ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
