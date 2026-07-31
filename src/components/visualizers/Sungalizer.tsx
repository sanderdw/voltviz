import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

type Rect = { x: number; y: number; w: number; h: number };

const MONO = '"IBM Plex Mono", "JetBrains Mono", "Courier New", monospace';
const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const WATERFALL_LEN = 28;
const WATERFALL_POINTS = 64;
const SPECTRO_CELLS = 96;

// Slider ranges from the global settings panel, used to position the fake hardware knobs
const normSensitivity = (v: number) => Math.min(1, Math.max(0, (v - 0.1) / 2.9));
const normSpeed = (v: number) => Math.min(1, Math.max(0, (v - 0.1) / 2.9));
const normScale = (v: number) => Math.min(1, Math.max(0, (v - 0.5) / 2.5));

export default function Sungalizer({ stream, settings }: Props) {
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
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(analyser.fftSize);

    // --- persistent per-session state (phase accumulators, never Date.now * speed) ---
    let lastTime = performance.now();
    let phase = 0;
    let smLevel = 0;
    let vuNeedle = 0;
    let smPeakHz = 440;
    let waterfallAccum = 0;
    let spectroAccum = 0;

    // Waterfall history: raw 0..1 spectra, oldest first, newest last
    const waterfall: Float32Array[] = [];
    for (let i = 0; i < WATERFALL_LEN; i++) waterfall.push(new Float32Array(WATERFALL_POINTS));

    // Scrolling spectrogram lives on an offscreen canvas in device pixels
    const spectroCanvas = document.createElement('canvas');
    const sctx = spectroCanvas.getContext('2d');

    let dpr = 1;
    let cssW = 0;
    let cssH = 0;
    let vignette: CanvasGradient | null = null;

    const resize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = containerRef.current.clientWidth;
      cssH = containerRef.current.clientHeight;
      canvasRef.current.width = Math.max(1, Math.round(cssW * dpr));
      canvasRef.current.height = Math.max(1, Math.round(cssH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vignette = null;
    };
    window.addEventListener('resize', resize);
    resize();

    // Sample the FFT at a 0..1 log-frequency position (20Hz..20kHz), linear-interpolated
    const sampleFreq = (u: number) => {
      const f = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, u);
      const bin = (f * analyser.fftSize) / audioCtx.sampleRate;
      const i = Math.min(bufferLength - 1, Math.floor(bin));
      const j = Math.min(bufferLength - 1, i + 1);
      const frac = bin - i;
      return (freqData[i] + (freqData[j] - freqData[i]) * frac) / 255;
    };

    const text = (
      str: string,
      x: number,
      y: number,
      size: number,
      color: string,
      align: CanvasTextAlign = 'left',
      baseline: CanvasTextBaseline = 'alphabetic',
      bold = false
    ) => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px ${MONO}`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.fillText(str, x, y);
    };

    const draw = (now: number) => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      phase += delta * s.speed;

      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      // Level + peak tracking
      let sum = 0;
      let maxV = 0;
      let maxI = 1;
      for (let i = 1; i < bufferLength; i++) {
        sum += freqData[i];
        if (freqData[i] > maxV) {
          maxV = freqData[i];
          maxI = i;
        }
      }
      const level = Math.min(1, (sum / bufferLength / 255) * 2.5 * s.sensitivity);
      smLevel += (level - smLevel) * 0.12;
      if (maxV > 12) {
        const hz = (maxI * audioCtx.sampleRate) / analyser.fftSize;
        smPeakHz += (hz - smPeakHz) * 0.2;
      }

      // VU ballistics: fast attack, slow release, frame-rate independent
      const vuRate = smLevel > vuNeedle ? 12 : 4;
      vuNeedle += (smLevel - vuNeedle) * Math.min(1, delta * vuRate * s.speed);

      // Waterfall history push
      waterfallAccum += delta * 20 * s.speed;
      while (waterfallAccum >= 1) {
        waterfallAccum -= 1;
        const recycled = waterfall.shift()!;
        for (let i = 0; i < WATERFALL_POINTS; i++) {
          recycled[i] = sampleFreq(i / (WATERFALL_POINTS - 1));
        }
        waterfall.push(recycled);
      }

      const w = cssW;
      const h = cssH;
      const hue = (30 + s.hueShift) % 360;
      const bright = `hsl(${hue}, 100%, 62%)`;
      const mid = `hsl(${hue}, 100%, 46%)`;
      const dim = `hsla(${hue}, 100%, 38%, 0.6)`;
      const faint = `hsla(${hue}, 100%, 34%, 0.3)`;
      const glow = `hsla(${hue}, 100%, 50%, 0.28)`;
      const bg = `hsl(${hue}, 60%, 3%)`;
      const red = `hsl(${(hue + 330) % 360}, 100%, 55%)`;

      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.lineJoin = 'round';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // --- Layout: quad displays left, hardware side panel right ---
      const m = 10;
      const g = 8;
      const sideW = Math.min(300, Math.max(150, w * (w < 700 ? 0.3 : 0.35)));
      const quadW = w - sideW - m * 3;
      const quadH = h - m * 2;
      const cellW = (quadW - g) / 2;
      const cellH = (quadH - g) / 2;
      const specRect: Rect = { x: m, y: m, w: cellW, h: cellH };
      const depthRect: Rect = { x: m + cellW + g, y: m, w: cellW, h: cellH };
      const sgramRect: Rect = { x: m, y: m + cellH + g, w: cellW, h: cellH };
      const scopeRect: Rect = { x: m + cellW + g, y: m + cellH + g, w: cellW, h: cellH };
      const sideRect: Rect = { x: m * 2 + quadW, y: m, w: sideW, h: h - m * 2 };
      if (cellW < 40 || cellH < 40) return;

      const frame = (r: Rect) => {
        ctx.strokeStyle = dim;
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      };

      const dottedLine = (x1: number, y1: number, x2: number, y2: number) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };

      const strokeGlow = (path: Path2D) => {
        ctx.strokeStyle = glow;
        ctx.lineWidth = 3.5;
        ctx.stroke(path);
        ctx.strokeStyle = bright;
        ctx.lineWidth = 1.25;
        ctx.stroke(path);
      };

      const footer = (r: Rect) => {
        text(
          `PK: ${String(Math.round(smPeakHz))}HZ  LVL: ${String(Math.round(smLevel * 100))}%`,
          r.x + r.w / 2,
          r.y + r.h - 18,
          9,
          mid,
          'center'
        );
        text(
          `RES: ${Math.round(r.w)}X${Math.round(r.h)} / RATIO: ${(r.w / r.h).toFixed(2)}`,
          r.x + r.w / 2,
          r.y + r.h - 7,
          9,
          dim,
          'center'
        );
      };

      // ============ Panel 1 (top-left): 2D spectrum ============
      frame(specRect);
      ctx.save();
      ctx.beginPath();
      ctx.rect(specRect.x + 1, specRect.y + 1, specRect.w - 2, specRect.h - 2);
      ctx.clip();
      {
        const r = specRect;
        ctx.setLineDash([1, 4]);
        ctx.strokeStyle = faint;
        ctx.lineWidth = 1;
        for (let i = 1; i < 5; i++) {
          const y = r.y + (r.h * i) / 5;
          dottedLine(r.x, y, r.x + r.w, y);
        }
        for (const f of [100, 1000, 10000]) {
          const x = r.x + r.w * (Math.log(f / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN));
          dottedLine(x, r.y, x, r.y + r.h);
        }
        ctx.setLineDash([]);

        const baseY = r.y + r.h - 26;
        const N = 160;
        const path = new Path2D();
        const outline = new Path2D();
        path.moveTo(r.x, baseY);
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);
          const v = Math.min(1, sampleFreq(u) * s.sensitivity);
          const x = r.x + u * r.w;
          const y = baseY - Math.min(r.h - 30, v * r.h * 0.72 * s.scale);
          path.lineTo(x, y);
          if (i === 0) outline.moveTo(x, y);
          else outline.lineTo(x, y);
        }
        path.lineTo(r.x + r.w, baseY);
        path.closePath();
        const grad = ctx.createLinearGradient(0, r.y, 0, baseY);
        grad.addColorStop(0, `hsla(${hue}, 100%, 45%, 0.4)`);
        grad.addColorStop(1, `hsla(${hue}, 100%, 35%, 0.05)`);
        ctx.fillStyle = grad;
        ctx.fill(path);
        strokeGlow(outline);

        text('-30DB', r.x + 6, r.y + 12, 9, dim);
        text('-100DB', r.x + 6, baseY - 4, 9, dim);
        ctx.shadowColor = bright;
        ctx.shadowBlur = 5;
        text(`SPAN: ${(s.scale * 4.5).toFixed(1)}X   SMTH: 50%`, r.x + 10, r.y + 30, 10, bright);
        text(`GAIN: ${s.sensitivity.toFixed(1)}X   GATE: 100%`, r.x + 10, r.y + 44, 10, bright);
        ctx.shadowBlur = 0;
        footer(r);
      }
      ctx.restore();

      // ============ Panel 2 (top-right): 3D depth trace ============
      frame(depthRect);
      ctx.save();
      ctx.beginPath();
      ctx.rect(depthRect.x + 1, depthRect.y + 1, depthRect.w - 2, depthRect.h - 2);
      ctx.clip();
      {
        const r = depthRect;
        const cx = r.x + r.w / 2;
        const frontY = r.y + r.h - 32;
        const depthH = r.h * 0.5;
        const rowGeom = (t: number) => ({
          y: frontY - t * depthH,
          halfW: (r.w * 0.46) * (1 - t * 0.45),
          depthScale: 1 - t * 0.72,
        });

        // Perspective floor grid
        ctx.setLineDash([1, 4]);
        ctx.strokeStyle = faint;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
          const gm = rowGeom(i / 5);
          dottedLine(cx - gm.halfW, gm.y, cx + gm.halfW, gm.y);
        }
        const front = rowGeom(0);
        const back = rowGeom(1);
        for (let i = 0; i <= 8; i++) {
          const u = i / 8 - 0.5;
          dottedLine(cx + u * 2 * front.halfW, front.y, cx + u * 2 * back.halfW, back.y);
        }
        ctx.setLineDash([]);

        // Ridges back-to-front with occlusion fill; newest frame is at the front
        for (let j = WATERFALL_LEN - 1; j >= 0; j--) {
          const frameData = waterfall[WATERFALL_LEN - 1 - j];
          const t = j / (WATERFALL_LEN - 1);
          const gm = rowGeom(t);
          const ridge = new Path2D();
          const poly = new Path2D();
          poly.moveTo(cx - gm.halfW, gm.y);
          for (let i = 0; i < WATERFALL_POINTS; i++) {
            const u = i / (WATERFALL_POINTS - 1);
            const v = Math.min(1, frameData[i] * s.sensitivity);
            const x = cx - gm.halfW + u * gm.halfW * 2;
            const y = gm.y - v * r.h * 0.32 * s.scale * gm.depthScale;
            poly.lineTo(x, y);
            if (i === 0) ridge.moveTo(x, y);
            else ridge.lineTo(x, y);
          }
          poly.lineTo(cx + gm.halfW, gm.y);
          poly.closePath();
          ctx.fillStyle = bg;
          ctx.fill(poly);
          if (j < 4) {
            strokeGlow(ridge);
          } else {
            ctx.strokeStyle = `hsla(${hue}, 100%, 52%, ${(0.2 + 0.75 * (1 - t)).toFixed(2)})`;
            ctx.lineWidth = 1;
            ctx.stroke(ridge);
          }
        }

        ctx.shadowColor = bright;
        ctx.shadowBlur = 5;
        text(`FOV: ${(0.5 * s.scale).toFixed(2)}   ROT: 0°`, r.x + 10, r.y + 30, 10, bright);
        text(`HGT: ${(2.3 * s.scale).toFixed(1)}    SPN: ${WATERFALL_LEN}`, r.x + 10, r.y + 44, 10, bright);
        ctx.shadowBlur = 0;
        footer(r);
      }
      ctx.restore();

      // ============ Panel 3 (bottom-left): scrolling spectrogram ============
      frame(sgramRect);
      {
        const r = sgramRect;
        const targetW = Math.max(1, Math.round((r.w - 2) * dpr));
        const targetH = Math.max(1, Math.round((r.h - 2) * dpr));
        if (sctx && (spectroCanvas.width !== targetW || spectroCanvas.height !== targetH)) {
          spectroCanvas.width = targetW;
          spectroCanvas.height = targetH;
          spectroAccum = 0;
        }
        if (sctx) {
          spectroAccum += delta * 60 * s.speed * dpr;
          let cols = Math.floor(spectroAccum);
          spectroAccum -= cols;
          cols = Math.min(cols, spectroCanvas.width);
          if (cols > 0) {
            sctx.globalCompositeOperation = 'copy';
            sctx.drawImage(spectroCanvas, -cols, 0);
            sctx.globalCompositeOperation = 'source-over';
            const cellH = spectroCanvas.height / SPECTRO_CELLS;
            for (let c = 0; c < SPECTRO_CELLS; c++) {
              // Row 0 = 20kHz at the top, last row = 20Hz at the bottom
              const u = 1 - c / (SPECTRO_CELLS - 1);
              const v = Math.min(1, sampleFreq(u) * s.sensitivity);
              if (v < 0.02) continue;
              const l = 4 + 56 * Math.pow(v, 1.5);
              sctx.fillStyle = `hsla(${hue}, 100%, ${l.toFixed(0)}%, ${(0.15 + v * 0.85).toFixed(2)})`;
              sctx.fillRect(spectroCanvas.width - cols, c * cellH, cols, Math.ceil(cellH));
            }
          }
          ctx.drawImage(spectroCanvas, r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx.clip();
        text('20KHZ', r.x + 6, r.y + 12, 9, dim);
        text('20HZ', r.x + 6, r.y + r.h - 7, 9, dim);
        ctx.shadowColor = bright;
        ctx.shadowBlur = 5;
        text(`GAIN: ${s.sensitivity.toFixed(1)}X   DECAY: 50%`, r.x + 10, r.y + 30, 10, bright);
        text(`SPD: ${s.speed.toFixed(1)}X    THR: -60DB`, r.x + 10, r.y + 44, 10, bright);
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // ============ Panel 4 (bottom-right): oscilloscope ============
      frame(scopeRect);
      ctx.save();
      ctx.beginPath();
      ctx.rect(scopeRect.x + 1, scopeRect.y + 1, scopeRect.w - 2, scopeRect.h - 2);
      ctx.clip();
      {
        const r = scopeRect;
        const cy = r.y + r.h / 2;
        ctx.setLineDash([1, 4]);
        ctx.strokeStyle = faint;
        ctx.lineWidth = 1;
        for (let i = 1; i < 6; i++) dottedLine(r.x + (r.w * i) / 6, r.y, r.x + (r.w * i) / 6, r.y + r.h);
        for (let i = 1; i < 4; i++) dottedLine(r.x, r.y + (r.h * i) / 4, r.x + r.w, r.y + (r.h * i) / 4);
        ctx.setLineDash([]);
        ctx.strokeStyle = dim;
        dottedLine(r.x, cy, r.x + r.w, cy);

        // Zero-crossing trigger for a stable trace; scale acts as horizontal zoom
        const win = Math.floor(1024 / Math.max(0.5, s.scale));
        let start = 0;
        for (let i = 0; i < timeData.length - win - 1; i++) {
          if (timeData[i] <= 128 && timeData[i + 1] > 128) {
            start = i;
            break;
          }
        }
        const stride = Math.max(1, Math.floor(win / r.w));
        const trace = new Path2D();
        for (let i = 0; i < win; i += stride) {
          const v = timeData[start + i] / 128 - 1;
          const x = r.x + (i / win) * r.w;
          const y = cy + v * r.h * 0.45 * s.sensitivity;
          if (i === 0) trace.moveTo(x, y);
          else trace.lineTo(x, y);
        }
        strokeGlow(trace);

        text('+1.0V', r.x + 6, r.y + 12, 9, dim);
        text('-1.0V', r.x + 6, r.y + r.h - 26, 9, dim);
        ctx.shadowColor = bright;
        ctx.shadowBlur = 5;
        text(`ZOOM: ${(s.scale * 3).toFixed(1)}X   HOLD: OFF`, r.x + 10, r.y + 30, 10, bright);
        text(`AMP: ${s.sensitivity.toFixed(1)}X    OFFS: 0.00V`, r.x + 10, r.y + 44, 10, bright);
        ctx.shadowBlur = 0;
        footer(r);
      }
      ctx.restore();

      // ============ Side panel: hardware chrome ============
      frame(sideRect);
      {
        const r = sideRect;
        const pad = 12;
        const innerX = r.x + pad;
        const innerW = r.w - pad * 2;

        // Clamped section heights with fixed gaps; the knob+fader zone absorbs leftover height
        const titleH = Math.min(48, Math.max(30, r.h * 0.08));
        const modesBlockH = 18 + 6 + 18;
        const inputBlockH = 10 + 22;
        const vuH = Math.min(180, Math.max(60, r.h * 0.2));
        const abcH = 20;
        const saveH = 20;
        const gap = 14;
        const knobAreaH = Math.max(
          120,
          r.h - pad * 2 - titleH - modesBlockH - inputBlockH - vuH - abcH - saveH - gap * 6
        );
        let y = r.y + pad;
        ctx.strokeStyle = mid;
        ctx.lineWidth = 1;
        ctx.strokeRect(innerX + 0.5, y + 0.5, innerW, titleH);
        ctx.strokeStyle = dim;
        ctx.strokeRect(innerX + 3.5, y + 3.5, innerW - 6, titleH - 6);
        ctx.shadowColor = bright;
        ctx.shadowBlur = 6;
        text('S U N G A L I Z E R', innerX + innerW / 2, y + titleH / 2 - 3, 12, bright, 'center', 'middle', true);
        ctx.shadowBlur = 0;
        text('AUDIO ANALYZER MK-II', innerX + innerW / 2, y + titleH - 6, 6, dim, 'center');
        y += titleH + gap;

        // Mode buttons + swatches
        const modeH = 18;
        const modes = ['SPECTRUM', 'DEPTH', 'TRACE', 'SCOPE', 'QUAD'];
        const mw = (innerW - 4 * 3) / 5;
        modes.forEach((mode, i) => {
          const bx = innerX + i * (mw + 3);
          if (mode === 'QUAD') {
            ctx.fillStyle = mid;
            ctx.fillRect(bx, y, mw, modeH);
            text(mode, bx + mw / 2, y + modeH / 2 + 1, 7, bg, 'center', 'middle', true);
          } else {
            ctx.strokeStyle = dim;
            ctx.strokeRect(bx + 0.5, y + 0.5, mw - 1, modeH - 1);
            text(mode, bx + mw / 2, y + modeH / 2 + 1, 6.5, mid, 'center', 'middle');
          }
        });
        y += modeH + 6;
        const swW = (innerW - 6 * 2) / 3;
        ctx.fillStyle = mid;
        ctx.fillRect(innerX + 3, y + 3, swW - 6, 12);
        ctx.fillStyle = `hsl(${(hue + 130) % 360}, 100%, 45%)`;
        ctx.fillRect(innerX + swW + 6 + 3, y + 3, swW - 6, 12);
        for (let i = 0; i < 3; i++) {
          ctx.strokeStyle = dim;
          ctx.strokeRect(innerX + i * (swW + 6) + 0.5, y + 0.5, swW - 1, 17);
        }
        text('+', innerX + 2 * (swW + 6) + swW / 2, y + 10, 10, mid, 'center', 'middle');
        y += 18 + gap;

        // Input box with blinking LIVE indicator
        text('INPUT', innerX, y + 4, 8, bright);
        const liveOn = Math.sin(phase * 3) > -0.6;
        ctx.fillStyle = liveOn ? bright : faint;
        ctx.fillRect(innerX + innerW - 34, y - 3, 7, 7);
        text('LIVE', innerX + innerW, y + 4, 8, liveOn ? bright : dim, 'right');
        y += 10;
        const inputH = 22;
        ctx.strokeStyle = dim;
        ctx.strokeRect(innerX + 0.5, y + 0.5, innerW - 1, inputH - 1);
        text('STREAM HOST', innerX + 8, y + inputH / 2 + 1, 9, mid, 'left', 'middle');
        text('▾', innerX + innerW - 10, y + inputH / 2 + 1, 9, mid, 'right', 'middle');
        y += inputH + gap;

        // VU meter
        ctx.strokeStyle = mid;
        ctx.strokeRect(innerX + 0.5, y + 0.5, innerW, vuH);
        ctx.save();
        ctx.beginPath();
        ctx.rect(innerX + 1, y + 1, innerW - 2, vuH - 2);
        ctx.clip();
        {
          const cx = innerX + innerW / 2;
          const cy = y + vuH - 10;
          const R = Math.min(vuH * 0.85, innerW * 0.42);
          const angleOf = (v: number) => -0.9 + v * 1.8;
          const vuLabels = ['-40', '-20', '-10', '-5', '0', '+3'];
          for (let i = 0; i <= 24; i++) {
            const v = i / 24;
            const a = angleOf(v);
            const major = i % 4 === 0 || i === 24;
            const r1 = R - (major ? 8 : 4);
            ctx.strokeStyle = v > 0.8 ? red : mid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
            ctx.lineTo(cx + R * Math.sin(a), cy - R * Math.cos(a));
            ctx.stroke();
          }
          vuLabels.forEach((lbl, i) => {
            const a = angleOf(i / (vuLabels.length - 1));
            text(lbl, cx + (R - 15) * Math.sin(a), cy - (R - 15) * Math.cos(a), 7, dim, 'center', 'middle');
          });
          text('VU', cx, cy - R * 0.3, 11, bright, 'center', 'middle', true);
          const na = angleOf(Math.min(1, vuNeedle)) + Math.sin(phase * 7) * 0.01;
          const needle = new Path2D();
          needle.moveTo(cx, cy);
          needle.lineTo(cx + R * 0.95 * Math.sin(na), cy - R * 0.95 * Math.cos(na));
          strokeGlow(needle);
          ctx.fillStyle = bright;
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        y += vuH + gap;

        // Knobs (left, 2x2) + fader (right); positions derived from the global sliders
        ctx.strokeStyle = dim;
        ctx.lineWidth = 1;
        ctx.strokeRect(innerX + 0.5, y + 0.5, innerW, knobAreaH);
        const knobW = innerW * 0.62;
        const knobs: [string, number][] = [
          ['WEIGHT', normSensitivity(s.sensitivity)],
          ['X-DIV', normScale(s.scale)],
          ['DATA', smLevel],
          ['Y-DIV', normSpeed(s.speed)],
        ];
        // Knob block is capped so tall viewports grow the fader, not the knob spacing
        const blockH = Math.min(knobAreaH, 340);
        const blockTop = y + (knobAreaH - blockH) * 0.35;
        const kr = Math.min(knobW / 5.2, blockH / 6.5);
        knobs.forEach(([label, norm], i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const kx = innerX + knobW * (0.28 + col * 0.5);
          const ky = blockTop + blockH * (0.24 + row * 0.5);
          ctx.strokeStyle = mid;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(kx, ky, kr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = faint;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(kx, ky, kr + 3, 0, Math.PI * 2);
          ctx.stroke();
          const ka = (-135 + norm * 270) * (Math.PI / 180);
          ctx.strokeStyle = bright;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(kx + kr * 0.35 * Math.sin(ka), ky - kr * 0.35 * Math.cos(ka));
          ctx.lineTo(kx + kr * 0.95 * Math.sin(ka), ky - kr * 0.95 * Math.cos(ka));
          ctx.stroke();
          text(label, kx, ky + kr + 12, 7, mid, 'center');
        });

        // Fader track: handle follows sensitivity
        const fx = innerX + innerW - 22;
        const ft = y + 6;
        const fh = knobAreaH - 12;
        ctx.strokeStyle = dim;
        ctx.strokeRect(fx - 6 + 0.5, ft + 0.5, 12, fh);
        ctx.strokeStyle = faint;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 8; i++) {
          const ty = ft + (fh * i) / 8;
          dottedLine(fx - 12, ty, fx - 8, ty);
          dottedLine(fx + 8, ty, fx + 12, ty);
        }
        ctx.strokeStyle = mid;
        dottedLine(fx, ft, fx, ft + fh);
        const fy = ft + (1 - normSensitivity(s.sensitivity)) * (fh - 14) + 2;
        ctx.fillStyle = bright;
        ctx.fillRect(fx - 9, fy, 18, 4);
        ctx.fillRect(fx - 9, fy + 6, 18, 4);
        y += knobAreaH + gap;

        // A / B / C preset buttons (A active)
        const aw = (innerW - 6 * 2) / 3;
        ['A', 'B', 'C'].forEach((lbl, i) => {
          const bx = innerX + i * (aw + 6);
          if (i === 0) {
            ctx.fillStyle = mid;
            ctx.fillRect(bx, y, aw, abcH);
            text(lbl, bx + aw / 2, y + abcH / 2 + 1, 9, bg, 'center', 'middle', true);
          } else {
            ctx.strokeStyle = dim;
            ctx.strokeRect(bx + 0.5, y + 0.5, aw - 1, abcH - 1);
            text(lbl, bx + aw / 2, y + abcH / 2 + 1, 9, mid, 'center', 'middle');
          }
        });
        y += abcH + gap;

        // SAVE / LOAD
        const sw = (innerW - 6) / 2;
        const saveBlink = Math.sin(phase * 2) > 0.9;
        ctx.strokeStyle = dim;
        ctx.strokeRect(innerX + 0.5, y + 0.5, sw - 1, saveH - 1);
        ctx.strokeRect(innerX + sw + 6 + 0.5, y + 0.5, sw - 1, saveH - 1);
        text('SAVE', innerX + sw / 2, y + saveH / 2 + 1, 8, saveBlink ? bright : mid, 'center', 'middle');
        text('LOAD', innerX + sw + 6 + sw / 2, y + saveH / 2 + 1, 8, mid, 'center', 'middle');
      }

      // ============ CRT overlay ============
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      for (let sy = 0; sy < h; sy += 4) {
        ctx.fillRect(0, sy, w, 1.5);
      }
      if (!vignette) {
        vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, w * 0.8);
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.75)');
      }
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      const flicker = 0.015 + 0.015 * (0.5 + 0.5 * Math.sin(phase * 17) * Math.sin(phase * 7.3));
      ctx.fillStyle = `rgba(0, 0, 0, ${flicker.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    };

    draw(performance.now());

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
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
