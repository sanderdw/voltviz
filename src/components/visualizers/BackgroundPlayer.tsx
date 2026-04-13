import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';
import type { ServerStateMetadata } from '@sendspin/sendspin-js';
import dummyCover from '../../../images/dummycover.png';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
  sendspinMetadata?: ServerStateMetadata | null;
}

export default function BackgroundPlayer({ stream, settings, sendspinMetadata }: Props) {
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

  const bgImage = sendspinMetadata?.artwork_url ?? dummyCover;

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
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
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#0a1118]">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-80"
        style={{ backgroundImage: `url(${bgImage})` }}
      />

      {/* Dark gradient overlay to make visualizer pop */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a1118]/40 to-[#0a1118]/80 z-0 pointer-events-none" />

      <canvas ref={canvasRef} className="w-full h-full block absolute inset-0 z-10" />
    </div>
  );
}
