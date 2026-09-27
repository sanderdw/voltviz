import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Upload, Eye, EyeOff, Palette } from 'lucide-react';
import { beatHit } from '../lib/audio';
import { mountCanvas2D } from '../lib/canvas2d';
import type { OverlayProps, VisualizerFactory } from '../runtime/types';

type YourLogoApi = {
  /** Parses an SVG document; returns true when it produced drawable paths. */
  loadSvg(svgString: string): boolean;
  setUseOriginalColors(value: boolean): void;
};

type LogoPath = { path: number[][], color: string | null };

const YourLogo: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container);
  const canvas = c.canvas;
  const ctx = c.ctx;

  let activeCopies = new Map<number, { dir: number, freqBin: number }>();
  let logoPaths: LogoPath[] | null = null;
  let useOriginalColors = false;

  const parseSVG = (svgString: string): boolean => {
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
      const clone = el.cloneNode() as SVGGeometryElement;
      svgContainer.appendChild(clone);
      try {
        if (typeof clone.getTotalLength === 'function') {
          const length = clone.getTotalLength();
          if (length === 0) return;

          // Try to get original color
          let color: string | null = null;
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
      } catch {
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

      activeCopies.clear();
      logoPaths = normalizedPaths;
      return true;
    }
    return false;
  };

  // Particles
  const particles: { x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, maxLife: number, color: string }[] = [];

  let time = 0;

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    frame({ audio, settings }) {
      // Nothing is drawn until an SVG has been uploaded
      const svgPaths = logoPaths;
      if (!svgPaths) return;
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settings;
      time += 0.01 * currentSettings.speed;

      const dataArray = audio.spectrum({ fftSize: 512, smoothing: 0.8 });

      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const treble = dataArray.slice(50, 150).reduce((a, b) => a + b, 0) / 100;

      // Beat-driven switching of 3D copies: a confident beat, or a raw kick when there is
      // no confident beat
      const isBeat = beatHit(audio);

      if (isBeat || activeCopies.size === 0) {
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
        activeCopies = newActive;
      }

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
        const activeIndices = Array.from(activeCopies.keys());
        if (activeIndices.length > 0) {
          for (let i = 0; i < 8; i++) {
            const randomPathIdx = activeIndices[Math.floor(Math.random() * activeIndices.length)];
            const randomPathItem = svgPaths[randomPathIdx];
            if (!randomPathItem) continue;

            const randomPath = randomPathItem.path;
            const activeData = activeCopies.get(randomPathIdx);

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
              if (useOriginalColors && randomPathItem.color) {
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
        const activeData = activeCopies.get(pathIdx);
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
          if (useOriginalColors && item.originalColor) {
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
          if (useOriginalColors && item.originalColor) {
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
    },
    dispose() {
      particles.length = 0;
      logoPaths = null;
      canvas.remove();
    },
    api: {
      loadSvg: parseSVG,
      setUseOriginalColors: (value: boolean) => { useOriginalColors = value; },
    },
  };
};

export default YourLogo;

export function Overlay({ api }: OverlayProps) {
  const logoApi = api as YourLogoApi | null;
  const [hasSvg, setHasSvg] = useState(false);
  const [useOriginalColors, setUseOriginalColors] = useState(false);
  const [showUI, setShowUI] = useState(true);

  useEffect(() => {
    logoApi?.setUseOriginalColors(useOriginalColors);
  }, [logoApi, useOriginalColors]);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const svgString = event.target?.result as string;
      if (logoApi?.loadSvg(svgString)) setHasSvg(true);
    };
    reader.readAsText(file);
  };

  if (!hasSvg) {
    return (
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
    );
  }

  return (
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
  );
}
