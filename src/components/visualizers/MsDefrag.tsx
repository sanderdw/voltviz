import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

type CellBase = 'empty' | 'used' | 'bad' | 'unmovable';
type CellTransient = 'reading' | 'writing' | 'optimizing';
type CellState = CellBase | CellTransient;

interface Cell {
  base: CellBase;
  state: CellState;
  timer: number;
}

const TRANSIENT_DURATION: Record<CellTransient, number> = {
  reading: 0.18,
  writing: 0.24,
  optimizing: 0.34,
};

interface Palette {
  bg: string;
  emptyDark: string;
  emptyDot: string;
  used: string;
  reading: string;
  writing: string;
  optimizing: string;
  bad: string;
  unmovable: string;
  border: string;
  text: string;
  textDim: string;
  panelBg: string;
}

const BASE = {
  bg: [0.00, 0.00, 0.66],
  emptyDark: [0.00, 0.00, 0.39],
  emptyDot: [0.00, 0.13, 0.86],
  used: [0.00, 1.00, 1.00],
  reading: [0.10, 1.00, 0.10],
  writing: [1.00, 1.00, 0.10],
  optimizing: [1.00, 0.30, 1.00],
  bad: [1.00, 0.10, 0.10],
  unmovable: [0.62, 0.62, 0.62],
  border: [1.00, 1.00, 1.00],
  text: [1.00, 1.00, 1.00],
  textDim: [0.70, 0.70, 0.70],
  panelBg: [0.00, 0.00, 0.31],
} as const;

function rotateHue(r: number, g: number, b: number, deg: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360) % 1;
  if (h < 0) h += 1;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [conv(h + 1 / 3), conv(h), conv(h - 1 / 3)];
}

