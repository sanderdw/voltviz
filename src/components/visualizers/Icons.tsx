import { useEffect, useRef, useState, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VisualizerSettings } from '../../types';
import type { LucideIcon } from 'lucide-react';
import {
  Shuffle, Eye, EyeOff,
  Heart, Star, Music, Zap, Flame, Crown, Diamond, Skull, Ghost,
  Rocket, Atom, Brain, Bug, Camera, Cloud, Coffee, Compass, Crosshair,
  Flower2, Gamepad2, Globe, Headphones, Hexagon, Key, Leaf, Moon,
  Shield, Snowflake, Sun, Target, TreePine, Umbrella, Wind, Aperture,
  Fingerprint, Anchor, Bell, Bookmark, Fish
} from 'lucide-react';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const ICON_POOL: [string, LucideIcon][] = [
  ['Heart', Heart], ['Star', Star], ['Music', Music], ['Zap', Zap],
  ['Flame', Flame], ['Crown', Crown], ['Diamond', Diamond], ['Skull', Skull],
  ['Ghost', Ghost], ['Rocket', Rocket], ['Atom', Atom], ['Brain', Brain],
  ['Bug', Bug], ['Camera', Camera], ['Cloud', Cloud], ['Coffee', Coffee],
  ['Compass', Compass], ['Crosshair', Crosshair], ['Flower', Flower2],
  ['Gamepad', Gamepad2], ['Globe', Globe], ['Headphones', Headphones],
  ['Hexagon', Hexagon], ['Key', Key], ['Leaf', Leaf], ['Moon', Moon],
  ['Shield', Shield], ['Snowflake', Snowflake], ['Sun', Sun], ['Target', Target],
  ['Tree', TreePine], ['Umbrella', Umbrella], ['Wind', Wind], ['Aperture', Aperture],
  ['Fingerprint', Fingerprint], ['Anchor', Anchor], ['Bell', Bell],
  ['Bookmark', Bookmark], ['Eye', Eye], ['Fish', Fish],
];

type ParsedPath = { path: number[][]; color: null };

