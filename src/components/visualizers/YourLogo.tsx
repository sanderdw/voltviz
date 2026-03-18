import React, { useEffect, useRef, useState } from 'react';
import { VisualizerSettings } from '../../types';
import { Upload, Eye, EyeOff, Palette } from 'lucide-react';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function YourLogo({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const audioCtxRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const sourceRef = useRef<MediaStreamAudioSourceNode>();
  const settingsRef = useRef(settings);
  const activeCopiesRef = useRef<Map<number, { dir: number, freqBin: number }>>(new Map());

  const [svgPaths, setSvgPaths] = useState<{ path: number[][], color: string | null }[] | null>(null);
  const [useOriginalColors, setUseOriginalColors] = useState(false);
  const [showUI, setShowUI] = useState(true);

  const useOriginalColorsRef = useRef(useOriginalColors);

  useEffect(() => {
    useOriginalColorsRef.current = useOriginalColors;
  }, [useOriginalColors]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const svgString = event.target?.result as string;
      parseSVG(svgString);
    };
    reader.readAsText(file);
  };

  const parseSVG = (svgString: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const elements = Array.from(doc.querySelectorAll('path, circle, rect, polygon, polyline, line, ellipse'));

    const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // We need to append it to the document to use getPointAtLength in some browsers
    svgContainer.style.position = 'absolute';
    svgContainer.style.visibility = 'hidden';
    svgContainer.style.width = '0';
    svgContainer.style.height = '0';
    document.body.appendChild(svgContainer);

    const parsedPaths: { path: number[][], color: string | null }[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    elements.forEach(el => {
      const clone = el.cloneNode() as any;
      svgContainer.appendChild(clone);
      try {
        if (typeof clone.getTotalLength === 'function') {
          const length = clone.getTotalLength();
          if (length === 0) return;

          // Try to get original color
          let color = null;
          const style = window.getComputedStyle(clone);
          if (style.stroke && style.stroke !== 'none' && style.stroke !== 'rgba(0, 0, 0, 0)') {
            color = style.stroke;
          } else if (style.fill && style.fill !== 'none' && style.fill !== 'rgba(0, 0, 0, 0)') {
            color = style.fill;
          } else if (clone.getAttribute('stroke')) {
            color = clone.getAttribute('stroke');
          } else if (clone.getAttribute('fill')) {
            color = clone.getAttribute('fill');
          }

          const numPoints = Math.min(3000, Math.max(300, Math.floor(length)));
          const arcLength = length / numPoints;
          let currentSubPath: number[][] = [];
          let prevPt: DOMPoint | null = null;

          for (let i = 0; i <= numPoints; i++) {
            const pt = clone.getPointAtLength((i / numPoints) * length);

            if (prevPt) {
              const dist = Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
              // If the straight-line distance is significantly larger than the arc length,
              // it means there was a jump (e.g., an 'M' command) in the path.
              if (dist > arcLength * 1.5 + 0.1) {
                if (currentSubPath.length > 0) {
                  parsedPaths.push({ path: currentSubPath, color });
                  currentSubPath = [];
                }
              }
            }

            currentSubPath.push([pt.x, pt.y, 0]);
            prevPt = pt;

            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y);
            maxY = Math.max(maxY, pt.y);
          }
          if (currentSubPath.length > 0) {
            parsedPaths.push({ path: currentSubPath, color });
          }
        }
      } catch (e) {
        // Ignore elements that fail
      }
    });

    document.body.removeChild(svgContainer);

    if (parsedPaths.length > 0) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const scale = Math.max(maxX - minX, maxY - minY) / 2 || 1;

      const normalizedPaths = parsedPaths.map(item => ({
        path: item.path.map(p => [
          (p[0] - cx) / scale,
          (p[1] - cy) / scale,
          0 // Keep lines flat
        ]),
        color: item.color
      }));

      activeCopiesRef.current.clear();
      setSvgPaths(normalizedPaths);
    }
  };

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !svgPaths) return;

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

    // Particles
    const particles: { x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, maxLife: number, color: string }[] = [];

    let time = 0;
    let lastBass = 0;

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

      // Beat detection for switching 3D copies (triggers on rising edge of a bass hit)
      const isBeat = bass > 180 && bass > lastBass + 10;

      if (isBeat || activeCopiesRef.current.size === 0) {
        const closedIndices: number[] = [];
        svgPaths.forEach((item, idx) => {
          const path = item.path;
          if (path.length > 2) {
            const first = path[0];
            const last = path[path.length - 1];
            if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05) {
              closedIndices.push(idx);
            }
          }
        });

        closedIndices.sort(() => Math.random() - 0.5);
        const numToPick = Math.max(1, Math.floor(closedIndices.length * 0.75));

        const newActive = new Map<number, { dir: number, freqBin: number }>();
        closedIndices.slice(0, numToPick).forEach(idx => {
          newActive.set(idx, {
            dir: Math.random() > 0.5 ? 1 : -1,
            freqBin: Math.floor(Math.random() * 100) // Bass to mid range for more pronounced movement
          });
        });
        activeCopiesRef.current = newActive;
      }

      lastBass = bass;

      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.3 * currentSettings.scale;
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

      // Spawn particles from active subpaths
      if (treble * currentSettings.sensitivity > 80 && Math.random() > 0.3) {
        const activeIndices = Array.from(activeCopiesRef.current.keys());
        if (activeIndices.length > 0) {
          for (let i = 0; i < 8; i++) {
            const randomPathIdx = activeIndices[Math.floor(Math.random() * activeIndices.length)];
            const randomPathItem = svgPaths[randomPathIdx];
            if (!randomPathItem) continue;

            const randomPath = randomPathItem.path;
            const activeData = activeCopiesRef.current.get(randomPathIdx);

            if (randomPath && randomPath.length > 0 && activeData) {
              const v = randomPath[Math.floor(Math.random() * randomPath.length)];
              const speed = 2 + Math.random() * 8 * currentSettings.speed * (treble/255);

              const freqVal = dataArray[activeData.freqBin] / 255;
              const individualZOffset = freqVal * 200 * currentSettings.sensitivity * activeData.dir;

              // Random directions for 3D effect
              const vx = (Math.random() - 0.5) * speed * 2;
              const vy = (Math.random() - 0.5) * speed * 2;
              const vz = (Math.random() - 0.5) * speed * 2;

              let particleColor = Math.random() > 0.5 ? `hsla(${180 + currentSettings.hueShift}, 100%, 60%, 1)` : `hsla(${300 + currentSettings.hueShift}, 100%, 60%, 1)`;
              if (useOriginalColorsRef.current && randomPathItem.color) {
                particleColor = randomPathItem.color;
              }

              particles.push({
                x: v[0] * radius,
                y: v[1] * radius,
                z: v[2] * radius + individualZOffset,
                vx: vx,
                vy: vy,
                vz: vz,
                life: 1,
                maxLife: 0.5 + Math.random() * 1,
                color: particleColor
              });
            }
          }
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

      // Prepare SVG paths for drawing (original and 3D copy)
      const drawItems: { type: 'original' | 'copy', pathIdx: number, path: number[][], z: number, isClosed: boolean, zOffset?: number, originalColor: string | null }[] = [];

      svgPaths.forEach((item, pathIdx) => {
        const path = item.path;
        if (path.length === 0) return;

        // Check if path is closed (first and last point are very close)
        const first = path[0];
        const last = path[path.length - 1];
        const isClosed = path.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05;

        // Calculate average Z for original path
        let sumZOrig = 0;
        for (let i = 0; i < path.length; i++) {
          const [, , rz] = rotate(path[i][0] * radius, path[i][1] * radius, path[i][2] * radius);
          sumZOrig += rz;
        }
        drawItems.push({ type: 'original', pathIdx, path, z: sumZOrig / path.length, isClosed, originalColor: item.color });

        // If closed and selected for 3D copy, add a copy pushed out in depth
        const activeData = activeCopiesRef.current.get(pathIdx);
        if (isClosed && activeData) {
          const freqVal = dataArray[activeData.freqBin] / 255;
          const individualZOffset = freqVal * 200 * currentSettings.sensitivity * activeData.dir;

          let sumZCopy = 0;
          for (let i = 0; i < path.length; i++) {
            const [, , rz] = rotate(path[i][0] * radius, path[i][1] * radius, path[i][2] * radius + individualZOffset);
            sumZCopy += rz;
          }
          drawItems.push({ type: 'copy', pathIdx, path, z: sumZCopy / path.length, isClosed, zOffset: individualZOffset, originalColor: item.color });
        }
      });

      // Sort items back-to-front
      drawItems.sort((a, b) => b.z - a.z);

      // Draw items
      drawItems.forEach(item => {
        ctx.beginPath();

        for (let i = 0; i < item.path.length; i++) {
          const v = item.path[i];
          const px = v[0];
          const py = v[1];
          const pz = v[2];

          const [rx, ry, rz] = rotate(px * radius, py * radius, pz * radius + (item.zOffset || 0));
          const scale = 500 / (500 + rz);
          const screenX = cx + rx * scale;
          const screenY = cy + ry * scale;

          if (i === 0) {
            ctx.moveTo(screenX, screenY);
          } else {
            ctx.lineTo(screenX, screenY);
          }
        }

        if (item.isClosed) {
          ctx.closePath();
        }

        const hue = item.pathIdx % 2 === 0 ? 180 : 300;
        const finalHue = (hue + currentSettings.hueShift) % 360;

        if (item.type === 'copy') {
          if (useOriginalColorsRef.current && item.originalColor) {
            ctx.fillStyle = item.originalColor;
            ctx.globalAlpha = 0.15;
            ctx.fill();
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = item.originalColor;
            ctx.lineWidth = 1 * currentSettings.scale;
            ctx.shadowBlur = 0;
            ctx.stroke();
          } else {
            ctx.fillStyle = `hsla(${finalHue}, 100%, 60%, 0.15)`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${finalHue}, 100%, 60%, 0.4)`;
            ctx.lineWidth = 1 * currentSettings.scale;
            ctx.shadowBlur = 0;
            ctx.stroke();
          }
        } else {
          const pulse = bass / 255;
          if (useOriginalColorsRef.current && item.originalColor) {
            ctx.strokeStyle = item.originalColor;
            ctx.lineWidth = (2 + pulse * 4) * currentSettings.scale;
            ctx.shadowBlur = (10 + pulse * 60 * currentSettings.sensitivity) * currentSettings.scale;
            ctx.shadowColor = item.originalColor;
            ctx.stroke();
            ctx.shadowBlur = 0;
          } else {
            ctx.strokeStyle = `hsla(${finalHue}, 100%, 60%, 0.8)`;
            ctx.lineWidth = (2 + pulse * 4) * currentSettings.scale;
            ctx.shadowBlur = (10 + pulse * 60 * currentSettings.sensitivity) * currentSettings.scale;
            ctx.shadowColor = `hsla(${finalHue}, 100%, ${50 + pulse * 30}%, ${0.6 + pulse * 0.4})`;
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
        }
      });

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
  }, [stream, svgPaths]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {!svgPaths && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50 backdrop-blur-sm">
          <label className="flex flex-col items-center justify-center w-64 h-64 border-2 border-dashed border-purple-500/50 rounded-2xl cursor-pointer hover:bg-purple-500/10 transition-colors">
            <Upload className="w-12 h-12 text-purple-400 mb-4" />
            <span className="text-white/80 font-medium">Upload SVG File</span>
            <span className="text-white/50 text-sm mt-2">to create custom visualizer</span>
            <input
              type="file"
              accept=".svg"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>
      )}
      <canvas ref={canvasRef} className="w-full h-full block" />

      {svgPaths && (
        <div className="absolute bottom-6 right-6 flex items-center gap-3 z-10">
          {showUI && (
            <>
              <button
                onClick={() => setUseOriginalColors(!useOriginalColors)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  useOriginalColors
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50'
                    : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                }`}
              >
                <Palette className="w-4 h-4" />
                {useOriginalColors ? 'Original Colors' : 'Neon Colors'}
              </button>

              <label className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer transition-colors">
                <Upload className="w-4 h-4" />
                Change SVG
                <input
                  type="file"
                  accept=".svg"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            </>
          )}

          <button
            onClick={() => setShowUI(!showUI)}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition-colors"
            title={showUI ? "Hide UI" : "Show UI"}
          >
            {showUI ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
