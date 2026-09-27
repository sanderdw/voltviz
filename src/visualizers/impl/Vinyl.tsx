import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, Eye, EyeOff } from 'lucide-react';
import dummyCover from '../../../images/dummycover.png';
import type { OverlayProps, VisualizerFactory } from '../runtime/types';

type VinylApi = { setImage(url: string): void };

const FFT_SIZE = 1024; // Larger FFT size for better time domain resolution

const Vinyl: VisualizerFactory = ({ container }) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full h-full relative overflow-hidden bg-[#0f172a]';
  container.appendChild(wrapper);

  const canvas = document.createElement('canvas');
  canvas.className = 'w-full h-full block absolute inset-0 z-10';
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d');

  let currentImage: HTMLImageElement | null = null;
  let disposed = false;

  // The standard cover until an image is uploaded; a late load never replaces a newer image.
  let requested: string | null = null;
  const setImage = (url: string) => {
    requested = url;
    const img = new Image();
    img.onload = () => {
      if (!disposed && requested === url) currentImage = img;
    };
    img.src = url;
  };
  setImage(dummyCover);

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      offCanvas.width = w;
      offCanvas.height = h;
    },
    frame({ audio, settings }) {
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settings;

      // Use time domain data for the waveform to get the oscilloscope look
      // (the original read it into a frequencyBinCount-long buffer: first half only)
      const bufferLength = FFT_SIZE / 2;
      const dataArray = audio.waveform({ fftSize: FFT_SIZE, smoothing: 0.8 }).subarray(0, bufferLength);

      ctx.clearRect(0, 0, w, h);

      const image = currentImage;

      // 1. Draw Blurred Background
      if (image) {
        ctx.filter = 'blur(40px) brightness(0.4)';
        const scale = Math.max(w / image.width, h / image.height);
        const iw = image.width * scale;
        const ih = image.height * scale;
        ctx.drawImage(image, w/2 - iw/2, h/2 - ih/2, iw, ih);
        ctx.filter = 'none';
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
      }

      const coverSize = Math.min(h * 0.5, w * 0.3);
      const coverCenterX = w * 0.25;
      const coverCenterY = h / 2;
      const vinylCenterX = coverCenterX + coverSize * 0.4;
      const vinylRadius = coverSize * 0.48;

      const angle = (performance.now() / 1000) * (33.3 / 60) * Math.PI * 2 * currentSettings.speed;

      // 2. Draw Middle Band
      ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
      const bandTop = h/2 - coverSize * 0.7;
      const bandBottom = h/2 + coverSize * 0.7;
      ctx.fillRect(0, bandTop, w, bandBottom - bandTop);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bandTop);
      ctx.lineTo(w, bandTop);
      ctx.moveTo(0, bandBottom);
      ctx.lineTo(w, bandBottom);
      ctx.stroke();

      // Helper to draw Vinyl and Cover
      const drawVinylAndCover = (targetCtx: CanvasRenderingContext2D, isReflection = false) => {
        // Vinyl
        targetCtx.save();
        targetCtx.translate(vinylCenterX, coverCenterY);

        if (!isReflection) {
          targetCtx.shadowColor = 'rgba(0,0,0,0.5)';
          targetCtx.shadowBlur = 20;
          targetCtx.shadowOffsetX = 10;
          targetCtx.shadowOffsetY = 10;
        }

        targetCtx.beginPath();
        targetCtx.arc(0, 0, vinylRadius, 0, Math.PI * 2);
        targetCtx.fillStyle = '#0a0a0a';
        targetCtx.fill();

        targetCtx.shadowColor = 'transparent';

        // Grooves
        targetCtx.strokeStyle = '#1a1a1a';
        targetCtx.lineWidth = 1.5;
        for (let r = vinylRadius * 0.35; r < vinylRadius * 0.95; r += 5) {
          targetCtx.beginPath();
          targetCtx.arc(0, 0, r, 0, Math.PI * 2);
          targetCtx.stroke();
        }

        // Highlights (Fixed, non-rotating)
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        targetCtx.beginPath();
        targetCtx.moveTo(0, 0);
        targetCtx.arc(0, 0, vinylRadius, -Math.PI/8, Math.PI/8);
        targetCtx.lineTo(0, 0);
        targetCtx.fill();
        targetCtx.beginPath();
        targetCtx.moveTo(0, 0);
        targetCtx.arc(0, 0, vinylRadius, Math.PI - Math.PI/8, Math.PI + Math.PI/8);
        targetCtx.lineTo(0, 0);
        targetCtx.fill();

        // Rotating part (Label)
        targetCtx.save();
        targetCtx.rotate(angle);

        targetCtx.beginPath();
        targetCtx.arc(0, 0, vinylRadius * 0.33, 0, Math.PI * 2);
        targetCtx.clip();
        if (image) {
          targetCtx.drawImage(image, -vinylRadius * 0.33, -vinylRadius * 0.33, vinylRadius * 0.66, vinylRadius * 0.66);
        } else {
          targetCtx.fillStyle = '#1e293b';
          targetCtx.fill();
        }

        // Center hole
        targetCtx.beginPath();
        targetCtx.arc(0, 0, vinylRadius * 0.04, 0, Math.PI * 2);
        targetCtx.fillStyle = '#0a0a0a';
        targetCtx.fill();

        targetCtx.restore(); // End rotating part
        targetCtx.restore(); // End Vinyl

        // Cover
        targetCtx.save();
        targetCtx.translate(coverCenterX, coverCenterY);

        if (!isReflection) {
          targetCtx.shadowColor = 'rgba(0,0,0,0.7)';
          targetCtx.shadowBlur = 30;
          targetCtx.shadowOffsetX = -10;
          targetCtx.shadowOffsetY = 15;
        }

        if (image) {
          targetCtx.drawImage(image, -coverSize/2, -coverSize/2, coverSize, coverSize);
        } else {
          targetCtx.fillStyle = '#1e293b';
          targetCtx.fillRect(-coverSize/2, -coverSize/2, coverSize, coverSize);
          targetCtx.strokeStyle = '#334155';
          targetCtx.lineWidth = 2;
          targetCtx.strokeRect(-coverSize/2, -coverSize/2, coverSize, coverSize);
        }
        targetCtx.restore();
      };

      // 3. Draw Reflection
      const coverBottom = coverCenterY + coverSize/2;
      const reflectionStartY = bandBottom;
      const reflectionOffset = reflectionStartY - coverBottom;

      if (offCtx) {
        offCtx.clearRect(0, 0, w, h);
        offCtx.save();
        offCtx.translate(0, reflectionOffset);
        offCtx.translate(0, coverBottom);
        offCtx.scale(1, -1);
        offCtx.translate(0, -coverBottom);
        drawVinylAndCover(offCtx, true);
        offCtx.restore();

        // Apply gradient mask to fade out the reflection
        offCtx.globalCompositeOperation = 'destination-in';
        const maskGrad = offCtx.createLinearGradient(0, reflectionStartY, 0, reflectionStartY + coverSize * 0.8);
        maskGrad.addColorStop(0, 'rgba(0,0,0,0.15)'); // Barely visible at the mirror line
        maskGrad.addColorStop(1, 'rgba(0,0,0,0)'); // Fade to transparent
        offCtx.fillStyle = maskGrad;
        offCtx.fillRect(0, reflectionStartY, w, h - reflectionStartY);
        offCtx.globalCompositeOperation = 'source-over';

        // Draw the reflection onto the main canvas
        ctx.drawImage(offCanvas, 0, 0);
      }

      // 4. Draw Actual Vinyl and Cover
      drawVinylAndCover(ctx, false);

      // 5. Draw Waveform
      const waveStartX = vinylCenterX + vinylRadius + w * 0.05;
      const waveEndX = w * 0.9;
      const waveWidth = waveEndX - waveStartX;
      const numBars = 150;
      const barSpacing = waveWidth / numBars;

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = Math.max(1.5, barSpacing * 0.6);
      ctx.lineCap = 'round';

      ctx.beginPath();
      for (let i = 0; i < numBars; i++) {
        const dataIdx = Math.floor((i / numBars) * bufferLength);
        const val = (dataArray[dataIdx] - 128) / 128; // -1 to 1

        const windowMultiplier = Math.sin((i / (numBars - 1)) * Math.PI);
        let barHeight = Math.abs(val) * (coverSize * 0.6) * currentSettings.sensitivity * currentSettings.scale;
        barHeight *= windowMultiplier;
        if (barHeight < 2) barHeight = 2;

        const bx = waveStartX + i * barSpacing;
        ctx.moveTo(bx, coverCenterY - barHeight);
        ctx.lineTo(bx, coverCenterY + barHeight);
      }
      ctx.stroke();
    },
    dispose() {
      disposed = true;
      currentImage = null;
      offCanvas.width = 0;
      offCanvas.height = 0;
      wrapper.remove();
    },
    api: { setImage },
  };
};

export default Vinyl;

export function Overlay({ api }: OverlayProps) {
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showUI, setShowUI] = useState(true);

  useEffect(() => {
    if (bgImage) (api as VinylApi | null)?.setImage(bgImage);
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
          {bgImage ? 'Change Cover' : 'Upload Cover'}
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
