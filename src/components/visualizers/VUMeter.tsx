import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

// --- VU meter arc geometry (angles from vertical in radians, negative = left) ---
const ARC_START_DEG = -50;
const ARC_END_DEG = 38;
const ARC_START = (ARC_START_DEG * Math.PI) / 180;
const ARC_END = (ARC_END_DEG * Math.PI) / 180;
const ARC_SPAN = ARC_END - ARC_START;

function vuToPercent(vu: number): number {
  return Math.pow(10, vu / 20) * 100;
}

const MAX_PCT = vuToPercent(3); // ~141.25%

function vuToAngle(vu: number): number {
  const pct = vuToPercent(Math.max(-50, Math.min(4, vu)));
  return ARC_START + (pct / MAX_PCT) * ARC_SPAN;
}

function pctToAngle(pct: number): number {
  return ARC_START + (pct / MAX_PCT) * ARC_SPAN;
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  cx: number, py: number, r: number,
  from: number, to: number, steps: number, isVu: boolean
) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const v = from + (i / steps) * (to - from);
    const a = isVu ? vuToAngle(v) : pctToAngle(v);
    const x = cx + Math.sin(a) * r;
    const y = py - Math.cos(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawMeterFace(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  vuLevel: number, hueShift: number, label: string
) {
  const cx = x + w / 2;
  const pivotY = y + h * 0.85;
  const R = h * 0.62;
  const fs = Math.max(7, Math.min(w * 0.042, 18));
  const cr = w * 0.035;

  // Housing
  ctx.fillStyle = '#0d0d0d';
  ctx.beginPath();
  ctx.roundRect(x - 3, y - 3, w + 6, h + 6, cr + 2);
  ctx.fill();

  // Face gradient
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#ecdcb4');
  grad.addColorStop(0.4, '#e4d4a8');
  grad.addColorStop(1, '#c8b880');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.fill();

  // Warm radial glow
  const glow = ctx.createRadialGradient(cx, pivotY - R * 0.3, 0, cx, pivotY, R * 1.4);
  glow.addColorStop(0, 'rgba(255,240,200,0.15)');
  glow.addColorStop(0.5, 'rgba(255,230,180,0.04)');
  glow.addColorStop(1, 'rgba(0,0,0,0.04)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.fill();

  const redHue = (0 + hueShift) % 360;
  const red = `hsl(${redHue}, 80%, 42%)`;

  // VU label
  ctx.fillStyle = '#2a2a2a';
  ctx.font = `bold ${fs * 2}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VU', cx, y + h * 0.1);

  // Screw dot
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.19, w * 0.016, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.arc(cx - 0.5, y + h * 0.19 - 0.5, w * 0.007, 0, Math.PI * 2);
  ctx.fill();

  // === dB SCALE ===
  // Black arc: -20 to 0
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = Math.max(1.2, w * 0.004);
  drawArc(ctx, cx, pivotY, R, -20, 0, 60, true);

  // Red arc: 0 to +3
  ctx.strokeStyle = red;
  ctx.lineWidth = Math.max(1.5, w * 0.005);
  drawArc(ctx, cx, pivotY, R, 0, 3, 30, true);

  // dB tick marks and labels
  const dbMarks = [
    { vu: -20, label: '20' }, { vu: -10, label: '10' },
    { vu: -7, label: '7' }, { vu: -5, label: '5' },
    { vu: -3, label: '3' }, { vu: -2, label: '2' },
    { vu: -1, label: '1' }, { vu: 0, label: '0' },
    { vu: 1, label: '1' }, { vu: 2, label: '2' },
    { vu: 3, label: '3' },
  ];

  const tick = R * 0.065;
  ctx.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of dbMarks) {
    const a = vuToAngle(m.vu);
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const isRed = m.vu >= 1;

    ctx.strokeStyle = isRed ? red : '#2a2a2a';
    ctx.lineWidth = Math.max(1, w * 0.003);
    ctx.beginPath();
    ctx.moveTo(cx + sin * R, pivotY - cos * R);
    ctx.lineTo(cx + sin * (R - tick), pivotY - cos * (R - tick));
    ctx.stroke();

    const lr = R + fs * 0.75;
    ctx.fillStyle = isRed ? red : '#2a2a2a';
    ctx.fillText(m.label, cx + sin * lr, pivotY - cos * lr);
  }

  // Minor ticks
  for (const vu of [-15, -8, -6, -4, -0.5, 0.5, 1.5, 2.5]) {
    const a = vuToAngle(vu);
    const isRed = vu > 0;
    ctx.strokeStyle = isRed ? red : '#2a2a2a';
    ctx.lineWidth = Math.max(0.5, w * 0.002);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * R, pivotY - Math.cos(a) * R);
    ctx.lineTo(cx + Math.sin(a) * (R - tick * 0.5), pivotY - Math.cos(a) * (R - tick * 0.5));
    ctx.stroke();
  }

  // − and + symbols
  ctx.font = `bold ${fs * 1.2}px Arial, Helvetica, sans-serif`;
  const symR = R + fs * 1.7;

  const minusA = vuToAngle(-16);
  ctx.fillStyle = '#2a2a2a';
  ctx.fillText('−', cx + Math.sin(minusA) * symR, pivotY - Math.cos(minusA) * symR);

  const plusA = vuToAngle(1.5);
  ctx.fillStyle = red;
  ctx.fillText('+', cx + Math.sin(plusA) * symR, pivotY - Math.cos(plusA) * symR);

  // === PERCENTAGE SCALE ===
  const pR = R * 0.82;
  const pTick = tick * 0.55;
  const pFs = fs * 0.72;

  ctx.strokeStyle = '#777';
  ctx.lineWidth = Math.max(0.7, w * 0.002);
  drawArc(ctx, cx, pivotY, pR, 0, 100, 50, false);

  ctx.font = `${pFs}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = '#777';

  for (const pct of [0, 20, 40, 60, 80, 100]) {
    const a = pctToAngle(pct);
    const sin = Math.sin(a);
    const cos = Math.cos(a);

    ctx.strokeStyle = '#777';
    ctx.lineWidth = Math.max(0.5, w * 0.002);
    ctx.beginPath();
    ctx.moveTo(cx + sin * pR, pivotY - cos * pR);
    ctx.lineTo(cx + sin * (pR - pTick), pivotY - cos * (pR - pTick));
    ctx.stroke();

    const lr = pR - pTick - pFs * 0.7;
    ctx.fillText(String(pct), cx + sin * lr, pivotY - cos * lr);
  }

  // === NEEDLE ===
  const needleAngle = vuToAngle(vuLevel);
  const needleLen = R * 1.02;
  const tipX = cx + Math.sin(needleAngle) * needleLen;
  const tipY = pivotY - Math.cos(needleAngle) * needleLen;

  const cwLen = R * 0.12;
  const cwX = cx - Math.sin(needleAngle) * cwLen;
  const cwY = pivotY + Math.cos(needleAngle) * cwLen;

  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;

  const needleHue = (0 + hueShift) % 360;
  ctx.strokeStyle = `hsl(${needleHue}, 60%, 28%)`;
  ctx.lineWidth = Math.max(1.2, w * 0.005);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cwX, cwY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.restore();

  // Counterweight
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(cwX, cwY, w * 0.01, 0, Math.PI * 2);
  ctx.fill();

  // Pivot cover
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(cx, pivotY, w * 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.arc(cx - 1, pivotY - 1, w * 0.01, 0, Math.PI * 2);
  ctx.fill();

  // Channel label
  ctx.fillStyle = '#555';
  ctx.font = `${fs * 0.9}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, pivotY + h * 0.08);

  // Glass reflection
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.clip();
  const glass = ctx.createLinearGradient(x, y, x + w * 0.6, y + h * 0.4);
  glass.addColorStop(0, 'rgba(255,255,255,0.09)');
  glass.addColorStop(0.4, 'rgba(255,255,255,0.02)');
  glass.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glass;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // Bezel
  ctx.strokeStyle = 'rgba(80,70,50,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.stroke();
}

export default function VUMeter({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);
  const smoothedL = useRef(-40);
  const smoothedR = useRef(-40);

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

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    const splitter = audioCtx.createChannelSplitter(2);
    source.connect(splitter);

    const analyserL = audioCtx.createAnalyser();
    analyserL.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0;
    const analyserR = audioCtx.createAnalyser();
    analyserR.fftSize = 2048;
    analyserR.smoothingTimeConstant = 0;

    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    const N = analyserL.fftSize;
    const bufL = new Float32Array(N);
    const bufR = new Float32Array(N);

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    let prev = performance.now();

    const draw = (now: number) => {
      animationRef.current = requestAnimationFrame(draw);
      const dt = Math.min((now - prev) / 1000, 0.1);
      prev = now;

      const w = canvas.width;
      const h = canvas.height;
      const s = settingsRef.current;

      analyserL.getFloatTimeDomainData(bufL);
      analyserR.getFloatTimeDomainData(bufR);

      let sumL = 0, sumR = 0;
      for (let i = 0; i < N; i++) {
        sumL += bufL[i] * bufL[i];
        sumR += bufR[i] * bufR[i];
      }
      let rmsL = Math.sqrt(sumL / N);
      let rmsR = Math.sqrt(sumR / N);
      // Mono fallback: mirror left channel if right is silent
      if (rmsR < 1e-5) rmsR = rmsL;

      const gain = s.sensitivity * 6;
      const dbL = rmsL > 0 ? 20 * Math.log10(rmsL * gain) : -60;
      const dbR = rmsR > 0 ? 20 * Math.log10(rmsR * gain) : -60;

      // VU ballistic smoothing (~300 ms rise/fall)
      const attack = 1 - Math.exp(-dt * 3.5 * s.speed);
      const release = 1 - Math.exp(-dt * 2.5 * s.speed);
      const tL = Math.max(-25, Math.min(4, dbL));
      const tR = Math.max(-25, Math.min(4, dbR));
      smoothedL.current += (tL - smoothedL.current) * (tL > smoothedL.current ? attack : release);
      smoothedR.current += (tR - smoothedR.current) * (tR > smoothedR.current ? attack : release);

      // Clear
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);

      // Layout two meters side-by-side
      const pad = Math.min(w, h) * 0.04;
      const gap = Math.min(w, h) * 0.025;
      const aspect = 1.25;

      let mW = (w - pad * 2 - gap) / 2;
      let mH = mW / aspect;
      if (mH > h - pad * 2) { mH = h - pad * 2; mW = mH * aspect; }

      mW *= Math.min(s.scale, 2);
      mH *= Math.min(s.scale, 2);

      const totalW = mW * 2 + gap;
      const sx = (w - totalW) / 2;
      const sy = (h - mH) / 2;

      const clL = Math.max(-20, Math.min(3, smoothedL.current));
      const clR = Math.max(-20, Math.min(3, smoothedR.current));

      drawMeterFace(ctx, sx, sy, mW, mH, clL, s.hueShift, 'L');
      drawMeterFace(ctx, sx + mW + gap, sy, mW, mH, clR, s.hueShift, 'R');
    };

    animationRef.current = requestAnimationFrame(draw);

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
