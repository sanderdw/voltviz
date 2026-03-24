import React, { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function Bars({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;
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

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);

      // Fade out for smooth trails
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, w, h);

      const barWidth = (w / bufferLength) * 2.5 * currentSettings.scale;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        const percent = Math.min(1, (value / 255) * currentSettings.sensitivity);
        const barHeight = percent * h * 0.8 * currentSettings.scale;

        const hue = ((i / bufferLength) * 360 + (Date.now() * 0.05 * currentSettings.speed) + currentSettings.hueShift) % 360;

        // Create gradient for each bar
        const gradient = ctx.createLinearGradient(0, h, 0, h - barHeight);
        gradient.addColorStop(0, `hsla(${hue}, 100%, 20%, 1)`);
        gradient.addColorStop(1, `hsla(${hue}, 100%, 60%, 1)`);

        ctx.fillStyle = gradient;

        // Draw bar with rounded top
        ctx.beginPath();
        ctx.roundRect(x, h - barHeight, barWidth, barHeight, [barWidth/2, barWidth/2, 0, 0]);
        ctx.fill();

        // Add a bright cap
        if (barHeight > 5 * currentSettings.scale) {
          ctx.fillStyle = `hsla(${hue}, 100%, 80%, 1)`;
          ctx.beginPath();
          ctx.roundRect(x, h - barHeight, barWidth, 4 * currentSettings.scale, [2 * currentSettings.scale, 2 * currentSettings.scale, 2 * currentSettings.scale, 2 * currentSettings.scale]);
          ctx.fill();
        }

        x += barWidth + 2 * currentSettings.scale;
      }
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
