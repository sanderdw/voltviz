import React, { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function SheetMusic({ stream, settings }: Props) {
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

    // Game state
    const notes: { id: number, lineIndex: number, staff: 'left' | 'right', z: number, baseHue: number, arcTo?: number }[] = [];
    let noteIdCounter = 0;
    const lastNoteOnLine: Record<string, number> = {};

    const leftStaffX = [-300, -240, -180, -120, -60];
    const rightStaffX = [60, 120, 180, 240, 300];
    const groundY = 150;
    const maxZ = 2000;
    const baseSpeed = 12;

    const project = (x: number, y: number, z: number, w: number, h: number) => {
      const fov = 600;
      if (z < -fov + 10) return null; 
      const scale = fov / (fov + z);
      return {
        x: x * scale + w / 2,
        y: y * scale + h / 2,
        scale
      };
    };

    let lastSpawnTime = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);

      // Clear with dark gradient
      const bgGradient = ctx.createLinearGradient(0, 0, 0, h);
      bgGradient.addColorStop(0, '#050505');
      bgGradient.addColorStop(1, '#1a1a24');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, w, h);

      // Draw floor reflection/glow
      const floorGradient = ctx.createLinearGradient(0, h/2, 0, h);
      floorGradient.addColorStop(0, 'rgba(255,255,255,0)');
      floorGradient.addColorStop(1, 'rgba(255,255,255,0.03)');
      ctx.fillStyle = floorGradient;
      ctx.fillRect(0, h/2, w, h/2);

      // Draw staves
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 2 * currentSettings.scale;
      
      const drawLine = (x: number) => {
        ctx.beginPath();
        for (let z = 0; z <= maxZ; z += 100) {
          const p = project(x * currentSettings.scale, groundY * currentSettings.scale, z, w, h);
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
        const pL1 = project(leftStaffX[0] * currentSettings.scale, groundY * currentSettings.scale, z, w, h);
        const pL2 = project(leftStaffX[4] * currentSettings.scale, groundY * currentSettings.scale, z, w, h);
        if (pL1 && pL2) {
          ctx.moveTo(pL1.x, pL1.y);
          ctx.lineTo(pL2.x, pL2.y);
        }
        const pR1 = project(rightStaffX[0] * currentSettings.scale, groundY * currentSettings.scale, z, w, h);
        const pR2 = project(rightStaffX[4] * currentSettings.scale, groundY * currentSettings.scale, z, w, h);
        if (pR1 && pR2) {
          ctx.moveTo(pR1.x, pR1.y);
          ctx.lineTo(pR2.x, pR2.y);
        }
        ctx.stroke();
      }

      // Spawn notes based on audio
      const now = Date.now();
      if (now - lastSpawnTime > 80) {
        const step = Math.floor(bufferLength / 24); 
        for (let i = 0; i < 10; i++) {
          const value = dataArray[i * step + 2]; 
          // Apply sensitivity to the spawn threshold
          if (value * currentSettings.sensitivity > 160 + Math.random() * 60) { 
            const staff = i < 5 ? 'left' : 'right';
            const lineIndex = i < 5 ? i : i - 5;
            const baseHue = staff === 'left' ? 12 : 218; // ~#ff6b4a and ~#4a8bff
            
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
            const p1 = project(x * currentSettings.scale, groundY * currentSettings.scale, note.z, w, h);
            const p2 = project(x * currentSettings.scale, groundY * currentSettings.scale, target.z, w, h);
            
            if (p1 && p2) {
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              const midZ = (note.z + target.z) / 2;
              const arcHeight = Math.min(200, Math.abs(note.z - target.z) * 0.5);
              const midP = project(x * currentSettings.scale, (groundY - arcHeight) * currentSettings.scale, midZ, w, h); 
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
        const p = project(x * currentSettings.scale, groundY * currentSettings.scale, note.z, w, h);
        
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