function rgbStr(rgb: readonly number[], hue: number): string {
  const [r, g, b] = hue === 0 ? rgb : rotateHue(rgb[0], rgb[1], rgb[2], hue);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function makePalette(hue: number): Palette {
  return {
    bg: rgbStr(BASE.bg, hue),
    emptyDark: rgbStr(BASE.emptyDark, hue),
    emptyDot: rgbStr(BASE.emptyDot, hue),
    used: rgbStr(BASE.used, hue),
    reading: rgbStr(BASE.reading, hue),
    writing: rgbStr(BASE.writing, hue),
    optimizing: rgbStr(BASE.optimizing, hue),
    bad: rgbStr(BASE.bad, hue),
    unmovable: rgbStr(BASE.unmovable, hue),
    border: rgbStr(BASE.border, hue),
    text: rgbStr(BASE.text, hue),
    textDim: rgbStr(BASE.textDim, hue),
    panelBg: rgbStr(BASE.panelBg, hue),
  };
}

export default function MsDefrag({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // --- Audio ---
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    let sBass = 0;
    let sMid = 0;
    let sTreble = 0;
    let sEnergy = 0;
    let bassPrev = 0;

    // --- Pattern for empty cells (rebuilt on hue change) ---
    const patCanvas = document.createElement('canvas');
    patCanvas.width = 4;
    patCanvas.height = 4;
    const patCtx = patCanvas.getContext('2d')!;

    let palette = makePalette(0);
    let emptyPattern: CanvasPattern | null = null;
    let lastHue = NaN;

    const ensurePalette = (hue: number) => {
      if (hue === lastHue) return;
      lastHue = hue;
      palette = makePalette(hue);
      patCtx.fillStyle = palette.emptyDark;
      patCtx.fillRect(0, 0, 4, 4);
      patCtx.fillStyle = palette.emptyDot;
      patCtx.fillRect(0, 0, 1, 1);
      patCtx.fillRect(2, 2, 1, 1);
      emptyPattern = ctx.createPattern(patCanvas, 'repeat');
    };

    // --- Layout ---
    const PAD = 28;
    const HEADER_H = 44;
    const LEGEND_H = 28;
    const STATUS_H = 38;

    let cells: Cell[] = [];
    let cols = 0;
    let rows = 0;
    let blockW = 0;
    let blockH = 0;
    let gap = 2;
    let gridX = 0;
    let gridY = 0;
    let gridW = 0;
    let gridH = 0;
    let totalClusters = 0;

    const layout = () => {
      const w = (canvas as any)._lw as number || canvas.width;
      const h = (canvas as any)._lh as number || canvas.height;
      const cur = settingsRef.current;

      gridX = PAD + 12;
      gridY = PAD + HEADER_H + LEGEND_H + 8;
      gridW = w - 2 * (PAD + 12);
      gridH = h - gridY - PAD - STATUS_H - 8;

      const baseBlockW = 11 * cur.scale;
      const baseBlockH = 16 * cur.scale;
      gap = Math.max(1, Math.round(2 * cur.scale));
      blockW = Math.max(4, Math.round(baseBlockW));
      blockH = Math.max(6, Math.round(baseBlockH));

      cols = Math.max(8, Math.floor((gridW + gap) / (blockW + gap)));
      rows = Math.max(4, Math.floor((gridH + gap) / (blockH + gap)));
      const total = cols * rows;
      totalClusters = total;

      // Re-seed if size changed
      if (cells.length !== total) {
        cells = new Array(total);
        for (let i = 0; i < total; i++) {
          const r = Math.random();
          let base: CellBase;
          if (r < 0.025) base = 'unmovable';
          else if (r < 0.045) base = 'bad';
          else if (r < 0.70) base = 'used';
          else base = 'empty';
          cells[i] = { base, state: base, timer: 0 };
        }
      }

      // Center the grid
      const usedW = cols * blockW + (cols - 1) * gap;
      gridX = Math.round((w - usedW) / 2);
      const usedH = rows * blockH + (rows - 1) * gap;
      gridY = Math.round(PAD + HEADER_H + LEGEND_H + 8 + (gridH - usedH) / 2);
    };

    const resize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      canvasRef.current.width = Math.max(320, Math.floor(w * dpr));
      canvasRef.current.height = Math.max(200, Math.floor(h * dpr));
      canvasRef.current.style.width = `${w}px`;
      canvasRef.current.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Use logical (pre-DPR) dims for drawing — overwrite our convenience getter
      (canvas as any)._lw = w;
      (canvas as any)._lh = h;
      layout();
    };
    window.addEventListener('resize', resize);
    resize();

    // --- Helpers ---
    const triggerEvent = (state: CellTransient, count: number, baseFilter: CellBase | null) => {
      for (let n = 0; n < count; n++) {
        const idx = (Math.random() * cells.length) | 0;
        const c = cells[idx];
        if (!c) continue;
        if (c.base === 'bad' || c.base === 'unmovable') continue;
        if (baseFilter && c.base !== baseFilter) continue;
        c.state = state;
        c.timer = TRANSIENT_DURATION[state];
      }
    };

    const tickCells = (dt: number) => {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c.timer > 0) {
          c.timer -= dt;
          if (c.timer <= 0) {
            c.timer = 0;
            // After writing, an empty cell becomes used (defrag converged a bit)
            if (c.state === 'writing' && c.base === 'empty' && Math.random() < 0.55) {
              c.base = 'used';
            }
            c.state = c.base;
          }
        }
      }
    };

    let progress = 0;
    let elapsedSec = 0;
    let blink = 0;
    let lastLayoutScale = settingsRef.current.scale;

    const drawBlock = (i: number) => {
      const c = cells[i];
      const col = i % cols;
      const row = (i / cols) | 0;
      const x = gridX + col * (blockW + gap);
      const y = gridY + row * (blockH + gap);

      if (c.state === 'empty') {
        if (emptyPattern) {
          ctx.fillStyle = emptyPattern;
        } else {
          ctx.fillStyle = palette.emptyDark;
        }
        ctx.fillRect(x, y, blockW, blockH);
        return;
      }

      let fill: string;
      let label: string | null = null;
      switch (c.state) {
        case 'used': fill = palette.used; break;
        case 'reading': fill = palette.reading; break;
        case 'writing': fill = palette.writing; break;
        case 'optimizing': fill = palette.optimizing; break;
        case 'bad': fill = palette.bad; label = 'B'; break;
        case 'unmovable': fill = palette.unmovable; label = 'X'; break;
        default: fill = palette.used;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, blockW, blockH);

      if (label && blockH >= 12) {
        ctx.fillStyle = palette.bg;
        ctx.font = `bold ${Math.floor(blockH * 0.7)}px ui-monospace, "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + blockW / 2, y + blockH / 2 + 1);
      }
    };

    const drawDoubleBorder = (x: number, y: number, w: number, h: number) => {
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const cur = settingsRef.current;

      if (cur.scale !== lastLayoutScale) {
        lastLayoutScale = cur.scale;
        layout();
      }

      ensurePalette(cur.hueShift);

      const w = (canvas as any)._lw as number;
      const h = (canvas as any)._lh as number;

      // BG
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      // --- Audio bands ---
      analyser.getByteFrequencyData(freqData);
      const bassEnd = Math.max(2, Math.floor(freqBins * 0.06));
      const midEnd = Math.floor(freqBins * 0.25);
      const trebleEnd = Math.floor(freqBins * 0.6);
      let bass = 0, mid = 0, treble = 0;
      for (let i = 2; i < bassEnd; i++) bass += freqData[i];
      bass = bass / Math.max(1, bassEnd - 2) / 255;
      for (let i = bassEnd; i < midEnd; i++) mid += freqData[i];
      mid = mid / Math.max(1, midEnd - bassEnd) / 255;
      for (let i = midEnd; i < trebleEnd; i++) treble += freqData[i];
      treble = treble / Math.max(1, trebleEnd - midEnd) / 255;
      const energy = bass * 0.5 + mid * 0.3 + treble * 0.2;

      sBass = sBass * 0.6 + bass * 0.4;
      sMid = sMid * 0.7 + mid * 0.3;
      sTreble = sTreble * 0.65 + treble * 0.35;
      sEnergy = sEnergy * 0.8 + energy * 0.2;

      const sens = cur.sensitivity;
      const speed = cur.speed;
      const bassKick = Math.max(0, sBass - bassPrev);
      bassPrev = sBass;

      // --- Audio-driven events ---
      const writeCount = Math.floor((sBass * 18 + bassKick * 60) * sens * speed);
      const readCount = Math.floor(sMid * 14 * sens * speed);
      const optCount = Math.floor(sTreble * 10 * sens * speed);
      triggerEvent('writing', writeCount, 'empty');
      triggerEvent('reading', readCount, 'used');
      triggerEvent('optimizing', optCount, null);

      tickCells(dt);

      // --- Progress / elapsed ---
      progress = (progress + sEnergy * 0.04 * speed * sens) % 100;
      elapsedSec += dt * speed;
      blink = (blink + dt * speed * 4) % 1;

      // --- Outer double border ---
      drawDoubleBorder(PAD, PAD, w - 2 * PAD, h - 2 * PAD);

      // --- Header ---
      const headerY = PAD + 4;
      ctx.fillStyle = palette.bg;
      ctx.fillRect(PAD + 8, headerY, w - 2 * (PAD + 8), HEADER_H);
      ctx.fillStyle = palette.text;
      ctx.font = 'bold 22px ui-monospace, "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Microsoft Defrag', w / 2, headerY + HEADER_H / 2);

      // Progress percent in top right
      ctx.font = '14px ui-monospace, "Courier New", monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = palette.textDim;
      ctx.fillText(`${progress.toFixed(1).padStart(5, ' ')}%  Complete`, w - PAD - 16, headerY + HEADER_H / 2);

      // Drive letter top left
      ctx.textAlign = 'left';
      ctx.fillStyle = palette.textDim;
      ctx.fillText('Drive C:', PAD + 16, headerY + HEADER_H / 2);

      // Header divider line
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      const hdrLineY = PAD + HEADER_H + 4;
      ctx.beginPath();
      ctx.moveTo(PAD + 4, hdrLineY + 0.5);
      ctx.lineTo(w - PAD - 4, hdrLineY + 0.5);
      ctx.stroke();

      // --- Legend ---
      const legendY = hdrLineY + 6;
      ctx.font = '12px ui-monospace, "Courier New", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const legendItems: { color: string; label: string; letter?: string }[] = [
        { color: emptyPattern ? '' : palette.emptyDark, label: 'Empty' },
        { color: palette.used, label: 'Used' },
        { color: palette.reading, label: 'Reading' },
        { color: palette.writing, label: 'Writing' },
        { color: palette.optimizing, label: 'Moving' },
        { color: palette.bad, label: 'Bad', letter: 'B' },
        { color: palette.unmovable, label: 'Unmovable', letter: 'X' },
      ];
      let lx = PAD + 16;
      const ly = legendY + LEGEND_H / 2;
      for (const item of legendItems) {
        const sw = 14, sh = 12;
        if (item.label === 'Empty' && emptyPattern) {
          ctx.fillStyle = emptyPattern;
        } else {
          ctx.fillStyle = item.color || palette.emptyDark;
        }
        ctx.fillRect(lx, ly - sh / 2, sw, sh);
        if (item.letter) {
          ctx.fillStyle = palette.bg;
          ctx.font = 'bold 10px ui-monospace, "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(item.letter, lx + sw / 2, ly + 1);
          ctx.font = '12px ui-monospace, "Courier New", monospace';
        }
        ctx.fillStyle = palette.text;
        ctx.textAlign = 'left';
        ctx.fillText(item.label, lx + sw + 6, ly);
        lx += sw + 6 + ctx.measureText(item.label).width + 18;
      }

      // --- Cells ---
      for (let i = 0; i < cells.length; i++) drawBlock(i);

      // --- Status bar ---
      const statusLineY = h - PAD - STATUS_H - 4;
      ctx.strokeStyle = palette.border;
      ctx.beginPath();
      ctx.moveTo(PAD + 4, statusLineY + 0.5);
      ctx.lineTo(w - PAD - 4, statusLineY + 0.5);
      ctx.stroke();

      const sy = statusLineY + 8 + STATUS_H / 2;
      const writingActive = sBass > 0.18;
      const readingActive = sMid > 0.18;
      const optimizingActive = sTreble > 0.20;

      let opText = 'Analyzing disk...';
      if (writingActive) opText = `Writing  cluster ${(((progress / 100) * totalClusters) | 0).toLocaleString()}`;
      else if (optimizingActive) opText = `Moving   cluster ${(((Math.random() * totalClusters)) | 0).toLocaleString()}`;
      else if (readingActive) opText = `Reading  cluster ${(((Math.random() * totalClusters)) | 0).toLocaleString()}`;

      // Cursor blink on the operation text
      const showCursor = blink > 0.5;
      ctx.font = '14px ui-monospace, "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = palette.text;
      ctx.fillText(opText + (showCursor ? '_' : ' '), PAD + 16, sy);

      // Right side: cluster size + elapsed
      const totalSec = Math.floor(elapsedSec);
      const hh = Math.floor(totalSec / 3600);
      const mm = Math.floor((totalSec % 3600) / 60);
      const ss = totalSec % 60;
      const elapsed = `${hh}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = palette.textDim;
      ctx.fillText(`Cluster size: 4,096 bytes    Elapsed: ${elapsed}`, w - PAD - 16, sy);
    };

    let lastTime = performance.now();
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
    <div ref={containerRef} className="w-full h-full bg-black overflow-hidden">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
