import { useEffect, useRef, useState } from 'react';
import { VisualizerSettings } from '../../types';
import { ImagePlus, Eye, EyeOff } from 'lucide-react';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function BlurImage({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [bgImage, setBgImage] = useState<string | null>(null);
  const [showUI, setShowUI] = useState(true);

  // Offscreen canvases for ping-pong blur
  const offCanvas1Ref = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const offCanvas2Ref = useRef<HTMLCanvasElement>(document.createElement('canvas'));

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

    const offCanvas1 = offCanvas1Ref.current;
    const offCtx1 = offCanvas1.getContext('2d');
    const offCanvas2 = offCanvas2Ref.current;
    const offCtx2 = offCanvas2.getContext('2d');

    if (!offCtx1 || !offCtx2) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        canvasRef.current.width = w;
        canvasRef.current.height = h;

        // Downscale offscreen canvases for performance and smoother blur
        const downscale = 4;
        offCanvas1.width = Math.floor(w / downscale);
        offCanvas1.height = Math.floor(h / downscale);
        offCanvas2.width = Math.floor(w / downscale);
        offCanvas2.height = Math.floor(h / downscale);
      }
    };
    window.addEventListener('resize', resize);
    resize();

    let time = 0;
    let smoothedIntensity = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const offW = offCanvas1.width;
      const offH = offCanvas1.height;
      const currentSettings = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const intensity = (average / 255) * currentSettings.sensitivity;

      smoothedIntensity += (intensity - smoothedIntensity) * 0.2;
      time += 0.01 * currentSettings.speed;

      ctx.clearRect(0, 0, w, h);

      const drawCoverImage = (context: CanvasRenderingContext2D, targetW: number, targetH: number, dx = 0, dy = 0) => {
        context.fillStyle = '#000';
        context.fillRect(0, 0, targetW, targetH);

        if (imageRef.current) {
          const img = imageRef.current;
          const scale = Math.max(targetW / img.width, targetH / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const drawX = (targetW - drawW) / 2 + dx;
          const drawY = (targetH - drawH) / 2 + dy;
          context.drawImage(img, drawX, drawY, drawW, drawH);
        } else {
          context.fillStyle = '#ffffff';
          context.font = `bold ${Math.max(14, Math.floor(targetW/12))}px sans-serif`;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText('UPLOAD IMAGE', targetW/2 + dx, targetH/2 + dy);
        }
      };

      // 1. Draw base image to main canvas
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      drawCoverImage(ctx, w, h);

      // 2. Prepare highlights on offCanvas1
      offCtx1.globalCompositeOperation = 'source-over';
      offCtx1.globalAlpha = 1.0;
      drawCoverImage(offCtx1, offW, offH);

      // Crush blacks to isolate highlights
      offCtx1.globalCompositeOperation = 'multiply';
      offCtx1.drawImage(offCanvas1, 0, 0);
      offCtx1.drawImage(offCanvas1, 0, 0);

      // 3. Vertical light rays via scaling
      offCtx2.clearRect(0, 0, offW, offH);
      offCtx2.globalCompositeOperation = 'lighter';

      const numSamples = 40;
      // Base stretch + audio reactive stretch
      const maxStretch = 1 + smoothedIntensity * 25 * currentSettings.scale;

      const pulsePhase = time * 8;
      const pulseBrightness = 0.5 + smoothedIntensity * 2.0;
      for (let i = 0; i < numSamples; i++) {
        const t = i / numSamples;
        const scaleY = 1 + t * maxStretch;
        // Sine wave travels through the ray stack, creating a rippling pulse
        const pulse = 0.5 + 0.5 * Math.sin(pulsePhase - t * Math.PI * 2.5);
        offCtx2.globalAlpha = (pulseBrightness / numSamples) * pulse;
        offCtx2.save();
        offCtx2.translate(offW / 2, offH / 2);
        offCtx2.scale(1, scaleY);
        offCtx2.drawImage(offCanvas1, -offW / 2, -offH / 2);
        offCtx2.restore();
      }

      // 4. Tint the light rays
      offCtx2.globalCompositeOperation = 'source-atop';
      offCtx2.globalAlpha = 1.0;
      const hue = (currentSettings.hueShift + time * 50) % 360;
      offCtx2.fillStyle = `hsla(${hue}, 60%, 35%, 0.6)`;
      offCtx2.fillRect(0, 0, offW, offH);

      // 5. Draw the blurred streaks over the main canvas
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.6, 0.3 + smoothedIntensity * 0.5);
      ctx.drawImage(offCanvas2, 0, 0, w, h);

      // Optional: Add a second layer of streaks for extra intensity
      if (smoothedIntensity > 0.4) {
        ctx.globalAlpha = Math.min(0.4, (smoothedIntensity - 0.4) * 1.2);
        ctx.filter = `hue-rotate(90deg)`;
        ctx.drawImage(offCanvas2, 0, 0, w, h);
        ctx.filter = 'none';
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
