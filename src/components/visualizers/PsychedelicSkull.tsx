import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function PsychedelicSkull({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  // Floating blobs for the background
  const blobsRef = useRef<{x: number, y: number, size: number, speed: number, isLime: boolean}[]>([]);

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
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
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

    // Initialize blobs
    if (blobsRef.current.length === 0) {
      for (let i = 0; i < 40; i++) {
        blobsRef.current.push({
          x: Math.random(),
          y: Math.random(),
          size: Math.random() * 15 + 5,
          speed: Math.random() * 2 + 0.5,
          isLime: Math.random() > 0.5
        });
      }
    }

    let time = 0;

    const drawSkull = (ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, bass: number, mid: number, hueShift: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      const limeHue = (80 + hueShift) % 360;
      const cyanHue = (180 + hueShift) % 360;

      // Headphones Band
      ctx.beginPath();
      ctx.arc(0, -20, 100, Math.PI, 0);
      ctx.lineWidth = 25;
      ctx.strokeStyle = `hsla(${limeHue}, 100%, 50%, 1)`;
      ctx.stroke();

      // Cat Ears
      ctx.fillStyle = `hsla(${limeHue}, 100%, 50%, 1)`;
      ctx.beginPath();
      ctx.moveTo(-85, -70);
      ctx.lineTo(-40, -150);
      ctx.lineTo(-15, -95);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(85, -70);
      ctx.lineTo(40, -150);
      ctx.lineTo(15, -95);
      ctx.fill();

      // Inner Cat Ears (Cyan)
      ctx.fillStyle = `hsla(${cyanHue}, 100%, 70%, 1)`;
      ctx.beginPath();
      ctx.moveTo(-70, -80);
      ctx.lineTo(-40, -130);
      ctx.lineTo(-25, -95);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(70, -80);
      ctx.lineTo(40, -130);
      ctx.lineTo(25, -95);
      ctx.fill();

      // Cranium
      ctx.fillStyle = `hsla(${cyanHue}, 100%, 80%, 1)`; // Light Cyan
      ctx.shadowBlur = 30;
      ctx.shadowColor = `hsla(${cyanHue}, 100%, 50%, 0.8)`;
      ctx.beginPath();
      ctx.arc(0, -10, 75, 0, Math.PI * 2);
      ctx.fill();

      // Cheekbones
      ctx.beginPath();
      ctx.moveTo(-70, 20);
      ctx.quadraticCurveTo(-70, 60, -40, 60);
      ctx.lineTo(40, 60);
      ctx.quadraticCurveTo(70, 60, 70, 20);
      ctx.fill();

      // Eyes
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#001111';
      ctx.beginPath();
      // Left eye
      ctx.ellipse(-30, 15, 22, 18, -0.2, 0, Math.PI * 2);
      ctx.fill();
      // Right eye
      ctx.beginPath();
      ctx.ellipse(30, 15, 22, 18, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Glowing pupils (react to mid)
      const pupilSize = 3 + (mid / 255) * 8;
      ctx.fillStyle = `hsla(${limeHue}, 100%, 50%, 1)`;
      ctx.shadowBlur = 10;
      ctx.shadowColor = `hsla(${limeHue}, 100%, 50%, 1)`;
      ctx.beginPath();
      ctx.arc(-30, 15, pupilSize, 0, Math.PI * 2);
      ctx.arc(30, 15, pupilSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Nose
      ctx.fillStyle = '#001111';
      ctx.beginPath();
      ctx.moveTo(0, 35);
      ctx.lineTo(-10, 55);
      ctx.lineTo(10, 55);
      ctx.fill();

      // Ear cups
      ctx.fillStyle = `hsla(${limeHue}, 100%, 50%, 1)`;
      ctx.beginPath();
      ctx.roundRect(-130, -30, 40, 90, 20);
      ctx.roundRect(90, -30, 40, 90, 20);
      ctx.fill();

      // Jaw (moves with bass)
      const jawDrop = (bass / 255) * 40;
      ctx.translate(0, jawDrop);

      ctx.fillStyle = `hsla(${cyanHue}, 100%, 80%, 1)`;
      ctx.beginPath();
      ctx.roundRect(-45, 55, 90, 50, 25);
      ctx.fill();

      // Teeth
      ctx.strokeStyle = `hsla(${limeHue}, 100%, 40%, 1)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      // Horizontal mouth line
      ctx.moveTo(-35, 70);
      ctx.quadraticCurveTo(0, 80, 35, 70);
      ctx.stroke();

      // Vertical teeth lines
      for(let i = -25; i <= 25; i += 12) {
        ctx.beginPath();
        ctx.moveTo(i, 60);
        ctx.lineTo(i, 85);
        ctx.stroke();
      }

      ctx.restore();
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      time += 0.01 * currentSettings.speed;

      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(timeDataArray);

      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const mid = dataArray.slice(10, 100).reduce((a, b) => a + b, 0) / 90;
      const overallVolume = dataArray.reduce((a, b) => a + b, 0) / bufferLength;

      // Clear background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      const limeHue = (80 + currentSettings.hueShift) % 360;
      const yellowHue = (60 + currentSettings.hueShift) % 360;

      // Draw wavy background bands
      const numBands = 12;
      for (let i = 0; i < numBands; i++) {
        ctx.beginPath();
        ctx.moveTo(0, h);

        const yBase = (i / numBands) * h;

        for (let x = 0; x <= w; x += 20) {
          const noise1 = Math.sin(x * 0.005 + time + i * 0.5) * 60;
          const noise2 = Math.cos(x * 0.008 - time * 1.2 + i * 0.3) * 40;

          // Audio distortion from waveform
          const dataIndex = Math.floor((x / w) * bufferLength);
          const audioDistort = (timeDataArray[dataIndex] / 128 - 1) * 80 * currentSettings.sensitivity;

          ctx.lineTo(x, yBase + noise1 + noise2 + audioDistort);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);

        if (i % 3 === 0) {
          ctx.fillStyle = `hsla(${limeHue}, 100%, 50%, 0.6)`;
        } else if (i % 3 === 1) {
          ctx.fillStyle = `hsla(${yellowHue}, 100%, 50%, 0.6)`;
        } else {
          ctx.fillStyle = '#000000';
        }
        ctx.fill();
      }

      // Draw floating blobs
      blobsRef.current.forEach(blob => {
        blob.y -= blob.speed * 0.005 * currentSettings.speed;
        if (blob.y < -0.1) {
          blob.y = 1.1;
          blob.x = Math.random();
        }

        const bx = blob.x * w + Math.sin(time * blob.speed) * 30;
        const by = blob.y * h;

        ctx.fillStyle = blob.isLime ? `hsla(${limeHue}, 100%, 50%, 0.8)` : `hsla(${yellowHue}, 100%, 50%, 0.8)`;
        ctx.beginPath();
        // Distorted blob shape
        ctx.ellipse(bx, by, blob.size * currentSettings.scale, blob.size * 0.8 * currentSettings.scale, time * blob.speed, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw central aura
      const auraRadius = (Math.min(w, h) * 0.4 + bass * 1.5) * currentSettings.scale;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraRadius);
      gradient.addColorStop(0, `hsla(${yellowHue}, 100%, 60%, 0.8)`);
      gradient.addColorStop(0.5, `hsla(${limeHue}, 100%, 50%, 0.4)`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // Draw the skull
      const skullScale = currentSettings.scale * (1 + (overallVolume / 255) * 0.2 * currentSettings.sensitivity);
      drawSkull(ctx, cx, cy, skullScale, bass * currentSettings.sensitivity, mid * currentSettings.sensitivity, currentSettings.hueShift);
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
