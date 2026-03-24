import React, { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function WaveTerrain({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  // Stars for the background
  const starsRef = useRef<{x: number, y: number, size: number, alpha: number}[]>([]);

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

    if (starsRef.current.length === 0) {
      for (let i = 0; i < 150; i++) {
        starsRef.current.push({
          x: Math.random(),
          y: Math.random() * 0.6, // Top 60% of the screen
          size: Math.random() * 1.5 + 0.5,
          alpha: Math.random()
        });
      }
    }

    const cols = 60;
    const rows = 40;
    const cellSize = 60;
    const heights: number[][] = Array(rows).fill(0).map(() => Array(cols).fill(0));
    let zOffset = 0;

    const project = (x: number, y: number, z: number, fov: number, w: number, h: number) => {
      if (z < 1) return null;
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

      analyser.getByteFrequencyData(dataArray);

      // Update terrain
      const speed = 4 * currentSettings.speed;
      zOffset += speed;

      if (zOffset >= cellSize) {
        zOffset -= cellSize;
        // Shift rows
        for (let y = 0; y < rows - 1; y++) {
          for (let x = 0; x < cols; x++) {
            heights[y][x] = heights[y + 1][x];
          }
        }

        // Generate new row
        const newRow = new Array(cols).fill(0);
        for (let x = 0; x < cols; x++) {
          const dist = Math.abs(x - cols/2) / (cols/2);
          const freqIndex = Math.floor(dist * 40); // Map distance to frequency bins
          const val = dataArray[freqIndex] / 255;

          // Add some base height variation (perlin-like noise)
          const noise = Math.sin(x * 0.5 + Date.now() * 0.002) * 30;
          newRow[x] = val * 500 * currentSettings.sensitivity + noise;
        }

        // Smooth new row to prevent jagged spikes
        for (let i = 0; i < 2; i++) {
          const smoothed = new Array(cols).fill(0);
          for (let x = 0; x < cols; x++) {
            const prev = x > 0 ? newRow[x-1] : newRow[x];
            const next = x < cols - 1 ? newRow[x+1] : newRow[x];
            smoothed[x] = (prev + newRow[x] * 2 + next) / 4;
          }
          for (let x = 0; x < cols; x++) newRow[x] = smoothed[x];
        }

        for (let x = 0; x < cols; x++) {
          heights[rows - 1][x] = newRow[x];
        }
      }

      // Clear background
      ctx.fillStyle = '#020205';
      ctx.fillRect(0, 0, w, h);

      // Draw stars
      ctx.fillStyle = '#ffffff';
      starsRef.current.forEach(star => {
        star.alpha += (Math.random() - 0.5) * 0.1;
        star.alpha = Math.max(0.1, Math.min(1, star.alpha));
        ctx.globalAlpha = star.alpha;
        ctx.beginPath();
        ctx.arc(star.x * w, star.y * h, star.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      const fov = 500 * currentSettings.scale;
      const cameraY = 250;
      const cameraZ = -100;

      const getProj = (x: number, y: number) => {
        const worldX = (x - cols/2) * cellSize;
        const worldZ = y * cellSize - zOffset - cameraZ;
        const worldY = cameraY - heights[y][x];
        return project(worldX, worldY, worldZ, fov, w, h);
      };

      const drawTriangle = (p1: any, p2: any, p3: any, strokeColor: string, fillColor: string) => {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.strokeStyle = strokeColor;
        ctx.stroke();
      };

      // Draw horizon glow
      const horizonY = h/2 + cameraY * (fov / (rows * cellSize));
      const gradient = ctx.createLinearGradient(0, horizonY - 150, 0, horizonY + 50);
      gradient.addColorStop(0, 'rgba(255, 0, 255, 0)');
      gradient.addColorStop(0.8, `hsla(${300 + currentSettings.hueShift}, 100%, 60%, 0.3)`);
      gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, horizonY - 150, w, 200);

      ctx.lineWidth = 1.5 * currentSettings.scale;
      ctx.lineJoin = 'round';

      // Draw grid back to front (Painter's algorithm)
      for (let y = rows - 2; y >= 0; y--) {
        for (let x = 0; x < cols - 1; x++) {
          const p00 = getProj(x, y);
          const p10 = getProj(x + 1, y);
          const p01 = getProj(x, y + 1);
          const p11 = getProj(x + 1, y + 1);

          if (p00 && p10 && p01 && p11) {
            const dist = Math.abs((x + 0.5) - cols/2) / (cols/2);
            // Center is magenta (300), edges are cyan (180)
            const baseHue = 300 - dist * 120;
            const hue = (baseHue + currentSettings.hueShift) % 360;

            // Fade out in the distance
            const zDist = y / rows;
            const alpha = 1 - Math.pow(zDist, 2);

            const strokeColor = `hsla(${hue}, 100%, 60%, ${alpha})`;
            const fillColor = '#020205'; // Match background to hide lines behind

            // Split quad into two triangles
            drawTriangle(p00, p10, p01, strokeColor, fillColor);
            drawTriangle(p10, p11, p01, strokeColor, fillColor);
          }
        }
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
