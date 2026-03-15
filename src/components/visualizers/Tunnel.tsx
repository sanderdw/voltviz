import React, { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function Tunnel({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const audioCtxRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const sourceRef = useRef<MediaStreamAudioSourceNode>();
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

    // Tunnel state
    const rings: { z: number }[] = [];
    const numRings = 40;
    const maxZ = 3000;
    const fov = 400;
    const sides = 12; // Dodecagon tunnel
    const baseRadius = 500;

    for (let i = 0; i < numRings; i++) {
      rings.push({ z: (i / numRings) * maxZ });
    }

    // Particles for warp effect
    const particles: { angle: number, radius: number, z: number, speed: number, size: number }[] = [];
    for (let i = 0; i < 200; i++) {
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: baseRadius * (0.2 + Math.random() * 2.5),
        z: Math.random() * maxZ,
        speed: 15 + Math.random() * 35,
        size: 1 + Math.random() * 2
      });
    }

    let time = 0;

    const project = (x: number, y: number, z: number, w: number, h: number) => {
      if (z < 10) return null; // Behind or too close to camera
      const scale = fov / z;
      return {
        x: x * scale + w / 2,
        y: y * scale + h / 2,
        scale
      };
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      time += 0.005 * currentSettings.speed;

      analyser.getByteFrequencyData(dataArray);

      // Calculate frequency bands
      const bass = dataArray.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      const mid = dataArray.slice(8, 40).reduce((a, b) => a + b, 0) / 32;
      const treble = dataArray.slice(40, 100).reduce((a, b) => a + b, 0) / 60;

      // Clear with dark background, slight trail effect for motion blur
      ctx.fillStyle = `rgba(2, 4, 10, ${0.4})`;
      ctx.fillRect(0, 0, w, h);

      const speedMult = currentSettings.speed * (1 + (bass / 255) * 2.0);
      const currentRadius = baseRadius * currentSettings.scale * (1 + (bass / 255) * 0.4 * currentSettings.sensitivity);
      
      // Camera movement
      const camAngle = time * 0.8;
      const camX = Math.sin(time * 1.2) * 150 * currentSettings.scale * (1 + (mid / 255));
      const camY = Math.cos(time * 0.9) * 150 * currentSettings.scale * (1 + (mid / 255));

      // Draw particles (stars/warp)
      ctx.fillStyle = '#ffffff';
      particles.forEach(p => {
        p.z -= p.speed * speedMult;
        if (p.z < 10) {
          p.z = maxZ;
          p.angle = Math.random() * Math.PI * 2;
        }

        const px = Math.cos(p.angle + camAngle) * p.radius * currentSettings.scale - camX;
        const py = Math.sin(p.angle + camAngle) * p.radius * currentSettings.scale - camY;
        
        const proj = project(px, py, p.z, w, h);
        if (proj) {
          const intensity = Math.max(0, 1 - p.z / maxZ);
          ctx.globalAlpha = intensity * (0.3 + (treble / 255) * 0.7);
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, p.size * proj.scale, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;

      // Sort rings by Z descending (draw furthest first)
      rings.sort((a, b) => b.z - a.z);

      // Draw rings and connecting lines
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        ring.z -= 20 * speedMult;

        if (ring.z < 10) {
          ring.z = maxZ;
        }

        // Audio reactivity for this specific ring based on its Z position
        const freqIndex = Math.floor((1 - (ring.z / maxZ)) * 60);
        const audioVal = dataArray[freqIndex] || 0;
        const intensity = (audioVal / 255) * currentSettings.sensitivity;

        const ringRadius = currentRadius * (1 + intensity * 0.3);
        const distanceFade = Math.max(0, Math.min(1, 1 - (ring.z / maxZ)));
        
        // Color shifting
        const baseHue = (time * 100 + ring.z * 0.05) % 360;
        const hue = (baseHue + currentSettings.hueShift) % 360;
        const alpha = distanceFade * (0.2 + intensity * 0.8);
        
        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
        ctx.lineWidth = Math.max(1, (2 + intensity * 8) * (fov / ring.z));
        ctx.shadowBlur = (15 + intensity * 30) * (fov / ring.z);
        ctx.shadowColor = `hsla(${hue}, 100%, 50%, ${alpha})`;

        const points = [];
        const twist = ring.z * 0.002 * Math.sin(time * 0.5);
        
        for (let s = 0; s < sides; s++) {
          const angle = (s / sides) * Math.PI * 2 + camAngle + twist;
          const x = Math.cos(angle) * ringRadius - camX;
          const y = Math.sin(angle) * ringRadius - camY;
          const proj = project(x, y, ring.z, w, h);
          if (proj) points.push({ ...proj, origX: x, origY: y, angle });
        }

        if (points.length === sides) {
          // Draw the polygon ring
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let s = 1; s < sides; s++) {
            ctx.lineTo(points[s].x, points[s].y);
          }
          ctx.closePath();
          ctx.stroke();

          // Draw connecting lines to the next ring (further away)
          if (i > 0) {
            const prevRing = rings[i - 1];
            // Only connect if they are adjacent in the logical sequence
            if (prevRing.z > ring.z && prevRing.z - ring.z < (maxZ / numRings) * 2) {
              const prevFreqIndex = Math.floor((1 - (prevRing.z / maxZ)) * 60);
              const prevIntensity = ((dataArray[prevFreqIndex] || 0) / 255) * currentSettings.sensitivity;
              const prevRingRadius = currentRadius * (1 + prevIntensity * 0.3);
              const prevTwist = prevRing.z * 0.002 * Math.sin(time * 0.5);
              
              ctx.beginPath();
              for (let s = 0; s < sides; s++) {
                const angle2 = (s / sides) * Math.PI * 2 + camAngle + prevTwist;
                const x2 = Math.cos(angle2) * prevRingRadius - camX;
                const y2 = Math.sin(angle2) * prevRingRadius - camY;
                const p2 = project(x2, y2, prevRing.z, w, h);

                if (p2) {
                  ctx.moveTo(points[s].x, points[s].y);
                  ctx.lineTo(p2.x, p2.y);
                }
              }
              ctx.stroke();
            }
          }
        }
      }
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
