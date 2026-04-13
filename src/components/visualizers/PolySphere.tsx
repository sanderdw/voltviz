import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function PolySphere({ stream, settings }: Props) {
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

    // Geometry generation
    const phi = (1 + Math.sqrt(5)) / 2;
    let vertices = [
      [-1,  phi,  0], [ 1,  phi,  0], [-1, -phi,  0], [ 1, -phi,  0],
      [ 0, -1,  phi], [ 0,  1,  phi], [ 0, -1, -phi], [ 0,  1, -phi],
      [ phi,  0, -1], [ phi,  0,  1], [-phi,  0, -1], [-phi,  0,  1]
    ];
    vertices = vertices.map(v => {
      const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
      return [v[0]/len, v[1]/len, v[2]/len];
    });

    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];

    function subdivide(verts: number[][], facs: number[][]) {
      const newFaces: number[][] = [];
      const edgeMap = new Map<string, number>();

      function getMidpoint(v1: number, v2: number) {
        const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
        if (edgeMap.has(key)) return edgeMap.get(key)!;

        const p1 = verts[v1];
        const p2 = verts[v2];
        const mid = [
          (p1[0] + p2[0]) / 2,
          (p1[1] + p2[1]) / 2,
          (p1[2] + p2[2]) / 2
        ];
        const len = Math.sqrt(mid[0]*mid[0] + mid[1]*mid[1] + mid[2]*mid[2]);
        verts.push([mid[0]/len, mid[1]/len, mid[2]/len]);
        const index = verts.length - 1;
        edgeMap.set(key, index);
        return index;
      }

      for (const face of facs) {
        const v0 = face[0];
        const v1 = face[1];
        const v2 = face[2];

        const a = getMidpoint(v0, v1);
        const b = getMidpoint(v1, v2);
        const c = getMidpoint(v2, v0);

        newFaces.push([v0, a, c]);
        newFaces.push([v1, b, a]);
        newFaces.push([v2, c, b]);
        newFaces.push([a, b, c]);
      }
      return newFaces;
    }

    faces = subdivide(vertices, faces);
    faces = subdivide(vertices, faces);

    // Face properties
    const faceProps = faces.map(() => ({
      isFilled: Math.random() > 0.85,
      isDetached: Math.random() > 0.8,
      detachOffset: Math.random() * 2,
      colorType: Math.random() > 0.5 ? 'cyan' : 'magenta'
    }));

    // Particles
    const particles: { x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, maxLife: number, color: string }[] = [];

    let time = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      time += 0.01 * currentSettings.speed;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const mid = dataArray.slice(10, 50).reduce((a, b) => a + b, 0) / 40;
      const treble = dataArray.slice(50, 150).reduce((a, b) => a + b, 0) / 100;

      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.25 * currentSettings.scale;
      const radius = baseRadius * (1 + (bass / 255) * 0.3 * currentSettings.sensitivity);

      // Rotation matrices
      const rotX = time * 0.5;
      const rotY = time * 0.7;

      const rotate = (x: number, y: number, z: number) => {
        // Rotate X
        let y1 = y * Math.cos(rotX) - z * Math.sin(rotX);
        let z1 = y * Math.sin(rotX) + z * Math.cos(rotX);
        // Rotate Y
        let x2 = x * Math.cos(rotY) + z1 * Math.sin(rotY);
        let z2 = -x * Math.sin(rotY) + z1 * Math.cos(rotY);
        return [x2, y1, z2];
      };

      // Spawn particles
      if (treble * currentSettings.sensitivity > 80 && Math.random() > 0.3) {
        for (let i = 0; i < 8; i++) {
          const v = vertices[Math.floor(Math.random() * vertices.length)];
          const speed = 2 + Math.random() * 8 * currentSettings.speed * (treble/255);
          particles.push({
            x: v[0] * radius,
            y: v[1] * radius,
            z: v[2] * radius,
            vx: v[0] * speed,
            vy: v[1] * speed,
            vz: v[2] * speed,
            life: 1,
            maxLife: 0.5 + Math.random() * 1,
            color: Math.random() > 0.5 ? `hsla(${180 + currentSettings.hueShift}, 100%, 60%, 1)` : `hsla(${300 + currentSettings.hueShift}, 100%, 60%, 1)`
          });
        }
      }

      // Draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.life -= 0.02 * currentSettings.speed;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        const [rx, ry, rz] = rotate(p.x, p.y, p.z);
        const scale = 500 / (500 + rz);
        const px = cx + rx * scale;
        const py = cy + ry * scale;

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - p.vx * scale * 2, py - p.vy * scale * 2);
        ctx.strokeStyle = p.color.replace('1)', `${p.life / p.maxLife})`);
        ctx.lineWidth = 2 * scale * currentSettings.scale;
        ctx.stroke();
      }

      // Project and sort faces
      const projectedFaces = faces.map((face, i) => {
        const prop = faceProps[i];
        const v0 = vertices[face[0]];
        const v1 = vertices[face[1]];
        const v2 = vertices[face[2]];

        // Center of face
        const fx = (v0[0] + v1[0] + v2[0]) / 3;
        const fy = (v0[1] + v1[1] + v2[1]) / 3;
        const fz = (v0[2] + v1[2] + v2[2]) / 3;

        let offset = 0;
        if (prop.isDetached) {
          offset = prop.detachOffset * (mid / 255) * 50 * currentSettings.sensitivity;
        }

        const p0 = rotate(v0[0] * radius + fx * offset, v0[1] * radius + fy * offset, v0[2] * radius + fz * offset);
        const p1 = rotate(v1[0] * radius + fx * offset, v1[1] * radius + fy * offset, v1[2] * radius + fz * offset);
        const p2 = rotate(v2[0] * radius + fx * offset, v2[1] * radius + fy * offset, v2[2] * radius + fz * offset);

        const centerZ = (p0[2] + p1[2] + p2[2]) / 3;

        return { p0, p1, p2, z: centerZ, prop };
      });

      projectedFaces.sort((a, b) => b.z - a.z);

      // Draw faces
      for (const face of projectedFaces) {
        // Backface culling (simple)
        const isFront = face.z < 0;

        const s0 = 500 / (500 + face.p0[2]);
        const s1 = 500 / (500 + face.p1[2]);
        const s2 = 500 / (500 + face.p2[2]);

        const x0 = cx + face.p0[0] * s0;
        const y0 = cy + face.p0[1] * s0;
        const x1 = cx + face.p1[0] * s1;
        const y1 = cy + face.p1[1] * s1;
        const x2 = cx + face.p2[0] * s2;
        const y2 = cy + face.p2[1] * s2;

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.closePath();

        const hue = face.prop.colorType === 'cyan' ? 180 : 300;
        const finalHue = (hue + currentSettings.hueShift) % 360;

        const alpha = isFront ? 0.8 : 0.15;

        if (face.prop.isFilled && isFront) {
          ctx.fillStyle = `hsla(${finalHue}, 100%, 50%, ${alpha * 0.3})`;
          ctx.fill();
        }

        ctx.strokeStyle = `hsla(${finalHue}, 100%, 60%, ${alpha})`;
        ctx.lineWidth = (isFront ? 1.5 : 0.5) * currentSettings.scale;

        if (isFront && face.prop.isFilled) {
          ctx.shadowBlur = 15 * currentSettings.scale;
          ctx.shadowColor = `hsla(${finalHue}, 100%, 50%, 1)`;
        } else {
          ctx.shadowBlur = 0;
        }

        ctx.stroke();
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
