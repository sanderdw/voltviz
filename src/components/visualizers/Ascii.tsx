import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const CHARS = ' `.-\':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@█';

export default function Ascii({ stream, settings }: Props) {
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
    const ctx = canvas.getContext('2d')!;

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

    const history: number[][] = [];
    let cols = 80;
    let rows = 30;
    let fontSize = 10;
    let lineHeight = 18;
    let charWidth = 8;

    const resize = () => {
      if (!containerRef.current) return;
      canvas.width = containerRef.current.clientWidth;
      canvas.height = containerRef.current.clientHeight;
      const targetCols = 80;
      charWidth = Math.max(8, Math.floor(canvas.width / targetCols));
      fontSize = Math.floor(charWidth * 1.6);
      lineHeight = Math.floor(fontSize * 1.1);
      cols = Math.floor(canvas.width / charWidth);
      rows = Math.floor(canvas.height / lineHeight);
      history.length = 0;
    };
    window.addEventListener('resize', resize);
    resize();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const s = settingsRef.current;

      analyser.getByteFrequencyData(dataArray);

      const row: number[] = [];
      for (let i = 0; i < cols; i++) {
        const idx = Math.floor((i / cols) * bufferLength);
        row.push(Math.min(1, (dataArray[idx] / 255) * s.sensitivity));
      }

      history.unshift(row);
      const maxRows = Math.floor(rows * s.scale);
      if (history.length > maxRows) history.length = maxRows;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize}px monospace`;
      ctx.textBaseline = 'top';

      const time = Date.now() * 0.001 * s.speed;

      for (let y = 0; y < history.length; y++) {
        const rowData = history[y];
        const fade = 1 - (y / history.length) * 0.6;
        for (let x = 0; x < cols; x++) {
          const val = x < rowData.length ? rowData[x] : 0;
          if (val < 0.02) continue;

          const charIdx = Math.floor(val * (CHARS.length - 1));
          const ch = CHARS[charIdx];

          const hue = ((x / cols) * 120 + s.hueShift + time * 30) % 360;
          const lightness = 40 + val * 40;
          const alpha = (0.3 + val * 0.7) * fade;

          ctx.fillStyle = `hsla(${hue},85%,${lightness}%,${alpha})`;
          ctx.fillText(ch, x * charWidth, y * lineHeight);
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
    <div ref={containerRef} className="w-full h-full bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
