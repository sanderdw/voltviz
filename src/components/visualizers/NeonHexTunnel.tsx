import React, { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function NeonHexTunnel({ stream, settings }: Props) {
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

    let time = 0;
    const numHexagons = 20;
    const hexagons: { z: number }[] = [];
    
    for (let i = 0; i < numHexagons; i++) {
      hexagons.push({
        z: (i / numHexagons) * 2000
      });
    }

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      time += 2 * currentSettings.speed;

      analyser.getByteFrequencyData(dataArray);
      
      const bass = dataArray.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const mid = dataArray.slice(10, 30).reduce((a, b) => a + b, 0) / 20;

      // Dark purple/blue background
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#050014';
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';

      const cx = w / 2;
      const cy = h / 2;

      // Update Z positions
      const speedBoost = (bass > 180 ? 40 : 15) + (bass / 255) * 30;
      for (let i = 0; i < hexagons.length; i++) {
        const hex = hexagons[i];
        hex.z -= speedBoost * currentSettings.speed;
        if (hex.z <= 0) {
          hex.z += 2000;
        }
      }
      
      // Sort hexagons by Z (furthest first)
      hexagons.sort((a, b) => b.z - a.z);

      const fov = 400;
      // Gentle camera sway
      const camX = Math.sin(time * 0.005) * 50;
      const camY = Math.cos(time * 0.004) * 50;
      const rotation = Math.sin(time * 0.002) * 0.2;

      const getHexVertices = (z: number, radiusBase: number) => {
        const scale = fov / (Math.max(1, fov + z));
        const radius = radiusBase * scale * currentSettings.scale;
        const verts = [];
        for (let j = 0; j < 6; j++) {
          const angle = rotation + (j * Math.PI) / 3;
          // Audio reactivity: expand radius significantly on bass
          const r = radius + (bass * 2.0 * scale * currentSettings.sensitivity) + (bass > 200 ? 50 * scale : 0);
          verts.push({
            x: cx + camX * scale + Math.cos(angle) * r,
            y: cy + camY * scale + Math.sin(angle) * r
          });
        }
        return { verts, scale };
      };

      for (let i = 0; i < hexagons.length; i++) {
        const hex = hexagons[i];
        const { verts, scale } = getHexVertices(hex.z, 1200);
        
        // Alternate colors between cyan and magenta
        const isCyan = i % 2 === 0;
        const hue = isCyan ? (180 + currentSettings.hueShift) : (300 + currentSettings.hueShift);
        
        // Fade out in distance
        const alpha = Math.min(1, Math.max(0, 1 - (hex.z / 2000))); 
        const color = `hsla(${hue % 360}, 100%, 60%, ${alpha})`;
        const glow = 20 * scale * currentSettings.sensitivity;

        // Draw Hexagon
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let j = 1; j < 6; j++) {
          ctx.lineTo(verts[j].x, verts[j].y);
        }
        ctx.closePath();
        
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, 8 * scale);
        ctx.shadowBlur = glow;
        ctx.shadowColor = color;
        ctx.stroke();

        // Draw connecting lines to the next hexagon (closer to camera)
        if (i < hexagons.length - 1) {
          const nextHex = hexagons[i + 1];
          const nextData = getHexVertices(nextHex.z, 1200);
          
          ctx.beginPath();
          for (let j = 0; j < 6; j++) {
            ctx.moveTo(verts[j].x, verts[j].y);
            ctx.lineTo(nextData.verts[j].x, nextData.verts[j].y);
          }
          ctx.strokeStyle = `hsla(${(hue + 60) % 360}, 100%, 50%, ${alpha * 0.6})`;
          ctx.lineWidth = Math.max(1, 3 * scale);
          ctx.shadowBlur = glow * 0.5;
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;

      // Draw floor and ceiling reflection overlays to simulate the glossy tunnel
      const floorGrad = ctx.createLinearGradient(0, cy + h * 0.1, 0, h);
      floorGrad.addColorStop(0, 'rgba(5, 0, 20, 0.1)');
      floorGrad.addColorStop(1, 'rgba(5, 0, 20, 0.85)');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, cy, w, h / 2);

      const ceilGrad = ctx.createLinearGradient(0, cy - h * 0.1, 0, 0);
      ceilGrad.addColorStop(0, 'rgba(5, 0, 20, 0.1)');
      ceilGrad.addColorStop(1, 'rgba(5, 0, 20, 0.85)');
      ctx.fillStyle = ceilGrad;
      ctx.fillRect(0, 0, w, cy);

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
