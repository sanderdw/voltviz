import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function SheetMusic({ stream, settings }: Props) {
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

    // Game state
    const notes: { id: number, lineIndex: number, staff: 'left' | 'right', z: number, baseHue: number, arcTo?: number }[] = [];
    let noteIdCounter = 0;
    const lastNoteOnLine: Record<string, number> = {};

    const leftStaffOffsets = [-1, -0.75, -0.5, -0.25, -0.05];
    const rightStaffOffsets = [0.05, 0.25, 0.5, 0.75, 1];
    const maxZ = 2600;
    const baseSpeed = 12;

    const project = (x: number, y: number, z: number, w: number, horizonY: number) => {
      const fov = 600;
      if (z < -fov + 10) return null;
      const scale = fov / (fov + z);
      return {
        x: x * scale + w / 2,
        y: y * scale + horizonY,
        scale
      };
    };

    let lastSpawnTime = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      const safeScale = Math.max(currentSettings.scale, 0.1);
      const horizonY = h * 0.08;
      const groundY = (h * 0.95 - horizonY) / safeScale;
      const laneSpread = (w * 0.48) / safeScale;
      const leftStaffX = leftStaffOffsets.map(offset => offset * laneSpread);
      const rightStaffX = rightStaffOffsets.map(offset => offset * laneSpread);

      analyser.getByteFrequencyData(dataArray);

      // Clear with dark gradient
      const bgGradient = ctx.createLinearGradient(0, 0, 0, h);
      bgGradient.addColorStop(0, '#050505');
      bgGradient.addColorStop(1, '#1a1a24');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, w, h);

      // Draw floor reflection/glow across the full viewport.
      const floorGradient = ctx.createLinearGradient(0, 0, 0, h);
      floorGradient.addColorStop(0, 'rgba(255,255,255,0.01)');
      floorGradient.addColorStop(0.35, 'rgba(255,255,255,0.015)');
      floorGradient.addColorStop(1, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = floorGradient;
      ctx.fillRect(0, 0, w, h);

      // Draw staves
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 2 * currentSettings.scale;

      const drawLine = (x: number) => {
        ctx.beginPath();
        for (let z = 0; z <= maxZ; z += 100) {
          const p = project(x * currentSettings.scale, groundY * currentSettings.scale, z, w, horizonY);
          if (!p) continue;
          if (z === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      };

      leftStaffX.forEach(drawLine);
      rightStaffX.forEach(drawLine);

      // Draw horizontal bar lines moving towards us
      const timeOffset = (Date.now() * 0.05 * currentSettings.speed) % 400;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1 * currentSettings.scale;
      for (let z = timeOffset; z <= maxZ; z += 400) {
        ctx.beginPath();
        const pL1 = project(leftStaffX[0] * currentSettings.scale, groundY * currentSettings.scale, z, w, horizonY);
        const pL2 = project(leftStaffX[4] * currentSettings.scale, groundY * currentSettings.scale, z, w, horizonY);
        if (pL1 && pL2) {
          ctx.moveTo(pL1.x, pL1.y);
          ctx.lineTo(pL2.x, pL2.y);
        }
        const pR1 = project(rightStaffX[0] * currentSettings.scale, groundY * currentSettings.scale, z, w, horizonY);
        const pR2 = project(rightStaffX[4] * currentSettings.scale, groundY * currentSettings.scale, z, w, horizonY);
        if (pR1 && pR2) {
          ctx.moveTo(pR1.x, pR1.y);
          ctx.lineTo(pR2.x, pR2.y);
        }
        ctx.stroke();
      }

      // Spawn notes based on balanced bass/mid/treble energy.
      const now = Date.now();
      if (now - lastSpawnTime > 80) {
        const bassStart = 1;
        const bassEnd = Math.max(bassStart + 1, Math.floor(bufferLength * 0.16));
        const midEnd = Math.max(bassEnd + 1, Math.floor(bufferLength * 0.58));
        const trebleEnd = bufferLength;

        const avgRange = (start: number, end: number) => {
          const clampedStart = Math.max(0, Math.min(start, bufferLength - 1));
          const clampedEnd = Math.max(clampedStart + 1, Math.min(end, bufferLength));
          let sum = 0;
          for (let i = clampedStart; i < clampedEnd; i++) sum += dataArray[i];
          return sum / (clampedEnd - clampedStart);
        };

        const bassNorm = avgRange(bassStart, bassEnd) / 255;
        const midNorm = avgRange(bassEnd, midEnd) / 255;
        const trebleNorm = avgRange(midEnd, trebleEnd) / 255;

        const sampleBand = (band: 'bass' | 'mid' | 'treble', t: number) => {
          let start = bassStart;
          let end = bassEnd;
          if (band === 'mid') {
            start = bassEnd;
            end = midEnd;
          } else if (band === 'treble') {
            start = midEnd;
            end = trebleEnd;
          }
          const span = Math.max(1, end - start);
          const idx = Math.min(end - 1, start + Math.floor(t * span));
          return dataArray[Math.max(0, Math.min(idx, bufferLength - 1))];
        };

        for (let i = 0; i < 10; i++) {
          const staff = i < 5 ? 'left' : 'right';
          const lineIndex = i < 5 ? i : i - 5;

          const band: 'bass' | 'mid' | 'treble' = lineIndex <= 1 ? 'bass' : lineIndex <= 3 ? 'mid' : 'treble';
          const laneT = lineIndex <= 1
            ? lineIndex / 1
            : lineIndex <= 3
              ? (lineIndex - 2) / 1
              : 0.5;

          const value = sampleBand(band, laneT);
          const bandNorm = band === 'bass' ? bassNorm : band === 'mid' ? midNorm : trebleNorm;
          const bandBoost = band === 'bass' ? 1.3 : band === 'mid' ? 1.05 : 1.25;
          const gateBase = band === 'bass' ? 138 : band === 'mid' ? 124 : 112;
          const gate = gateBase - bandNorm * 38;

          if (value * currentSettings.sensitivity * bandBoost > gate + Math.random() * 42) {
            const baseHue = band === 'bass' ? 18 : band === 'mid' ? 142 : 218;

            const id = noteIdCounter++;
            const key = `${staff}-${lineIndex}`;
            const lastId = lastNoteOnLine[key];

            let arcTo = undefined;
            if (lastId !== undefined && Math.random() > 0.2) {
               const lastNote = notes.find(n => n.id === lastId);
               if (lastNote && lastNote.z > maxZ - 1000) {
                 arcTo = lastId;
               }
            }

            notes.push({ id, lineIndex, staff, z: maxZ, baseHue, arcTo });
            lastNoteOnLine[key] = id;
            lastSpawnTime = now;
          }
        }
      }

      // Draw arcs
      ctx.lineCap = 'round';
      notes.forEach(note => {
        if (note.arcTo !== undefined) {
          const target = notes.find(n => n.id === note.arcTo);
          if (target) {
            const x = note.staff === 'left' ? leftStaffX[note.lineIndex] : rightStaffX[note.lineIndex];
            const p1 = project(x * currentSettings.scale, groundY * currentSettings.scale, note.z, w, horizonY);
            const p2 = project(x * currentSettings.scale, groundY * currentSettings.scale, target.z, w, horizonY);

            if (p1 && p2) {
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              const midZ = (note.z + target.z) / 2;
              const arcHeight = Math.min(200, Math.abs(note.z - target.z) * 0.5);
              const midP = project(x * currentSettings.scale, (groundY - arcHeight) * currentSettings.scale, midZ, w, horizonY);
              if (midP) {
                const color = `hsl(${(note.baseHue + currentSettings.hueShift) % 360}, 100%, 65%)`;
                ctx.quadraticCurveTo(midP.x, midP.y, p2.x, p2.y);
                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(1, 4 * p1.scale) * currentSettings.scale;
                ctx.shadowBlur = 15 * currentSettings.scale;
                ctx.shadowColor = color;
                ctx.stroke();
                ctx.shadowBlur = 0;
              }
            }
          }
        }
      });

      // Draw notes
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];
        note.z -= baseSpeed * currentSettings.speed;

        if (note.z < -200) {
          notes.splice(i, 1);
          continue;
        }

        const x = note.staff === 'left' ? leftStaffX[note.lineIndex] : rightStaffX[note.lineIndex];
  const p = project(x * currentSettings.scale, groundY * currentSettings.scale, note.z, w, horizonY);

        if (p) {
          const radiusX = 24 * p.scale * currentSettings.scale;
          const radiusY = 10 * p.scale * currentSettings.scale;
          const color = `hsl(${(note.baseHue + currentSettings.hueShift) % 360}, 100%, 65%)`;

          ctx.beginPath();
          ctx.ellipse(p.x, p.y, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.shadowBlur = 25 * p.scale * currentSettings.scale;
          ctx.shadowColor = color;
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(p.x, p.y, radiusX * 0.5, radiusY * 0.5, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 0;
          ctx.fill();
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
