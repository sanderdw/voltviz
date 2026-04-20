import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import dummyCover from '../../../images/dummycover.png';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
}

export default function GlitchBackgroundSendspin({ stream, settings, sendspinMetadata }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Load artwork from sendspin metadata or fall back to dummy cover
  useEffect(() => {
    const url = sendspinMetadata?.artwork_url ?? dummyCover;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
    };
    img.src = url;
  }, [sendspinMetadata?.artwork_url]);

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

      // Graduated glitch intensity tiers based on audio level
      const sens = currentSettings.sensitivity;
      const scale = currentSettings.scale;
      const thresholdLow = 0.15 / sens;
      const thresholdMid = 0.3 / sens;
      const thresholdHigh = 0.5 / sens;
      const thresholdExtreme = 0.7 / sens;

      if (normalizedIntensity > thresholdLow) {
        glitchParams.active = true;

        let tier: number;
        let triggerChance: number;
        let rgbChance: number;
        let maxSlices: number;
        let shiftScale: number;
        let sliceOffsetScale: number;
        let colorChance: number;

        if (normalizedIntensity > thresholdExtreme) {
          tier = 4;
          triggerChance = 0.9;
          rgbChance = 0.8;
          maxSlices = 25;
          shiftScale = 20;
          sliceOffsetScale = 0.3;
          colorChance = 0.5;
        } else if (normalizedIntensity > thresholdHigh) {
          tier = 3;
          triggerChance = 0.7;
          rgbChance = 0.5;
          maxSlices = 15;
          shiftScale = 12;
          sliceOffsetScale = 0.2;
          colorChance = 0.6;
        } else if (normalizedIntensity > thresholdMid) {
          tier = 2;
          triggerChance = 0.5;
          rgbChance = 0.2;
          maxSlices = 8;
          shiftScale = 6;
          sliceOffsetScale = 0.1;
          colorChance = 0.8;
        } else {
          tier = 1;
          triggerChance = 0.3;
          rgbChance = 0;
          maxSlices = 3;
          shiftScale = 2;
          sliceOffsetScale = 0.04;
          colorChance = 0.95;
        }

        if (Math.random() < triggerChance) {
          glitchParams.intensity = normalizedIntensity * scale;
          glitchParams.timer = Math.floor(Math.random() * (tier + 1)) + 1;
          glitchParams.globalShiftX = (Math.random() - 0.5) * shiftScale * glitchParams.intensity;
          glitchParams.globalShiftY = (Math.random() - 0.5) * (shiftScale / 2) * glitchParams.intensity;
          glitchParams.rgbSplit = Math.random() > (1 - rgbChance);

          const numSlices = Math.floor(Math.random() * maxSlices * glitchParams.intensity) + (tier > 1 ? 2 : 1);
          glitchParams.slices = [];
          for (let i = 0; i < numSlices; i++) {
            const maxHeight = tier === 1 ? h * 0.03 : h * 0.15 * (tier / 4);
            const sliceHeight = Math.random() * maxHeight + 1;
            glitchParams.slices.push({
              y: Math.random() * h,
              height: sliceHeight,
              offset: (Math.random() - 0.5) * w * sliceOffsetScale * glitchParams.intensity,
              filter: Math.random() > colorChance ? `hue-rotate(${Math.random() * 360}deg) saturate(${150 + tier * 50}%)` : 'none'
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
      } else if (glitchParams.timer > 0) {
        glitchParams.timer--;
      } else {
        glitchParams.active = false;
        glitchParams.globalShiftX = 0;
        glitchParams.globalShiftY = 0;
        glitchParams.rgbSplit = false;
      }

      ctx.clearRect(0, 0, w, h);

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
          context.fillStyle = '#111';
          context.fillRect(0, 0, w, h);
        }
      };

      // 1. Draw base image
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;

      if (glitchParams.active && glitchParams.rgbSplit) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';

        ctx.filter = 'sepia(100%) hue-rotate(-50deg) saturate(500%)';
        drawCoverImage(ctx, glitchParams.globalShiftX - 10 * glitchParams.intensity, glitchParams.globalShiftY);

        ctx.filter = 'sepia(100%) hue-rotate(150deg) saturate(500%)';
        drawCoverImage(ctx, glitchParams.globalShiftX + 10 * glitchParams.intensity, glitchParams.globalShiftY);

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

      // 4. Draw noise/static scaled to glitch intensity
      if (glitchParams.active && glitchParams.intensity > 0.15) {
        const noiseAlpha = Math.min(0.8, glitchParams.intensity * 0.8);
        const noiseCount = Math.floor(glitchParams.intensity * 40);
        const noiseMaxWidth = 5 + glitchParams.intensity * 15;
        ctx.fillStyle = `rgba(255, 255, 255, ${noiseAlpha})`;
        for (let i = 0; i < noiseCount; i++) {
          ctx.fillRect(
            Math.random() * w,
            Math.random() * h,
            Math.random() * noiseMaxWidth + 2,
            Math.random() * 3 + 1
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
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-black">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
