import React, { useEffect, useRef, useState } from 'react';
import { VisualizerSettings } from '../../types';
import { ImagePlus, Eye, EyeOff } from 'lucide-react';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function GlitchVisualizer({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const audioCtxRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const sourceRef = useRef<MediaStreamAudioSourceNode>();
  const settingsRef = useRef(settings);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showUI, setShowUI] = useState(true);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setBgImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (bgImage) {
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
      };
      img.src = bgImage;
    } else {
      imageRef.current = null;
    }
  }, [bgImage]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    let glitchParams = {
      active: false,
      intensity: 0,
      slices: [] as any[],
      timer: 0,
      globalShiftX: 0,
      globalShiftY: 0,
      rgbSplit: false
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);

      // Calculate overall audio intensity
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const normalizedIntensity = average / 255;

      // Trigger glitch based on audio intensity and settings
      const threshold = 0.3 / currentSettings.sensitivity;

      if (normalizedIntensity > threshold && Math.random() > 0.3) {
        glitchParams.active = true;
        glitchParams.intensity = normalizedIntensity * currentSettings.scale;
        glitchParams.timer = Math.floor(Math.random() * 8) + 2; // frames to hold glitch
        glitchParams.globalShiftX = (Math.random() - 0.5) * 20 * glitchParams.intensity;
        glitchParams.globalShiftY = (Math.random() - 0.5) * 10 * glitchParams.intensity;
        glitchParams.rgbSplit = Math.random() > 0.4;

        // Generate slices
        const numSlices = Math.floor(Math.random() * 20 * glitchParams.intensity) + 5;
        glitchParams.slices = [];
        for (let i = 0; i < numSlices; i++) {
          const sliceHeight = Math.random() * (h * 0.15) + 2;
          glitchParams.slices.push({
            y: Math.random() * h,
            height: sliceHeight,
            offset: (Math.random() - 0.5) * w * 0.3 * glitchParams.intensity,
            filter: Math.random() > 0.7 ? `hue-rotate(${Math.random() * 360}deg) saturate(300%)` : 'none'
          });
        }
      } else if (glitchParams.timer > 0) {
        glitchParams.timer--;
      } else {
        glitchParams.active = false;
        glitchParams.globalShiftX = 0;
        glitchParams.globalShiftY = 0;
        glitchParams.rgbSplit = false;
      }

      ctx.clearRect(0, 0, w, h);

      // Helper to draw the image covering the canvas
      const drawCoverImage = (context: CanvasRenderingContext2D, dx = 0, dy = 0) => {
        if (imageRef.current) {
          const img = imageRef.current;
          const scale = Math.max(w / img.width, h / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const drawX = (w - drawW) / 2 + dx;
          const drawY = (h - drawH) / 2 + dy;
          context.drawImage(img, drawX, drawY, drawW, drawH);
        } else {
          // Fallback pattern if no image
          context.fillStyle = '#111';
          context.fillRect(0, 0, w, h);
          context.fillStyle = '#333';
          context.font = '40px monospace';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText('UPLOAD IMAGE', w/2 + dx, h/2 + dy);
        }
      };

      // 1. Draw base image
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;

      if (glitchParams.active && glitchParams.rgbSplit) {
        // RGB Split effect
        ctx.save();
        ctx.globalCompositeOperation = 'screen';

        // Red channel shift
        ctx.filter = 'sepia(100%) hue-rotate(-50deg) saturate(500%)';
        drawCoverImage(ctx, glitchParams.globalShiftX - 10 * glitchParams.intensity, glitchParams.globalShiftY);

        // Cyan/Blue channel shift
        ctx.filter = 'sepia(100%) hue-rotate(150deg) saturate(500%)';
        drawCoverImage(ctx, glitchParams.globalShiftX + 10 * glitchParams.intensity, glitchParams.globalShiftY);

        // Green channel shift
        ctx.filter = 'sepia(100%) hue-rotate(50deg) saturate(500%)';
        drawCoverImage(ctx, glitchParams.globalShiftX, glitchParams.globalShiftY + 5 * glitchParams.intensity);

        ctx.restore();
      } else {
        drawCoverImage(ctx, glitchParams.globalShiftX, glitchParams.globalShiftY);
      }

      // 2. Draw glitch slices
      if (glitchParams.active) {
        for (const slice of glitchParams.slices) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, slice.y, w, slice.height);
          ctx.clip();

          ctx.filter = slice.filter;
          ctx.translate(slice.offset, 0);

          if (glitchParams.rgbSplit && Math.random() > 0.5) {
             ctx.globalCompositeOperation = 'screen';
             ctx.filter = 'sepia(100%) hue-rotate(-50deg) saturate(500%)';
             drawCoverImage(ctx, -5, 0);
             ctx.filter = 'sepia(100%) hue-rotate(150deg) saturate(500%)';
             drawCoverImage(ctx, 5, 0);
          } else {
             drawCoverImage(ctx);
          }

          ctx.restore();
        }
      }

      // 3. Draw Scanlines
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }

      // 4. Draw noise/static if glitching heavily
      if (glitchParams.active && glitchParams.intensity > 0.5) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let i = 0; i < 30 * glitchParams.intensity; i++) {
          ctx.fillRect(
            Math.random() * w,
            Math.random() * h,
            Math.random() * 20 + 5,
            Math.random() * 4 + 1
          );
        }
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current) audioCtxRef.current.close();
      window.removeEventListener('resize', resize);
    };
  }, [stream, bgImage]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-black">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />

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
    </div>
  );
}