function parseSVGString(svgString: string): ParsedPath[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const elements = Array.from(doc.querySelectorAll('path, circle, rect, polygon, polyline, line, ellipse'));

  const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgContainer.style.position = 'absolute';
  svgContainer.style.visibility = 'hidden';
  svgContainer.style.width = '0';
  svgContainer.style.height = '0';
  document.body.appendChild(svgContainer);

  const parsedPaths: ParsedPath[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  elements.forEach(el => {
    const clone = el.cloneNode() as SVGGeometryElement;
    svgContainer.appendChild(clone);
    try {
      if (typeof clone.getTotalLength === 'function') {
        const length = clone.getTotalLength();
        if (length === 0) return;

        const numPoints = Math.min(3000, Math.max(300, Math.floor(length)));
        const arcLength = length / numPoints;
        let currentSubPath: number[][] = [];
        let prevPt: DOMPoint | null = null;

        for (let i = 0; i <= numPoints; i++) {
          const pt = clone.getPointAtLength((i / numPoints) * length);

          if (prevPt) {
            const dist = Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
            if (dist > arcLength * 1.5 + 0.1) {
              if (currentSubPath.length > 0) {
                parsedPaths.push({ path: currentSubPath, color: null });
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
          parsedPaths.push({ path: currentSubPath, color: null });
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

    return parsedPaths.map(item => ({
      path: item.path.map(p => [
        (p[0] - cx) / scale,
        (p[1] - cy) / scale,
        0,
      ]),
      color: null,
    }));
  }

  return [];
}

export default function Icons({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);
  const activeCopiesRef = useRef<Map<number, { dir: number; freqBin: number }>>(new Map());

  const allIconDataRef = useRef<Map<string, ParsedPath[]>>(new Map());
  const currentPathsRef = useRef<ParsedPath[]>([]);
  const lastSwitchTimeRef = useRef(0);

  const [currentIconName, setCurrentIconName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [showUI, setShowUI] = useState(true);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Parse all icons on mount
  useEffect(() => {
    const parsed = new Map<string, ParsedPath[]>();
    ICON_POOL.forEach(([name, component]) => {
      const svgString = renderToStaticMarkup(createElement(component));
      const paths = parseSVGString(svgString);
      if (paths.length > 0) parsed.set(name, paths);
    });
    allIconDataRef.current = parsed;

    const names = Array.from(parsed.keys());
    if (names.length > 0) {
      const initial = names[Math.floor(Math.random() * names.length)];
      currentPathsRef.current = parsed.get(initial) || [];
      setCurrentIconName(initial);
    }
    setReady(true);
  }, []);

  const shuffleIcon = () => {
    const names = Array.from(allIconDataRef.current.keys());
    if (names.length === 0) return;
    let next = names[Math.floor(Math.random() * names.length)];
    if (names.length > 1) {
      while (next === currentIconName) {
        next = names[Math.floor(Math.random() * names.length)];
      }
    }
    currentPathsRef.current = allIconDataRef.current.get(next) || [];
    activeCopiesRef.current.clear();
    setCurrentIconName(next);
    lastSwitchTimeRef.current = performance.now();
  };

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !ready || currentPathsRef.current.length === 0) return;

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

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    const particles: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; maxLife: number; color: string }[] = [];

    let time = 0;
    let lastBass = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      let svgPaths = currentPathsRef.current;
      time += 0.01 * currentSettings.speed;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const treble = dataArray.slice(50, 150).reduce((a, b) => a + b, 0) / 100;

      const isBeat = bass > 180 && bass > lastBass + 10;

      // Switch icon on strong beat (min 4s interval)
      if (isBeat && performance.now() - lastSwitchTimeRef.current > 4000) {
        const names = Array.from(allIconDataRef.current.keys());
        if (names.length > 1) {
          const next = names[Math.floor(Math.random() * names.length)];
          currentPathsRef.current = allIconDataRef.current.get(next) || currentPathsRef.current;
          svgPaths = currentPathsRef.current;
          activeCopiesRef.current.clear();
          lastSwitchTimeRef.current = performance.now();
          setCurrentIconName(next);
        }
      }

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

        const newActive = new Map<number, { dir: number; freqBin: number }>();
        closedIndices.slice(0, numToPick).forEach(idx => {
          newActive.set(idx, {
            dir: Math.random() > 0.5 ? 1 : -1,
            freqBin: Math.floor(Math.random() * 100),
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

      const rotX = time * 0.5;
      const rotY = time * 0.7;

      const rotate = (x: number, y: number, z: number): [number, number, number] => {
        const y1 = y * Math.cos(rotX) - z * Math.sin(rotX);
        const z1 = y * Math.sin(rotX) + z * Math.cos(rotX);
        const x2 = x * Math.cos(rotY) + z1 * Math.sin(rotY);
        const z2 = -x * Math.sin(rotY) + z1 * Math.cos(rotY);
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
              const speed = 2 + Math.random() * 8 * currentSettings.speed * (treble / 255);

              const freqVal = dataArray[activeData.freqBin] / 255;
              const individualZOffset = freqVal * 200 * currentSettings.sensitivity * activeData.dir;

              const vx = (Math.random() - 0.5) * speed * 2;
              const vy = (Math.random() - 0.5) * speed * 2;
              const vz = (Math.random() - 0.5) * speed * 2;

              const particleColor = Math.random() > 0.5
                ? `hsla(${180 + currentSettings.hueShift}, 100%, 60%, 1)`
                : `hsla(${300 + currentSettings.hueShift}, 100%, 60%, 1)`;

              particles.push({
                x: v[0] * radius,
                y: v[1] * radius,
                z: v[2] * radius + individualZOffset,
                vx, vy, vz,
                life: 1,
                maxLife: 0.5 + Math.random() * 1,
                color: particleColor,
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

      // Prepare SVG paths for drawing
      const drawItems: { type: 'original' | 'copy'; pathIdx: number; path: number[][]; z: number; isClosed: boolean; zOffset?: number }[] = [];

      svgPaths.forEach((item, pathIdx) => {
        const path = item.path;
        if (path.length === 0) return;

        const first = path[0];
        const last = path[path.length - 1];
        const isClosed = path.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05;

        let sumZOrig = 0;
        for (let i = 0; i < path.length; i++) {
          const [, , rz] = rotate(path[i][0] * radius, path[i][1] * radius, path[i][2] * radius);
          sumZOrig += rz;
        }
        drawItems.push({ type: 'original', pathIdx, path, z: sumZOrig / path.length, isClosed });

        const activeData = activeCopiesRef.current.get(pathIdx);
        if (isClosed && activeData) {
          const freqVal = dataArray[activeData.freqBin] / 255;
          const individualZOffset = freqVal * 200 * currentSettings.sensitivity * activeData.dir;

          let sumZCopy = 0;
          for (let i = 0; i < path.length; i++) {
            const [, , rz] = rotate(path[i][0] * radius, path[i][1] * radius, path[i][2] * radius + individualZOffset);
            sumZCopy += rz;
          }
          drawItems.push({ type: 'copy', pathIdx, path, z: sumZCopy / path.length, isClosed, zOffset: individualZOffset });
        }
      });

      // Sort items back-to-front
      drawItems.sort((a, b) => b.z - a.z);

      // Draw items
      drawItems.forEach(item => {
        ctx.beginPath();

        for (let i = 0; i < item.path.length; i++) {
          const v = item.path[i];
          const [rx, ry, rz] = rotate(v[0] * radius, v[1] * radius, v[2] * radius + (item.zOffset || 0));
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
          ctx.fillStyle = `hsla(${finalHue}, 100%, 60%, 0.15)`;
          ctx.fill();
          ctx.strokeStyle = `hsla(${finalHue}, 100%, 60%, 0.4)`;
          ctx.lineWidth = 1 * currentSettings.scale;
          ctx.shadowBlur = 0;
          ctx.stroke();
        } else {
          const pulse = bass / 255;
          ctx.strokeStyle = `hsla(${finalHue}, 100%, 60%, 0.8)`;
          ctx.lineWidth = (2 + pulse * 4) * currentSettings.scale;
          ctx.shadowBlur = (10 + pulse * 60 * currentSettings.sensitivity) * currentSettings.scale;
          ctx.shadowColor = `hsla(${finalHue}, 100%, ${50 + pulse * 30}%, ${0.6 + pulse * 0.4})`;
          ctx.stroke();
          ctx.shadowBlur = 0;
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
  }, [stream, ready]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {ready && (
        <div className="absolute bottom-6 right-6 flex items-center gap-3 z-10">
          {showUI && (
            <>
              {currentIconName && (
                <span className="px-3 py-2 bg-white/10 border border-white/20 rounded-full text-sm text-white/70">
                  {currentIconName}
                </span>
              )}

              <button
                onClick={shuffleIcon}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer transition-colors"
              >
                <Shuffle className="w-4 h-4" />
                Shuffle
              </button>
            </>
          )}

          <button
            onClick={() => setShowUI(!showUI)}
            className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition-colors"
            title={showUI ? 'Hide UI' : 'Show UI'}
          >
            {showUI ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
