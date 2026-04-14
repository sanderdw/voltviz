import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

interface Shape {
  type: 'circle' | 'triangle' | 'square' | 'cross' | 'squiggle';
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  rotSpeed: number;
  isFilled: boolean;
  pulseFactor: number;
}

export default function NeonWave({ stream, settings }: Props) {
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
    audioCtx.resume();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDataArray = new Uint8Array(bufferLength);

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    // Generate random background shapes
    const shapes: Shape[] = [];
    const colors = ['#00ffff', '#ff00ff', '#8a2be2', '#00ffcc'];
    const types: Shape['type'][] = ['circle', 'triangle', 'square', 'cross', 'squiggle'];

    for (let i = 0; i < 40; i++) {
      shapes.push({
        type: types[Math.floor(Math.random() * types.length)],
        x: Math.random(), // relative to width
        y: Math.random(), // relative to height
        size: 10 + Math.random() * 40,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.02,
        isFilled: Math.random() > 0.7,
        pulseFactor: Math.random()
      });
    }

    const drawShape = (ctx: CanvasRenderingContext2D, shape: Shape, bass: number, scale: number) => {
      ctx.save();
      const x = shape.x * canvas.width;
      const y = shape.y * canvas.height;
      const currentSize = (shape.size + (bass * shape.pulseFactor * 0.5)) * scale;

      ctx.translate(x, y);
      ctx.rotate(shape.rotation);

      ctx.beginPath();
      if (shape.type === 'circle') {
        ctx.arc(0, 0, currentSize, 0, Math.PI * 2);
        // Sometimes draw concentric circle
        if (!shape.isFilled && Math.random() > 0.5) {
          ctx.moveTo(currentSize * 0.6, 0);
          ctx.arc(0, 0, currentSize * 0.6, 0, Math.PI * 2);
        }
      } else if (shape.type === 'triangle') {
        ctx.moveTo(0, -currentSize);
        ctx.lineTo(currentSize * 0.866, currentSize * 0.5);
        ctx.lineTo(-currentSize * 0.866, currentSize * 0.5);
        ctx.closePath();
      } else if (shape.type === 'square') {
        ctx.rect(-currentSize/2, -currentSize/2, currentSize, currentSize);
      } else if (shape.type === 'cross') {
        ctx.moveTo(-currentSize, 0);
        ctx.lineTo(currentSize, 0);
        ctx.moveTo(0, -currentSize);
        ctx.lineTo(0, currentSize);
      } else if (shape.type === 'squiggle') {
        ctx.moveTo(-currentSize, 0);
        ctx.quadraticCurveTo(-currentSize/2, -currentSize, 0, 0);
        ctx.quadraticCurveTo(currentSize/2, currentSize, currentSize, 0);
      }

      ctx.shadowBlur = 10 * scale;
      ctx.shadowColor = shape.color;

      if (shape.isFilled && shape.type !== 'cross' && shape.type !== 'squiggle') {
        ctx.fillStyle = shape.color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
      } else {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = 2 * scale;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
      }

      ctx.restore();
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(timeDataArray);

      // Calculate frequency bands
      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const mid = dataArray.slice(10, 100).reduce((a, b) => a + b, 0) / 90;

      // Clear background
      ctx.fillStyle = '#0a001a'; // Deep purple/blue dark background
      ctx.fillRect(0, 0, w, h);

      // Draw shapes
      shapes.forEach(shape => {
        shape.rotation += shape.rotSpeed * currentSettings.speed;
        drawShape(ctx, shape, bass * currentSettings.sensitivity, currentSettings.scale);
      });

      // Draw horizontal center line
      const centerY = h / 2;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.strokeStyle = `hsla(${180 + currentSettings.hueShift}, 100%, 50%, 0.5)`;
      ctx.lineWidth = 2 * currentSettings.scale;
      ctx.shadowBlur = 10;
      ctx.shadowColor = `hsla(${180 + currentSettings.hueShift}, 100%, 50%, 1)`;
      ctx.stroke();

      // Draw waveform (Magenta)
      ctx.beginPath();
      const sliceWidth = w / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = timeDataArray[i] / 128.0; // 0 to 2
        const y = centerY + (v - 1) * (h / 3) * currentSettings.sensitivity;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.strokeStyle = `hsla(${300 + currentSettings.hueShift}, 100%, 60%, 1)`; // Magenta
      ctx.lineWidth = 6 * currentSettings.scale;
      ctx.shadowBlur = 20 * currentSettings.scale;
      ctx.shadowColor = `hsla(${300 + currentSettings.hueShift}, 100%, 50%, 1)`;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Draw secondary waveform (Cyan) - slightly offset and different scaling
      ctx.beginPath();
      x = 0;
      for (let i = 0; i < bufferLength; i++) {
        // Use a slightly different offset or smoothing for the second wave
        const v = timeDataArray[i] / 128.0;
        const y = centerY + (v - 1) * (h / 4) * currentSettings.sensitivity * Math.sin(i * 0.05);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.strokeStyle = `hsla(${180 + currentSettings.hueShift}, 100%, 60%, 0.8)`; // Cyan
      ctx.lineWidth = 4 * currentSettings.scale;
      ctx.shadowBlur = 15 * currentSettings.scale;
      ctx.shadowColor = `hsla(${180 + currentSettings.hueShift}, 100%, 50%, 1)`;
      ctx.stroke();

      // Draw bottom frequency bars
      const barCount = 100;
      const barWidth = (w / barCount) * 0.6;
      const barSpacing = (w / barCount) * 0.4;
      const step = Math.floor(bufferLength / 2 / barCount); // Only use lower half of frequencies

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step];
        const percent = value / 255;
        const barHeight = percent * (h / 4) * currentSettings.sensitivity;

        const barX = i * (barWidth + barSpacing) + barSpacing / 2;
        const barY = h - barHeight - 40; // 40px padding from bottom

        const hue = (180 + (i / barCount) * 40 + currentSettings.hueShift) % 360; // Cyan to Blue

        ctx.fillStyle = `hsla(${hue}, 100%, 60%, 1)`;
        ctx.shadowBlur = 10 * currentSettings.scale;
        ctx.shadowColor = `hsla(${hue}, 100%, 50%, 1)`;

        // Main bar
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Reflection/mirrored bar below
        ctx.globalAlpha = 0.3;
        ctx.fillRect(barX, h - 40, barWidth, barHeight * 0.3);
        ctx.globalAlpha = 1.0;
      }

      // Draw wavy line below bars
      ctx.beginPath();
      for (let i = 0; i <= w; i += 10) {
        const waveY = h - 15 + Math.sin(i * 0.02 + Date.now() * 0.002 * currentSettings.speed) * 10;
        if (i === 0) ctx.moveTo(i, waveY);
        else ctx.lineTo(i, waveY);
      }
      ctx.strokeStyle = `hsla(${180 + currentSettings.hueShift}, 100%, 60%, 0.8)`;
      ctx.lineWidth = 2 * currentSettings.scale;
      ctx.shadowBlur = 10 * currentSettings.scale;
      ctx.shadowColor = `hsla(${180 + currentSettings.hueShift}, 100%, 50%, 1)`;
      ctx.stroke();

      // Draw aesthetic text
      ctx.shadowBlur = 0;
      ctx.fillStyle = `hsla(${180 + currentSettings.hueShift}, 100%, 70%, 0.8)`;
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.fillText('0.Z4-', 10, h - 10);

      const timeStr = new Date(Date.now()).toISOString().substr(14, 5); // mm:ss
      ctx.fillText(`-0:${timeStr}`, w - 60, h - 10);

      // Reset shadow for next frame
      ctx.shadowBlur = 0;
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
