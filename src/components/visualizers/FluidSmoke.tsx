import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: { h: number; s: number; l: number };
  life: number;
  maxLife: number;
  growth: number;
  wobbleSpeed: number;
  wobbleOffset: number;
}

export default function FluidSmoke({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  const particlesRef = useRef<Particle[]>([]);
  const particleIdCounter = useRef(0);

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
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
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

    let time = 0;

    const spawnParticles = (x: number, y: number, color: {h: number, s: number, l: number}, count: number, intensity: number) => {
      const currentSettings = settingsRef.current;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2 * intensity * currentSettings.speed;
        particlesRef.current.push({
          id: particleIdCounter.current++,
          x: x + (Math.random() - 0.5) * 40,
          y: y + (Math.random() - 0.5) * 40,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - (1 + Math.random() * 2) * currentSettings.speed, // Drift upwards
          radius: (10 + Math.random() * 30) * currentSettings.scale,
          color: {
            h: (color.h + (Math.random() - 0.5) * 20 + currentSettings.hueShift) % 360,
            s: color.s,
            l: color.l + (Math.random() - 0.5) * 10
          },
          life: 1.0,
          maxLife: 0.005 + Math.random() * 0.01, // Decay rate
          growth: (0.5 + Math.random() * 1.5) * currentSettings.scale,
          wobbleSpeed: 0.02 + Math.random() * 0.05,
          wobbleOffset: Math.random() * Math.PI * 2
        });
      }
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      time += 1 * currentSettings.speed;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const mid = dataArray.slice(10, 30).reduce((a, b) => a + b, 0) / 20;
      const treble = dataArray.slice(40, 80).reduce((a, b) => a + b, 0) / 40;

      // Clear background to solid black
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      // Spawn new particles based on audio
      // Orange for bass (top left drift)
      if (bass > 180) {
        spawnParticles(cx - 50, cy - 50, {h: 25, s: 100, l: 50}, Math.floor((bass - 180) / 10), bass / 255);
      }
      // Green for mid (top right drift)
      if (mid > 140) {
        spawnParticles(cx + 50, cy - 50, {h: 110, s: 90, l: 55}, Math.floor((mid - 140) / 10), mid / 255);
      }
      // Yellow for treble (bottom drift)
      if (treble > 100) {
        spawnParticles(cx, cy + 100, {h: 55, s: 100, l: 50}, Math.floor((treble - 100) / 10), treble / 255);
      }

      // Continuous slow spawn to keep it alive even when quiet
      if (time % 5 === 0) {
        spawnParticles(cx, cy, {h: 25, s: 100, l: 50}, 1, 0.2);
        spawnParticles(cx, cy, {h: 110, s: 90, l: 55}, 1, 0.2);
      }

      // Sort particles by life so newer ones draw on top (or vice versa depending on desired effect)
      // Drawing older (larger, faded) ones first makes it look more like volumetric smoke
      particlesRef.current.sort((a, b) => a.life - b.life);

      // Draw particles
      // We use 'source-over' for thick, opaque smoke, or 'screen' for glowing smoke.
      // The reference image is very opaque and thick, so 'source-over' with soft gradients is best.
      ctx.globalCompositeOperation = 'source-over';

      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];

        // Update physics
        p.x += p.vx + Math.sin(time * p.wobbleSpeed + p.wobbleOffset) * 2 * currentSettings.speed;
        p.y += p.vy;
        p.radius += p.growth * currentSettings.speed;
        p.life -= p.maxLife * currentSettings.speed;

        // Add some turbulence based on audio
        p.vx += (Math.random() - 0.5) * (bass / 255) * 0.5;
        p.vy += (Math.random() - 0.5) * (bass / 255) * 0.5;

        // Friction
        p.vx *= 0.98;
        p.vy *= 0.98;

        if (p.life <= 0 || p.radius > Math.max(w, h)) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        // Draw
        // Create a 3D-ish volumetric gradient
        const grad = ctx.createRadialGradient(
          p.x - p.radius * 0.2, p.y - p.radius * 0.2, 0, // Highlight offset
          p.x, p.y, p.radius
        );

        // Easing for opacity to make it fade out smoothly
        const opacity = Math.pow(p.life, 1.5) * 0.8;

        // Highlight
        grad.addColorStop(0, `hsla(${p.color.h}, ${p.color.s}%, ${Math.min(100, p.color.l + 30)}%, ${opacity})`);
        // Midtone
        grad.addColorStop(0.4, `hsla(${p.color.h}, ${p.color.s}%, ${p.color.l}%, ${opacity * 0.9})`);
        // Shadow/Edge
        grad.addColorStop(1, `hsla(${p.color.h}, ${p.color.s}%, ${Math.max(0, p.color.l - 20)}%, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
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
